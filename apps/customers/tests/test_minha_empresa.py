"""A empresa como o próprio cliente a vê e edita (Configurações → Empresa).

Nunca um id na URL: é sempre a empresa de quem pede. Quem lê é qualquer
pessoa da empresa; quem edita é só o responsável — e só razão social e
CNPJ, com trilha de auditoria (é dado fiscal).
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import ClientRole, InternalRole, User, UserKind
from apps.audit.models import AuditAction, AuditLog
from apps.customers.models import Company, CompanyDomain, Plan

pytestmark = pytest.mark.django_db

URL = "/api/v1/me/company/"


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def gerente(db):
    return User.objects.create_user(
        email="gerente@x.test", full_name="Gabriela Gerente", kind=UserKind.INTERNAL,
        internal_role=InternalRole.SUPERVISOR,
    )


@pytest.fixture
def acme(plan, gerente):
    empresa = Company.objects.create(
        name="Acme", slug="acme", plan=plan, legal_name="Acme Marketing Ltda",
        tax_id="12.345.678/0001-90", account_manager=gerente,
    )
    CompanyDomain.objects.create(company=empresa, domain="acme.test")
    return empresa


@pytest.fixture
def bravo(plan):
    return Company.objects.create(
        name="Bravo", slug="bravo", plan=plan, tax_id="99.999.999/0001-99",
    )


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def olga(acme):
    return User.objects.create_user(
        email="olga@acme.test", full_name="Olga", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.OWNER,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


class TestLeitura:
    def test_membro_le_a_propria_empresa(self, api, ana, acme):
        dados = api(ana).get(URL).json()
        assert dados["name"] == "Acme"
        assert dados["legal_name"] == "Acme Marketing Ltda"
        assert dados["tax_id"] == "12.345.678/0001-90"
        assert dados["plan_name"] == "Gold"
        assert dados["account_manager_name"] == "Gabriela Gerente"
        assert dados["members"] == 1
        assert dados["domains"] == ["acme.test"]

    def test_interno_nao_tem_empresa_cliente(self, api, gerente):
        assert api(gerente).get(URL).status_code == 403

    def test_anonimo_barrado(self):
        assert APIClient().get(URL).status_code in (401, 403)


class TestEdicao:
    def test_responsavel_edita_razao_social_e_cnpj_com_auditoria(self, api, olga, acme):
        resp = api(olga).patch(
            URL, {"legal_name": "Acme Marketing S.A.", "tax_id": "11.222.333/0001-44"},
            format="json",
        )
        assert resp.status_code == 200, resp.json()
        acme.refresh_from_db()
        assert acme.legal_name == "Acme Marketing S.A."
        assert acme.tax_id == "11.222.333/0001-44"

        trilha = AuditLog.objects.get(actor=olga, action=AuditAction.UPDATE)
        assert trilha.changes == {
            "legal_name": ["Acme Marketing Ltda", "Acme Marketing S.A."],
            "tax_id": ["12.345.678/0001-90", "11.222.333/0001-44"],
        }

    def test_membro_comum_so_le(self, api, ana, acme):
        resp = api(ana).patch(URL, {"legal_name": "Outra"}, format="json")
        assert resp.status_code == 403
        acme.refresh_from_db()
        assert acme.legal_name == "Acme Marketing Ltda"

    def test_nome_fantasia_e_plano_nao_mudam_por_aqui(self, api, olga, acme):
        """São decisão da administração: o corpo pode até trazer, é ignorado."""
        resp = api(olga).patch(URL, {"name": "Hackeada", "plan_name": "Platinum"}, format="json")
        assert resp.status_code == 200
        acme.refresh_from_db()
        assert acme.name == "Acme"
        assert acme.plan.name == "Gold"
        assert not AuditLog.objects.filter(actor=olga).exists()  # nada mudou, nada na trilha

    def test_cnpj_de_outra_empresa_e_recusado(self, api, olga, bravo):
        resp = api(olga).patch(URL, {"tax_id": bravo.tax_id}, format="json")
        assert resp.status_code == 400
        assert "outra empresa" in resp.json()["tax_id"][0]

    def test_cnpj_vazio_vira_nulo(self, api, olga, acme):
        """`unique=True, null=True`: duas empresas sem CNPJ não podem colidir."""
        resp = api(olga).patch(URL, {"tax_id": "  "}, format="json")
        assert resp.status_code == 200
        acme.refresh_from_db()
        assert acme.tax_id is None

    def test_mesmo_valor_nao_gera_trilha(self, api, olga, acme):
        api(olga).patch(URL, {"legal_name": acme.legal_name}, format="json")
        assert not AuditLog.objects.filter(actor=olga).exists()
