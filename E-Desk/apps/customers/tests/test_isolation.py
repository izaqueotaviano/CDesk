"""Isolamento multi-tenant no app de clientes (Pilar 1 / 5).

O app não tinha nenhum teste. `CompanyViewSet` alimenta os filtros de relatório;
um cliente só pode ver a PRÓPRIA empresa — nunca listar as outras nem abrir a de
outra empresa pelo id (BOLA).
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import ClientRole, User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold")


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def bravo(plan):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.MEMBER,
    )


def _api(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


def _slugs(payload):
    rows = payload["results"] if isinstance(payload, dict) and "results" in payload else payload
    return {row["slug"] for row in rows}


class TestCompanyIsolation:
    def test_client_lists_only_own_company(self, ana, acme, bravo):
        data = _api(ana).get("/api/v1/companies/").json()
        assert _slugs(data) == {"acme"}

    def test_client_cannot_retrieve_other_company(self, ana, acme, bravo):
        # id de outra empresa: fora do escopo → 404, não vaza existência
        resp = _api(ana).get(f"/api/v1/companies/{bravo.pk}/")
        assert resp.status_code == 404

    def test_client_can_retrieve_own_company(self, ana, acme):
        resp = _api(ana).get(f"/api/v1/companies/{acme.pk}/")
        assert resp.status_code == 200
        assert resp.json()["slug"] == "acme"
