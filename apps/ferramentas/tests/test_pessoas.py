"""Importação de pessoas: empresas, contatos e agentes a partir do `/persons`.

O que precisa ficar provado:
- empresa casa por CNPJ, senão por nome, e é criada com o plano escolhido;
- contato vai pra empresa do `relationships[]`; sem empresa, fica no balde
  inativo; o e-mail sintético da importação de tickets vira o e-mail real;
- agente entra DESATIVADO, com as equipes de `teams[]`; sem e-mail não entra;
  quem já existe não tem acesso nem e-mail mexidos;
- rodar de novo não duplica nem desfaz o que a equipe ajustou à mão.
"""

import pytest

from apps.accounts.models import AgentTeam, ClientRole, InternalRole, Team, User, UserKind
from apps.customers.models import Company
from apps.ferramentas import pessoas as svc
from apps.tickets.services.movidesk import BALDE_SLUG

pytestmark = pytest.mark.django_db


def empresa(pid, nome, cnpj="", razao="", ativa=True):
    return {
        "id": pid,
        "personType": 2,
        "profileType": 2,
        "businessName": nome,
        "corporateName": razao,
        "cpfCnpj": cnpj,
        "isActive": ativa,
    }


def contato(pid, nome, *, email=None, empresa_id=None, fones=(), cargo="", ativo=True):
    return {
        "id": pid,
        "personType": 1,
        "profileType": 2,
        "businessName": nome,
        "role": cargo,
        "isActive": ativo,
        "emails": [{"emailType": "Profissional", "email": email, "isDefault": True}]
        if email
        else [],
        "contacts": [
            {"contactType": "Telefone", "contact": f, "isDefault": i == 0}
            for i, f in enumerate(fones)
        ],
        "relationships": [{"id": empresa_id}] if empresa_id else [],
    }


def agente(pid, nome, *, email=None, equipes=()):
    return {
        "id": pid,
        "personType": 1,
        "profileType": 1,
        "businessName": nome,
        "isActive": True,
        "emails": [{"emailType": "Profissional", "email": email, "isDefault": True}]
        if email
        else [],
        "teams": list(equipes),
    }


class TestEmpresas:
    def test_cria_com_o_plano_e_casa_por_cnpj_ou_nome(self, plano):
        ja = Company.objects.create(
            name="Beta Ltda", slug="beta", plan=plano, tax_id="11222333000181"
        )
        r = svc.importar_pessoas(
            [
                empresa("1", "Acme", cnpj="12.345.678/0001-90", razao="Acme Comércio Ltda"),
                # nome diferente, mesmo CNPJ → é a Beta
                empresa("2", "BETA COMERCIO", cnpj="11.222.333/0001-81"),
                # sem CNPJ, nome igual em caixa diferente → é a Beta também
                empresa("3", "beta ltda", razao="Beta Comércio Ltda"),
            ],
            plan=plano,
        )
        acme = Company.objects.get(name="Acme")
        assert acme.plan == plano and acme.tax_id == "12345678000190"
        assert acme.legal_name == "Acme Comércio Ltda" and acme.slug == "acme"
        ja.refresh_from_db()
        assert ja.legal_name == "Beta Comércio Ltda"  # completou o que faltava
        assert Company.objects.count() == 2
        assert r.empresas_criadas == 1 and r.empresas_atualizadas == 1

    def test_departamento_e_ignorado_com_aviso(self, plano):
        r = svc.importar_pessoas([{"id": "9", "personType": 3, "businessName": "TI"}], plan=plano)
        assert r.ignorados == 1 and r.departamentos == 1
        assert any("departamento" in a for a in r.warning_lines())
        assert Company.objects.count() == 0


class TestContatos:
    def test_vai_para_a_empresa_do_relacionamento_com_email_e_telefones(self, plano):
        r = svc.importar_pessoas(
            [
                empresa("10", "Acme"),
                contato(
                    "11",
                    "Ana Almeida",
                    email="Ana@Acme.com.br",
                    empresa_id="10",
                    fones=("11 99999-0000", "11 3333-0000"),
                    cargo="Compras",
                ),
            ],
            plan=plano,
        )
        ana = User.objects.get(email="ana@acme.com.br")
        assert ana.kind == UserKind.CLIENT and ana.client_role == ClientRole.MEMBER
        assert ana.company.name == "Acme" and ana.is_active
        assert ana.phone == "11 99999-0000" and ana.phone_secondary == "11 3333-0000"
        assert ana.job_title == "Compras"
        assert r.contatos_criados == 1

    def test_sem_empresa_espera_no_balde_inativo(self, plano):
        svc.importar_pessoas([contato("12", "Solto Silva", email="s@x.test")], plan=plano)
        solto = User.objects.get(email="s@x.test")
        assert solto.company.slug == BALDE_SLUG and not solto.is_active

    def test_sem_email_ganha_o_sintetico_e_nao_quebra(self, plano):
        svc.importar_pessoas(
            [empresa("10", "Acme"), contato("13", "Sem Email", empresa_id="10")], plan=plano
        )
        u = User.objects.get(full_name="Sem Email")
        assert u.email.endswith("@movidesk.invalid") and u.company.name == "Acme"

    def test_completa_quem_a_importacao_de_tickets_criou_so_com_o_nome(self, plano):
        # a importação de tickets deixa e-mail sintético e a pessoa no balde
        balde = Company.objects.create(
            name="Sem empresa", slug=BALDE_SLUG, plan=plano, is_active=False
        )
        antigo = User.objects.create_user(
            email="ana-almeida@movidesk.invalid",
            full_name="Ana Almeida",
            kind=UserKind.CLIENT,
            company=balde,
            client_role=ClientRole.MEMBER,
            is_active=False,
        )
        r = svc.importar_pessoas(
            [
                empresa("10", "Acme"),
                contato("11", "ana almeida", email="ana@acme.com.br", empresa_id="10"),
            ],
            plan=plano,
        )
        antigo.refresh_from_db()
        assert antigo.email == "ana@acme.com.br"
        assert antigo.company.name == "Acme" and antigo.is_active
        assert User.objects.filter(full_name__iexact="Ana Almeida").count() == 1
        assert r.contatos_criados == 0 and r.contatos_atualizados == 1

    def test_nao_move_quem_a_equipe_ja_posicionou_nem_troca_email_real(self, plano):
        certa = Company.objects.create(name="Certa", slug="certa", plan=plano)
        u = User.objects.create_user(
            email="ana@certa.test",
            full_name="Ana Almeida",
            kind=UserKind.CLIENT,
            company=certa,
            client_role=ClientRole.MEMBER,
            phone="11 1111-1111",
        )
        svc.importar_pessoas(
            [
                empresa("10", "Acme"),
                contato(
                    "11", "Ana Almeida", email="outro@acme.com.br", empresa_id="10", fones=("22",)
                ),
            ],
            plan=plano,
        )
        u.refresh_from_db()
        assert u.company == certa and u.email == "ana@certa.test" and u.phone == "11 1111-1111"
        assert not User.objects.filter(email="outro@acme.com.br").exists()

    def test_email_de_usuario_interno_nao_vira_contato(self, plano, admin):
        r = svc.importar_pessoas([contato("14", "Alice", email="admin@x.test")], plan=plano)
        assert r.ignorados == 1 and any("interno" in a for a in r.avisos)
        assert User.objects.get(email="admin@x.test").kind == UserKind.INTERNAL


