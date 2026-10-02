"""Importação de pessoas do Movidesk: empresas, contatos e agentes.

Complementa a importação de tickets, que só enxerga quem aparece em chamado
— e sem e-mail nem CNPJ. A rota `/persons` traz o cadastro inteiro:

- `personType` 2 (empresa) vira `Company`: casada pelo CNPJ, senão pelo
  nome; criada com o plano escolhido na tela.
- `personType` 1 com `profileType` 2 (cliente) vira usuário cliente na
  empresa do primeiro `relationships[]`. Sem empresa, fica no balde
  "Sem empresa" (o mesmo da importação de tickets), inativo até alguém o
  mover — no balde todo mundo divide a mesma empresa, e cliente ativo
  enxerga os chamados da própria empresa.
- `personType` 1 com `profileType` 1 ou 3 (agente) vira usuário interno
  DESATIVADO, com as equipes de `teams[]`. Criar agente é criar acesso à
  área interna: alguém libera à mão, um por um, em Configurações → Usuários.
- `personType` 3 (departamento) não tem correspondente aqui — ignorado.

Idempotente, e cuidadoso com o que a equipe já ajustou à mão: rodar de novo
completa o que falta (e-mail sintético da importação de tickets vira o e-mail
real, telefone vazio é preenchido, contato do balde vai pra empresa) e não
sobrescreve o resto — empresa de contato já posicionado, e-mail real, status
de acesso de quem já existe.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field

from django.db import transaction

from apps.accounts.models import AgentTeam, ClientRole, InternalRole, Team, User, UserKind
from apps.core.slugs import unique_slug
from apps.customers.models import Company, Plan
from apps.tickets.services.movidesk import BALDE_NOME, BALDE_SLUG, _import_email

PESSOA, EMPRESA, DEPARTAMENTO = 1, 2, 3
AGENTE, CLIENTE, AGENTE_E_CLIENTE = 1, 2, 3


@dataclass
class RelatorioPessoas:
    empresas_criadas: int = 0
    empresas_atualizadas: int = 0
    contatos_criados: int = 0
    contatos_atualizados: int = 0
    agentes_criados: int = 0
    agentes_atualizados: int = 0
    ignorados: int = 0
    departamentos: int = 0
    agentes_pulados: int = 0
    equipes: list[str] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)

    def as_lines(self) -> list[str]:
        return [
            f"empresas criadas: {self.empresas_criadas}",
            f"empresas já existentes (completadas): {self.empresas_atualizadas}",
            f"contatos criados: {self.contatos_criados}",
            f"contatos já existentes (completados): {self.contatos_atualizados}",
            f"agentes criados (desativados): {self.agentes_criados}",
            f"agentes já existentes (equipes/telefone completados): {self.agentes_atualizados}",
            f"equipes criadas: {len(self.equipes)}",
            f"ignorados: {self.ignorados}",
        ]

    def warning_lines(self) -> list[str]:
        linhas = list(self.avisos)
        if self.agentes_criados:
            linhas.append(
                f"{self.agentes_criados} agente(s) entraram DESATIVADOS. Libere o acesso um a um "
                f"em Configurações → Usuários."
            )
        if self.agentes_pulados:
            linhas.append(
                f"{self.agentes_pulados} agente(s) do Movidesk não foram criados porque "
                f"“criar agentes” estava desligado."
            )
        if self.departamentos:
            linhas.append(
                f"{self.departamentos} departamento(s) do Movidesk ignorados: aqui não existe "
                f"departamento de cliente, e o contato entra direto na empresa."
            )
        return linhas


# ---- leitura tolerante do JSON --------------------------------------------


def _int(valor) -> int | None:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def _texto(valor) -> str:
    return str(valor).strip() if valor is not None else ""


def _nome(p: dict) -> str:
    return (_texto(p.get("businessName")) or _texto(p.get("corporateName")))[:150]


def _ativo(p: dict) -> bool:
    valor = p.get("isActive")
    return True if valor is None else bool(valor)


def _cnpj(p: dict) -> str | None:
    digitos = re.sub(r"\D", "", _texto(p.get("cpfCnpj")))
    return digitos[:20] or None


def _email_padrao(p: dict) -> str:
    """O e-mail marcado como padrão, senão o primeiro — e só se parecer e-mail."""
    emails = [e for e in (p.get("emails") or []) if isinstance(e, dict)]
    emails.sort(key=lambda e: not e.get("isDefault"))
    for e in emails:
        valor = _texto(e.get("email")).lower()
        if "@" in valor and " " not in valor:
            return valor[:254]
    return ""


def _telefones(p: dict) -> tuple[str, str]:
    contatos = [c for c in (p.get("contacts") or []) if isinstance(c, dict)]
    contatos.sort(key=lambda c: not c.get("isDefault"))
    numeros = [_texto(c.get("contact"))[:32] for c in contatos]
    numeros = [n for n in numeros if n]
    return (numeros[0] if numeros else "", numeros[1] if len(numeros) > 1 else "")


def _sintetico(email: str) -> bool:
    # o que a importação de tickets inventa quando o export não traz e-mail
    return email.lower().endswith(".invalid")


class _Importador:
    def __init__(self, plan: Plan, criar_agentes: bool, report: RelatorioPessoas):
        self.plan = plan
        self.criar_agentes = criar_agentes
        self.report = report
        self._por_id: dict[str, Company] = {}
        self._por_nome: dict[str, Company] = {}
        self._teams: dict[str, Team] = {}
        self._balde: Company | None = None

    # -- empresas -----------------------------------------------------------

    def empresa(self, p: dict) -> None:
        nome = _nome(p)
        if not nome:
            self.report.ignorados += 1
            self.report.avisos.append(f"empresa {p.get('id')} sem nome, ignorada.")
            return
        cnpj = _cnpj(p)
        razao = _texto(p.get("corporateName"))[:200]

        emp = Company.objects.filter(tax_id=cnpj).first() if cnpj else None
        if emp is None:
            emp = Company.objects.filter(name__iexact=nome).first()
        if emp is None:
            emp = Company.objects.create(
                name=nome,
                legal_name=razao if razao.lower() != nome.lower() else "",
                tax_id=cnpj,
                slug=unique_slug(Company, nome, fallback="empresa"),
                plan=self.plan,
                is_active=_ativo(p),
                notes=_texto(p.get("observations"))[:2000],
            )
            self.report.empresas_criadas += 1
        else:
            campos = []
            if razao and not emp.legal_name and razao.lower() != emp.name.lower():
                emp.legal_name = razao
                campos.append("legal_name")
            if cnpj and not emp.tax_id and not Company.objects.filter(tax_id=cnpj).exists():
                emp.tax_id = cnpj
                campos.append("tax_id")
            if campos:
                emp.save(update_fields=[*campos, "updated_at"])
                self.report.empresas_atualizadas += 1
        pid = _texto(p.get("id"))
        if pid:
            self._por_id[pid] = emp
        self._por_nome[nome.lower()] = emp

    def balde(self) -> Company:
        if self._balde is None:
            self._balde, _ = Company.objects.get_or_create(
                slug=BALDE_SLUG,
                defaults={"name": BALDE_NOME, "plan": self.plan, "is_active": False},
            )
        return self._balde

    def empresa_do_contato(self, p: dict) -> Company | None:
        """A organização do contato: `relationships[]` aponta pra empresa por id
        (e, quando vem, pelo nome). A primeira que casar vale."""
        for rel in p.get("relationships") or []:
            if not isinstance(rel, dict):
                continue
            rid = _texto(rel.get("id"))
            if rid and rid in self._por_id:
                return self._por_id[rid]
            nome = _texto(rel.get("name") or rel.get("businessName")).lower()
            if nome:
                if nome in self._por_nome:
                    return self._por_nome[nome]
                existente = Company.objects.filter(name__iexact=nome).first()
                if existente is not None:
                    self._por_nome[nome] = existente
                    return existente
        return None

    # -- equipes ------------------------------------------------------------

    def team(self, nome: str) -> Team:
        limpo = _texto(nome)[:80]
        key = limpo.lower()
        if key not in self._teams:
            existente = Team.objects.filter(name__iexact=limpo).first()
            if existente is None:
                existente = Team.objects.create(
                    name=limpo, slug=unique_slug(Team, limpo, fallback="equipe")
                )
                self.report.equipes.append(limpo)
            self._teams[key] = existente
        return self._teams[key]

    # -- pessoas ------------------------------------------------------------

    def pessoa(self, p: dict) -> None:
        perfil = _int(p.get("profileType")) or CLIENTE
        if perfil in (AGENTE, AGENTE_E_CLIENTE):
            self.agente(p)
        else:
            self.contato(p)

    def contato(self, p: dict) -> None:
        nome = _nome(p)
        if not nome:
            self.report.ignorados += 1
            self.report.avisos.append(f"contato {p.get('id')} sem nome, ignorado.")
            return
        email = _email_padrao(p)
        fone1, fone2 = _telefones(p)
        cargo = _texto(p.get("role"))[:100]
        empresa = self.empresa_do_contato(p)

        user = User.objects.filter(email__iexact=email).first() if email else None
        if user is not None and user.kind != UserKind.CLIENT:
            self.report.ignorados += 1
            self.report.avisos.append(
                f"“{nome}”: o e-mail {email} já é de um usuário interno. Não mexi."
            )
            return
        if user is None:
            # inclui quem a importação de tickets criou só com o nome
            user = User.objects.filter(full_name__iexact=nome, kind=UserKind.CLIENT).first()

        if user is None:
            alvo = empresa or self.balde()
            email_final = email or _import_email(nome)
            if User.objects.filter(email__iexact=email_final).exists():
                self.report.ignorados += 1
                self.report.avisos.append(f"“{nome}”: e-mail {email_final} já em uso, ignorado.")
                return
            User.objects.create_user(
                email=email_final,
                full_name=nome,
                kind=UserKind.CLIENT,
                company=alvo,
                client_role=ClientRole.MEMBER,
                phone=fone1,
                phone_secondary=fone2,
                job_title=cargo,
                is_active=_ativo(p) and alvo.slug != BALDE_SLUG,
            )
            self.report.contatos_criados += 1
            return

        campos: list[str] = []
        if (
            email
            and _sintetico(user.email)
            and not User.objects.filter(email__iexact=email).exclude(pk=user.pk).exists()
        ):
            user.email = email
            campos.append("email")
        if fone1 and not user.phone:
            user.phone = fone1
            campos.append("phone")
        if fone2 and not user.phone_secondary:
            user.phone_secondary = fone2
            campos.append("phone_secondary")
        if cargo and not user.job_title:
            user.job_title = cargo
            campos.append("job_title")
        no_balde = user.company is None or user.company.slug == BALDE_SLUG
        if empresa is not None and no_balde and user.company_id != empresa.pk:
            user.company = empresa
            campos.append("company")
            if _ativo(p) and not user.is_active:
                user.is_active = True
                campos.append("is_active")
        if campos:
            user.save(update_fields=[*campos, "updated_at"])
            self.report.contatos_atualizados += 1

    def agente(self, p: dict) -> None:
        nome = _nome(p)
        if not nome:
            self.report.ignorados += 1
            return
        if not self.criar_agentes:
            self.report.ignorados += 1
            self.report.agentes_pulados += 1
            return
        email = _email_padrao(p)
        fone1, fone2 = _telefones(p)
        cargo = _texto(p.get("role"))[:100]
        equipes = [self.team(n) for n in (p.get("teams") or []) if _texto(n)]

        user = User.objects.filter(email__iexact=email).first() if email else None
        if user is not None and user.kind != UserKind.INTERNAL:
            self.report.ignorados += 1
            self.report.avisos.append(
                f"“{nome}” é agente no Movidesk, mas {email} já é um cliente aqui, então não virou "
                f"agente. Se for a mesma pessoa, ajuste à mão."
            )
            return
        if user is None:
            user = User.objects.filter(full_name__iexact=nome, kind=UserKind.INTERNAL).first()

        if user is None:
            if not email:
                self.report.ignorados += 1
                self.report.avisos.append(
                    f"“{nome}” é agente no Movidesk, mas não tem e-mail. Sem e-mail não há "
                    f"login, então não foi criado."
                )
                return
            user = User.objects.create_user(
                email=email,
                full_name=nome,
                kind=UserKind.INTERNAL,
                internal_role=InternalRole.AGENT,
                phone=fone1,
                phone_secondary=fone2,
                job_title=cargo,
                is_active=False,
            )
            self.report.agentes_criados += 1
        else:
            # quem já existe mantém e-mail e acesso como estão; só completa
            campos = []
            if fone1 and not user.phone:
                user.phone = fone1
                campos.append("phone")
            if cargo and not user.job_title:
                user.job_title = cargo
                campos.append("job_title")
            if campos:
                user.save(update_fields=[*campos, "updated_at"])
            self.report.agentes_atualizados += 1

        tem_padrao = AgentTeam.objects.filter(user=user, is_default=True).exists()
        for equipe in equipes:
            _, criado = AgentTeam.objects.get_or_create(
                user=user, team=equipe, defaults={"is_default": not tem_padrao}
            )
            if criado:
                tem_padrao = True


def importar_pessoas(
    pessoas: list[dict],
    *,
    plan: Plan,
    criar_agentes: bool = True,
    on_progress: Callable[[int, int], None] | None = None,
) -> RelatorioPessoas:
    """Empresas primeiro (os contatos apontam pra elas), depois as pessoas.
    Cada registro na própria transação: um que falhe vira aviso, não derruba
    o resto."""
    report = RelatorioPessoas()
    importador = _Importador(plan, criar_agentes, report)

    empresas = [p for p in pessoas if _int(p.get("personType")) == EMPRESA]
    gente = [p for p in pessoas if _int(p.get("personType")) in (PESSOA, None)]
    report.departamentos = sum(1 for p in pessoas if _int(p.get("personType")) == DEPARTAMENTO)
    report.ignorados += report.departamentos

    total = len(empresas) + len(gente)
    feitos = 0
    for lote, metodo in ((empresas, importador.empresa), (gente, importador.pessoa)):
        for p in lote:
            try:
                with transaction.atomic():
                    metodo(p)
            except Exception as exc:  # noqa: BLE001 — um registro ruim não derruba a rodada
                report.ignorados += 1
                report.avisos.append(f"“{_nome(p) or p.get('id')}”: {exc}")
            feitos += 1
            if on_progress is not None:
                on_progress(feitos, total)
    return report
