"""GET /api/v1/settings/companies/: busca (`?q=`) e filtro de status
(`?is_active=`) de verdade no backend.

Antes desta rodada nenhum dos dois existia — o front pedia `?is_active=` e
`?q=` era nem sequer mandado, mas era a PRÓPRIA TELA que filtrava, sobre um
lote de até 100 empresas (`limit=100&offset=0` fixo). Empresa 101 em diante
era invisível pra busca e pro filtro de status; e o Select de status não
fazia NADA no servidor. Este teste cobre o contrato novo: quem decide agora
é a query, não a tela.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, CompanyDomain, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def api(admin):
    client = APIClient()
    client.force_authenticate(user=admin)
    return client


@pytest.fixture
def acme(plan):
    return Company.objects.create(
        name="Acme Ltda", legal_name="Acme Comércio Ltda", slug="acme", plan=plan,
    )


@pytest.fixture
def bravo(plan):
    return Company.objects.create(
        name="Bravo SA", legal_name="Bravo Indústria SA", slug="bravo", plan=plan, is_active=False,
    )


class TestBusca:
    def test_busca_por_nome(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?q=acme")
        nomes = [c["name"] for c in resp.json()["results"]]
        assert nomes == ["Acme Ltda"]

    def test_busca_por_razao_social(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?q=Indústria")
        nomes = [c["name"] for c in resp.json()["results"]]
        assert nomes == ["Bravo SA"]

    def test_busca_por_slug(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?q=bravo")
        assert [c["name"] for c in resp.json()["results"]] == ["Bravo SA"]

    def test_busca_por_dominio(self, api, acme, bravo):
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        resp = api.get("/api/v1/settings/companies/?q=acme.com.br")
        assert [c["name"] for c in resp.json()["results"]] == ["Acme Ltda"]

    def test_dois_dominios_batendo_nao_duplicam_a_linha(self, api, acme):
        # Fan-out do JOIN é o bug que a subquery evita — duas linhas de
        # domínio da MESMA empresa batendo a busca não podiam virar 2 linhas.
        CompanyDomain.objects.create(company=acme, domain="acme.com.br")
        CompanyDomain.objects.create(company=acme, domain="acme.com")
        resp = api.get("/api/v1/settings/companies/?q=acme")
        assert len(resp.json()["results"]) == 1

    def test_sem_bater_em_nada_devolve_lista_vazia(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?q=nao-existe")
        assert resp.json()["results"] == []


class TestFiltroDeStatus:
    def test_is_active_true_so_traz_ativas(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?is_active=true")
        assert [c["name"] for c in resp.json()["results"]] == ["Acme Ltda"]

    def test_is_active_false_so_traz_inativas(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/?is_active=false")
        assert [c["name"] for c in resp.json()["results"]] == ["Bravo SA"]

    def test_sem_o_parametro_traz_as_duas(self, api, acme, bravo):
        resp = api.get("/api/v1/settings/companies/")
        assert resp.json()["count"] == 2


class TestPaginacaoDeVerdade:
    def test_limit_e_offset_navegam_a_lista_inteira(self, api, plan):
        Company.objects.bulk_create(
            [Company(name=f"Empresa {i:03d}", slug=f"empresa-{i}", plan=plan) for i in range(3)]
        )
        pagina1 = api.get("/api/v1/settings/companies/?limit=2&offset=0").json()
        pagina2 = api.get("/api/v1/settings/companies/?limit=2&offset=2").json()
        assert pagina1["count"] == 3
        assert [c["name"] for c in pagina1["results"]] == ["Empresa 000", "Empresa 001"]
        assert [c["name"] for c in pagina2["results"]] == ["Empresa 002"]


class TestCabecalhoDoCliente360:
    """Os fatos do cabeçalho da página da empresa: quem é o gerente de conta
    (nome, não id) e desde quando a empresa está no cadastro."""

    def test_nome_do_gerente_de_conta(self, api, acme, admin):
        acme.account_manager = admin
        acme.save(update_fields=["account_manager"])

        corpo = api.get(f"/api/v1/settings/companies/{acme.pk}/").json()

        assert corpo["account_manager"] == admin.pk
        assert corpo["account_manager_name"] == "Alice"

    def test_sem_gerente_o_nome_vem_nulo(self, api, acme):
        corpo = api.get(f"/api/v1/settings/companies/{acme.pk}/").json()

        assert corpo["account_manager"] is None
        assert corpo["account_manager_name"] is None

    def test_data_de_cadastro_vem_e_nao_e_editavel(self, api, acme):
        original = api.get(f"/api/v1/settings/companies/{acme.pk}/").json()["created_at"]
        assert original

        resp = api.patch(
            f"/api/v1/settings/companies/{acme.pk}/",
            {"created_at": "2001-01-01T00:00:00Z"},
            format="json",
        )

        assert resp.status_code == 200
        assert resp.json()["created_at"] == original

    def test_nome_do_gerente_vem_no_join_e_nao_por_linha(self, api, plan, admin):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        for i in range(3):
            Company.objects.create(
                name=f"Empresa {i}", slug=f"empresa-{i}", plan=plan, account_manager=admin,
            )
        with CaptureQueriesContext(connection) as contexto:
            corpo = api.get("/api/v1/settings/companies/").json()

        assert {c["account_manager_name"] for c in corpo["results"]} == {"Alice"}
        # Nenhuma ida à tabela de usuários só para ler o nome do gerente: ele
        # vem no JOIN da consulta da lista (`select_related`).
        por_linha = [
            q["sql"] for q in contexto.captured_queries
            if q["sql"].lstrip().upper().startswith("SELECT")
            and 'FROM "accounts_user"' in q["sql"]
        ]
        assert por_linha == []