class TestAgentes:
    def test_entra_desativado_com_as_equipes(self, plano):
        Team.objects.create(name="Suporte", slug="suporte")
        r = svc.importar_pessoas(
            [agente("20", "Samuel Souza", email="sam@x.test", equipes=["suporte", "Infra"])],
            plan=plano,
        )
        sam = User.objects.get(email="sam@x.test")
        assert sam.kind == UserKind.INTERNAL and sam.internal_role == InternalRole.AGENT
        assert not sam.is_active and not sam.has_usable_password()
        nomes = sorted(sam.teams.values_list("name", flat=True))
        assert nomes == ["Infra", "Suporte"]
        assert AgentTeam.objects.filter(user=sam, is_default=True).count() == 1
        assert r.agentes_criados == 1 and r.equipes == ["Infra"]
        assert any("DESATIVADOS" in a for a in r.warning_lines())

    def test_sem_email_nao_entra(self, plano):
        r = svc.importar_pessoas([agente("21", "Sem Email")], plan=plano)
        assert r.ignorados == 1 and any("não tem e-mail" in a for a in r.avisos)
        assert not User.objects.filter(full_name="Sem Email").exists()

    def test_existente_por_nome_so_ganha_equipes(self, plano):
        sam = User.objects.create_user(
            email="samuel@empresa.test",
            full_name="Samuel Souza",
            kind=UserKind.INTERNAL,
            internal_role=InternalRole.SUPERVISOR,
            is_active=True,
        )
        r = svc.importar_pessoas(
            [agente("20", "Samuel Souza", email="sam@movidesk.test", equipes=["Suporte"])],
            plan=plano,
        )
        sam.refresh_from_db()
        assert sam.email == "samuel@empresa.test" and sam.is_active
        assert sam.internal_role == InternalRole.SUPERVISOR
        assert list(sam.teams.values_list("name", flat=True)) == ["Suporte"]
        assert r.agentes_criados == 0 and r.agentes_atualizados == 1
        assert not User.objects.filter(email="sam@movidesk.test").exists()

    def test_criar_agentes_desligado_pula(self, plano):
        r = svc.importar_pessoas(
            [agente("20", "Samuel", email="sam@x.test")], plan=plano, criar_agentes=False
        )
        assert r.agentes_pulados == 1 and not User.objects.filter(email="sam@x.test").exists()
        assert any("desligado" in a for a in r.warning_lines())

    def test_agente_cujo_email_ja_e_cliente_nao_e_promovido(self, plano, cliente):
        r = svc.importar_pessoas([agente("22", "Ana", email="ana@acme.test")], plan=plano)
        assert r.ignorados == 1 and any("já é um cliente" in a for a in r.avisos)
        assert User.objects.get(email="ana@acme.test").kind == UserKind.CLIENT


class TestRodadaInteira:
    def test_reimportar_nao_duplica_e_um_registro_ruim_nao_derruba_o_resto(self, plano):
        lote = [
            empresa("10", "Acme", cnpj="12345678000190"),
            {"id": "99", "personType": 2},  # sem nome
            contato("11", "Ana", email="ana@acme.com.br", empresa_id="10"),
            agente("20", "Sam", email="sam@x.test", equipes=["Suporte"]),
        ]
        feitos = []
        r1 = svc.importar_pessoas(lote, plan=plano, on_progress=lambda f, t: feitos.append((f, t)))
        r2 = svc.importar_pessoas(lote, plan=plano)
        assert feitos[-1] == (4, 4)
        assert r1.ignorados == 1 and "sem nome" in r1.avisos[0]
        assert Company.objects.count() == 1 and User.objects.count() == 2
        assert Team.objects.filter(name="Suporte").count() == 1
        assert r2.empresas_criadas == r2.contatos_criados == r2.agentes_criados == 0
        assert r2.agentes_atualizados == 1
        assert "empresas criadas: 1" in r1.as_lines()
