"""Importação de tickets exportados do Movidesk.

Duas entradas, o mesmo miolo:

- **JSON** (`tickets_completo.json`): a lista de tickets com `actions`,
  `clients` e `owner` expandidos, como a API devolve.
- **CSV** (`tickets_completo.csv`): a mesma coisa achatada, UMA LINHA POR
  MENSAGEM — o formato que abre no Excel. `from_csv` remonta os tickets a
  partir dele, e daí para frente o caminho é idêntico.

O CSV existe porque é o arquivo que a pessoa já tem na mão depois de olhar a
exportação na planilha; obrigá-la a baixar tudo de novo em JSON só para
importar seria pedir trabalho por uma diferença de forma.

Três decisões que valem ser lidas antes do código:

1. **Não passa por `ticket_service`.** Importar é reconstruir histórico, não
   abrir chamado: o service consome cota, dispara notificação, calcula SLA a
   partir de agora e grava data de criação no instante da chamada. Nada disso
   faz sentido para um ticket de seis meses atrás. A escrita aqui é ORM direto,
   e as datas originais são preservadas.

2. **Idempotente pela referência.** O ticket importado fica com
   `MD-<id do Movidesk>`, fora da sequência `TD-NNNNN` do sistema — importar
   histórico não gasta número dos chamados novos. Isso dá três coisas de
   graça: rodar a importação duas vezes não duplica nada, a numeração interna
   segue intacta, e qualquer um que olhe a referência sabe de onde o chamado
   veio.

3. **O texto das ações vem em HTML** e a interface renderiza mensagem como
   texto puro — jogar o HTML cru no corpo mostraria `<p>` na tela do agente.
   Por isso a conversão para texto, sem dependência nova.

A equipe vem do próprio ticket (`ownerTeam`, o nome da equipe no Movidesk):
a de mesmo nome aqui recebe o chamado e, se ainda não existe, é criada. A
equipe passada a `import_tickets` é só o padrão para ticket sem equipe (export
antigo, feito antes de pedirmos o campo, ou ticket que nunca teve dono). O
que o Movidesk exporta e o resolv não tem: a separação entre pessoa e
organização — `clients[].businessName` é um nome só. Ver `import_tickets`.
"""

from __future__ import annotations

import datetime as dt
import html
import re
from collections.abc import Callable
from dataclasses import dataclass, field

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.accounts.models import ClientRole, Team, User, UserKind
from apps.core.slugs import unique_slug
from apps.customers.models import Company, Plan
from apps.tickets.models import (
    MessageSource,
    Ticket,
    TicketCategory,
    TicketMessage,
    TicketPriority,
    TicketSource,
    TicketStatus,
    TicketStatusEvent,
)

REFERENCE_PREFIX = "MD"

# Área de espera para o contato que veio sem organização. Slug reservado: é
# por ele que a limpeza e as telas reconhecem o balde.
BALDE_SLUG = "sem-empresa"
BALDE_NOME = "Sem empresa"

# Movidesk → resolv. Só quatro status do lado de cá, e é proposital: o
# sistema não tem "cancelado" nem separa "resolvido" de "fechado". Cancelado
# entra como fechado — foi encerrado sem virar trabalho pendente, que é o que
# o indicador precisa saber.
STATUS = {
    "novo": TicketStatus.NEW,
    "em atendimento": TicketStatus.OPEN,
    "aguardando": TicketStatus.PENDING_CUSTOMER,
    "parado": TicketStatus.PENDING_CUSTOMER,
    "resolvido": TicketStatus.CLOSED,
    "fechado": TicketStatus.CLOSED,
    "cancelado": TicketStatus.CLOSED,
}

URGENCY = {
    "baixa": TicketPriority.LOW,
    "normal": TicketPriority.NORMAL,
    "média": TicketPriority.NORMAL,
    "media": TicketPriority.NORMAL,
    "alta": TicketPriority.HIGH,
    "urgente": TicketPriority.URGENT,
    "crítica": TicketPriority.URGENT,
    "critica": TicketPriority.URGENT,
}

# canal da AÇÃO (a tabela do exportador) → origem da mensagem no resolv
CHAT_ORIGINS = {5, 6, 18, 20, 22, 23, 25}       # chats e WhatsApp
AUTOMATIC_ORIGINS = {4, 7, 10, 19}              # gatilho e e-mail do sistema

# rótulo do canal no CSV → o número que a API usa (o inverso da tabela do
# exportador). Sem isto, um chamado que entrou por WhatsApp viraria "web".
ORIGEM_POR_ROTULO = {
    "primeira acao": 0, "via web pelo cliente": 1, "via web pelo agente": 2,
    "e-mail recebido": 3, "gatilho do sistema": 4, "chat (online)": 5,
    "chat (offline)": 6, "e-mail enviado pelo sistema": 7,
    "formulario de contato": 8, "via web api": 9, "abertura automatica": 10,
    "jira": 11, "redmine": 12, "chamada recebida": 13, "chamada realizada": 14,
    "chamada perdida": 15, "desistencia na fila": 16, "acesso remoto": 17,
    "whatsapp": 18, "integracao movidesk": 19, "zenvia chat": 20,
    "chamada nao atendida": 21, "facebook messenger": 22,
    "whatsapp business": 23, "altu": 24, "whatsapp ativo": 25,
}

_TAG = re.compile(r"<[^>]+>")
_BREAK = re.compile(r"(?i)<\s*(br\s*/?|/p|/div|/li)\s*>")
_BLANK_LINES = re.compile(r"\n{3,}")


def html_to_text(raw: str | None) -> str:
    """HTML do Movidesk → texto legível, preservando a quebra de parágrafo."""
    if not raw:
        return ""
    text = _BREAK.sub("\n", raw)
    text = _TAG.sub("", text)
    text = html.unescape(text).replace("\xa0", " ").replace("\r", "")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return _BLANK_LINES.sub("\n\n", text).strip()


def parse_date(value: str | None):
    """ISO do Movidesk → datetime com fuso. Data inválida vira `None`."""
    if not value:
        return None
    try:
        moment = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if timezone.is_naive(moment):
        return timezone.make_aware(moment)
    return moment


def _lookup(table, value, default):
    return table.get((value or "").strip().lower(), default)


def _import_email(name: str) -> str:
    """E-mail sintético e obviamente falso para o cliente importado.

    O export não traz e-mail, e `User.email` é único e obrigatório. O domínio
    `.invalid` é reservado pela RFC 2606 justamente para isto: nunca resolve,
    então nenhuma notificação sai por engano para um endereço inventado.
    """
    base = slugify(name) or "cliente"
    local, counter = base, 2
    while User.objects.filter(email=f"{local}@movidesk.invalid").exists():
        local, counter = f"{base}-{counter}", counter + 1
    return f"{local}@movidesk.invalid"


@dataclass
class ImportReport:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    messages: int = 0
    companies: list[str] = field(default_factory=list)
    people: list[str] = field(default_factory=list)
    categories: list[str] = field(default_factory=list)
    teams: list[str] = field(default_factory=list)
    # nome do responsável no Movidesk → quantos tickets ficaram sem dono por isso
    unmatched_agents: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def as_lines(self) -> list[str]:
        return [
            f"tickets criados: {self.created}",
            f"tickets já existentes (atualizados): {self.updated}",
            f"tickets ignorados: {self.skipped}",
            f"mensagens importadas: {self.messages}",
            f"empresas criadas: {len(self.companies)}",
            f"pessoas criadas: {len(self.people)}",
            f"categorias criadas: {len(self.categories)}",
            f"equipes criadas: {len(self.teams)}",
        ]

    def warning_lines(self) -> list[str]:
        """Um aviso por CAUSA, não por ticket.

        O mesmo agente ausente gerava uma linha idêntica em cada chamado dele —
        27 linhas repetidas escondendo o resto do relatório. Agrupado, o aviso
        vira acionável: diz o nome, quantos chamados e o que fazer.
        """
        lines = list(self.warnings)
        for name, total in sorted(
            self.unmatched_agents.items(), key=lambda item: -item[1]
        ):
            lines.append(
                f"“{name}” respondia por {total} chamado(s) e não existe como usuário "
                f"interno, e esses chamados ficaram sem responsável. Cadastre em Configurações → "
                f"Usuários com esse nome exato e rode a importação de novo."
            )
        return lines


def from_csv(linhas) -> list[dict]:
    """Remonta os tickets a partir do CSV achatado (uma linha por mensagem).

    A chave é o `ticket_id`: linhas com o mesmo id são o mesmo chamado, e o que
    varia entre elas são as quatro colunas de ação. A ordem de chegada é
    preservada — o exportador já escreve as ações na ordem em que aconteceram.
    """
    tickets: dict[str, dict] = {}
    for linha in linhas:
        identificador = (linha.get("ticket_id") or "").strip()
        if not identificador:
            continue

        ticket = tickets.get(identificador)
        if ticket is None:
            cliente = (linha.get("cliente") or "").strip()
            responsavel = (linha.get("responsavel") or "").strip()
            ticket = tickets[identificador] = {
                "id": identificador,
                "subject": (linha.get("assunto") or "").strip(),
                "category": (linha.get("categoria") or "").strip() or None,
                "urgency": (linha.get("urgencia") or "").strip() or None,
                "status": (linha.get("status") or "").strip() or None,
                "createdDate": (linha.get("aberto_em") or "").strip() or None,
                "resolvedIn": (linha.get("resolvido_em") or "").strip() or None,
                "closedIn": (linha.get("fechado_em") or "").strip() or None,
                "clients": [{"businessName": cliente}] if cliente else [],
                "owner": {"businessName": responsavel} if responsavel else None,
                "actions": [],
            }

        texto = (linha.get("acao_texto") or "").strip()
        if not texto:
            continue  # linha de ticket sem mensagem nenhuma
        rotulo = (linha.get("acao_canal") or "").strip().lower()
        ticket["actions"].append({
            "description": texto,
            "origin": ORIGEM_POR_ROTULO.get(rotulo),
            "createdDate": (linha.get("acao_data") or "").strip() or None,
            "createdBy": {"businessName": (linha.get("acao_autor") or "").strip()},
        })

    return list(tickets.values())


def most_recent(tickets: list[dict], limit: int | None) -> list[dict]:
    """Os `limit` mais recentes por data de abertura.

    Ordena aqui em vez de confiar na ordem do arquivo: o exportador concatena
    duas rotas da API (`tickets` e `tickets/past`), então o JSON chega em duas
    sequências, não em uma linha do tempo.
    """
    ordered = sorted(
        tickets,
        key=lambda t: parse_date(t.get("createdDate")) or timezone.make_aware(dt.datetime.min),
        reverse=True,
    )
    return ordered[:limit] if limit else ordered


class _Directory:
    """Cria (uma vez) empresas, pessoas e categorias conforme aparecem.

    O export do Movidesk traz nomes, não identificadores — então o nome é a
    chave. Duas pessoas homônimas viram uma só; é o limite do que o arquivo
    permite, e está registrado no relatório da importação.
    """

    def __init__(
        self, plan: Plan, report: ImportReport, agent_names: set[str], default_team: Team
    ):
        self.plan = plan
        self.report = report
        self.default_team = default_team
        # nomes que aparecem como RESPONSÁVEL em algum ticket do arquivo. É a
        # única evidência de "esta pessoa é do atendimento" que o export dá, e
        # ela vem do próprio dado — ver `is_agent_name`.
        self.agent_names = {n.strip().lower() for n in agent_names if n}
        self._companies: dict[str, Company] = {}
        self._people: dict[str, User] = {}
        self._agents: dict[str, User] = {}
        self._categories: dict[str, TicketCategory] = {}
        self._teams: dict[str, Team] = {}

    def is_agent_name(self, name: str) -> bool:
        """Este nome é de alguém do atendimento?

        Vale mesmo sem usuário interno cadastrado: quem responde por um ticket
        em algum ponto do arquivo é do time. Sem isto, a resposta de um agente
        não cadastrado entrava como mensagem do CLIENTE e o ticket ficava
        eternamente "sem 1ª resposta" — visto na tela antes de virar esta linha.
        """
        return name.strip().lower() in self.agent_names

    def company(self, name: str) -> Company:
        """Empresa pelo nome da ORGANIZAÇÃO do contato.

        Sem nome de organização cai no balde `Sem empresa` — nunca se cria
        empresa a partir do nome de uma pessoa. Era o que acontecia antes, e
        enchia a listagem de "empresas" Platinum com um usuário só, cada uma
        sendo na verdade um contato solto do sistema antigo.
        """
        if not name.strip():
            return self.balde()
        key = name.strip().lower()
        if key not in self._companies:
            existing = Company.objects.filter(name__iexact=name).first()
            if existing is None:
                existing = Company.objects.create(
                    name=name, slug=unique_slug(Company, name, fallback="empresa"),
                    plan=self.plan,
                )
                self.report.companies.append(name)
            self._companies[key] = existing
        return self._companies[key]

    def balde(self) -> Company:
        """A empresa de espera para contato importado sem organização.

        É área de triagem, não cliente: alguém do atendimento move a pessoa
        para a empresa certa depois. Fica inativa para não aparecer em seletor
        de abertura de chamado.
        """
        if BALDE_SLUG not in self._companies:
            empresa, _ = Company.objects.get_or_create(
                slug=BALDE_SLUG,
                defaults={"name": BALDE_NOME, "plan": self.plan, "is_active": False},
            )
            self._companies[BALDE_SLUG] = empresa
        return self._companies[BALDE_SLUG]

    def person(self, name: str, company: Company) -> User:
        key = name.strip().lower()
        if key not in self._people:
            existing = User.objects.filter(full_name__iexact=name, kind=UserKind.CLIENT).first()
            if existing is None:
                existing = User.objects.create_user(
                    email=_import_email(name), full_name=name, kind=UserKind.CLIENT,
                    company=company, client_role=ClientRole.MEMBER,
                    # Quem está no balde entra INATIVO, e isso é trava de
                    # isolamento, não capricho: no balde todo mundo divide a
                    # mesma empresa, e cliente enxerga os chamados da própria
                    # empresa. Ativar alguém aqui dentro o faria ver o chamado
                    # dos outros — ativar tem que vir junto de mover para a
                    # empresa de verdade.
                    is_active=company.slug != BALDE_SLUG,
                )
                self.report.people.append(name)
            self._people[key] = existing
        return self._people[key]

    def agent(self, name: str) -> User | None:
        """Interno com este nome, se já existir. Importação NÃO cria agente.

        Criar usuário interno é criar acesso à área interna — não é efeito
        colateral aceitável de uma importação de dados. Sem correspondência, a
        mensagem fica sem autor (o modelo já aceita: é o caso de mensagem de
        sistema) e o fato entra no relatório.
        """
        key = name.strip().lower()
        if key not in self._agents:
            self._agents[key] = User.objects.filter(
                full_name__iexact=name, kind=UserKind.INTERNAL
            ).first()
        return self._agents[key]

    def team(self, name: str | None) -> Team:
        """A equipe do ticket no Movidesk (`ownerTeam`), pelo nome.

        Quem já usa "Suporte" e "Comercial" lá quer os chamados nas mesmas
        equipes aqui — não todos numa só. Equipe que ainda não existe é
        criada com o mesmo nome (equipe não é acesso: é só o recorte da fila;
        supervisor e visibilidade a pessoa ajusta depois em Configurações).
        Sem nome, cai na equipe padrão escolhida na tela.
        """
        if not name or not str(name).strip():
            return self.default_team
        limpo = str(name).strip()[:80]
        key = limpo.lower()
        if key not in self._teams:
            existing = Team.objects.filter(name__iexact=limpo).first()
            if existing is None:
                existing = Team.objects.create(
                    name=limpo, slug=unique_slug(Team, limpo, fallback="equipe")
                )
                self.report.teams.append(limpo)
            self._teams[key] = existing
        return self._teams[key]

    def category(self, name: str | None) -> TicketCategory | None:
        if not name or not name.strip():
            return None
        key = name.strip().lower()
        if key not in self._categories:
            existing = TicketCategory.objects.filter(name__iexact=name.strip()).first()
            if existing is None:
                existing = TicketCategory.objects.create(
                    name=name.strip()[:60],
                    slug=unique_slug(TicketCategory, name, fallback="categoria"),
                )
                self.report.categories.append(name.strip())
            self._categories[key] = existing
        return self._categories[key]


def _ticket_source(actions) -> str:
    """Canal do ticket, tirado da PRIMEIRA ação — que é como ele entrou.

    Sem isto todo chamado importado aparecia como "Sistema" na fila, inclusive
    os que chegaram por WhatsApp. O canal é o que o agente olha para saber o
    que esperar da conversa.
    """
    if not actions:
        return TicketSource.WEB
    primeira = min(actions, key=lambda a: a.get("createdDate") or "")
    return TicketSource.CHAT if primeira.get("origin") in CHAT_ORIGINS else TicketSource.WEB


def _message_source(origin) -> str:
    if origin in CHAT_ORIGINS:
        return MessageSource.CHAT
    if origin in AUTOMATIC_ORIGINS:
        return MessageSource.SYSTEM
    return MessageSource.WEB


def import_tickets(
    tickets: list[dict],
    *,
    team: Team,
    plan: Plan,
    limit: int | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> ImportReport:
    """Importa (ou atualiza) os tickets. Cada um em sua própria transação.

    `on_progress(feitos, total)` é chamado depois de cada ticket — é o que a
    tela de Configurações → Importar usa pra barra de progresso; a linha de
    comando não passa nada.
    """
    report = ImportReport()
    selecionados = most_recent(tickets, limit)
    total = len(selecionados)
    directory = _Directory(
        plan, report,
        agent_names={
            (raw.get("owner") or {}).get("businessName") or "" for raw in selecionados
        },
        default_team=team,
    )

    for i, raw in enumerate(selecionados, start=1):
        movidesk_id = raw.get("id")
        if movidesk_id in (None, ""):
            report.skipped += 1
            report.warnings.append("ticket sem id no arquivo, ignorado")
        else:
            with transaction.atomic():
                _import_one(raw, movidesk_id, directory, report)
        if on_progress is not None:
            on_progress(i, total)

    return report


def _import_one(raw, movidesk_id, directory, report) -> None:
    reference = f"{REFERENCE_PREFIX}-{movidesk_id}"
    created_at = parse_date(raw.get("createdDate")) or timezone.now()

    clients = raw.get("clients") or []
    primeiro = clients[0] if clients else {}
    client_name = (primeiro.get("businessName") or "") or "Cliente não informado"
    # A EMPRESA sai de `organization`, não do nome do contato. Sem isto, cada
    # pessoa importada virava uma empresa com ela dentro. Export antigo, feito
    # antes de pedirmos `organization`, não traz o campo: aí o contato fica no
    # balde e alguém do atendimento o move para a empresa certa depois.
    organizacao = ((primeiro.get("organization") or {}).get("businessName") or "").strip()
    company = directory.company(organizacao)
    requester = directory.person(client_name, company)

    status = _lookup(STATUS, raw.get("status"), TicketStatus.OPEN)
    closed_at = parse_date(raw.get("closedIn")) or parse_date(raw.get("resolvedIn"))
    if status == TicketStatus.CLOSED and closed_at is None:
        closed_at = created_at

    owner_name = (raw.get("owner") or {}).get("businessName") or ""
    assignee = directory.agent(owner_name) if owner_name else None
    if owner_name and assignee is None:
        report.unmatched_agents[owner_name] = report.unmatched_agents.get(owner_name, 0) + 1

    from apps.tickets.services.ticket_service import stage_padrao

    actions = raw.get("actions") or []
    fields = {
        "company": company,
        "requester": requester,
        "team": directory.team(_owner_team(raw)),
        "source": _ticket_source(actions),
        "subject": (raw.get("subject") or "(sem assunto)")[:200],
        "status": status,
        # status e stage andam juntos SEMPRE (invariante do modelo): sem a
        # coluna, o importado sumia do kanban e ordenava como nulo na fila
        "stage": stage_padrao(status),
        "priority": _lookup(URGENCY, raw.get("urgency"), TicketPriority.NORMAL),
        "category": directory.category(raw.get("category")),
        "assignee": assignee,
        "owner": assignee,
        "closed_at": closed_at,
        # o export do Movidesk NÃO traz o tempo técnico real de solução —
        # gravar created_at→closed_at aqui somava a VIDA INTEIRA do chamado
        # na franquia de manutenção do mês e abria chamados de estouro
        # falsos no Comercial. Sem o dado, o certo é ficar sem: métrica nula
        # é honesta, franquia inflada não.
        "resolution_started_at": None,
        "resolution_ended_at": None,
    }

    ticket = Ticket.objects.filter(reference=reference).first()
    if ticket is None:
        ticket = Ticket.objects.create(reference=reference, **fields)
        report.created += 1
    else:
        for name, value in fields.items():
            setattr(ticket, name, value)
        ticket.save(update_fields=list(fields))
        report.updated += 1
        # reimportar substitui o histórico em vez de empilhá-lo de novo
        ticket.messages.all().delete()
        ticket.status_events.all().delete()

    # created_at é auto_now_add: só um UPDATE recoloca a data original
    Ticket.objects.filter(pk=ticket.pk).update(created_at=created_at)
    ticket.created_at = created_at

    _import_actions(ticket, actions, directory, report)

    TicketStatusEvent.objects.create(
        ticket=ticket, from_status=None, to_status=TicketStatus.NEW,
    )
    TicketStatusEvent.objects.filter(ticket=ticket).update(created_at=created_at)
    if status != TicketStatus.NEW:
        event = TicketStatusEvent.objects.create(
            ticket=ticket, from_status=TicketStatus.NEW, to_status=status,
            note="Importado do Movidesk",
        )
        TicketStatusEvent.objects.filter(pk=event.pk).update(
            created_at=closed_at or created_at
        )


def _owner_team(raw) -> str | None:
    """`ownerTeam` é uma string na API; aceita também o objeto, por via das dúvidas."""
    valor = raw.get("ownerTeam")
    if isinstance(valor, dict):
        valor = valor.get("businessName") or valor.get("name")
    return valor


def _import_actions(ticket, actions, directory, report) -> None:
    """Cada ação vira uma mensagem; a primeira do agente define a 1ª resposta."""
    first_response_at = None
    last_customer_at = None
    last_agent_at = None

    ordered = sorted(actions, key=lambda a: a.get("createdDate") or "")
    for action in ordered:
        body = html_to_text(action.get("description"))
        if not body:
            continue

        author_name = (action.get("createdBy") or {}).get("businessName") or ""
        author = directory.agent(author_name) if author_name else None
        is_agent = author is not None or directory.is_agent_name(author_name)

        if author is None and not is_agent and author_name:
            # sobrou o cliente: o export não traz e-mail, então colegas da
            # mesma empresa são indistinguíveis e todos entram como o
            # solicitante — melhor do que criar uma conta fantasma por nome
            author = ticket.requester
        elif author is None and author_name:
            # agente sem cadastro: a mensagem fica SEM autor (o modelo já usa
            # isso para mensagem de sistema) e o nome vai no corpo. Pendurá-la
            # no solicitante seria pior: a conversa passaria a dizer que o
            # cliente respondeu a si mesmo.
            body = f"{author_name} (Movidesk):\n\n{body}"

        moment = parse_date(action.get("createdDate")) or ticket.created_at
        message = TicketMessage.objects.create(
            ticket=ticket, author=author, body=body, is_public=True,
            source=_message_source(action.get("origin")),
            is_first_response=is_agent and first_response_at is None,
        )
        TicketMessage.objects.filter(pk=message.pk).update(created_at=moment)
        report.messages += 1

        if is_agent:
            if first_response_at is None:
                first_response_at = moment
            last_agent_at = moment
        else:
            last_customer_at = moment

    Ticket.objects.filter(pk=ticket.pk).update(
        first_response_at=first_response_at,
        last_agent_message_at=last_agent_at,
        last_customer_message_at=last_customer_at,
    )
