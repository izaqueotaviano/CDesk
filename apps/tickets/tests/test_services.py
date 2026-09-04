"""Serviço — nível acima de Categoria (GAPS.md #4).

Mesmo contrato de `test_categories.py`: cadastrável pelo admin, interno lê,
cliente não alcança, apagar desativa (o FK de Categoria é SET_NULL).
"""

import pytest

from apps.tickets.models import Service, TicketCategory

pytestmark = pytest.mark.django_db


@pytest.fixture
def integracoes(db):
    return Service.objects.create(name="Integrações", slug="integracoes")


class TestServiceAdmin:
    def test_admin_creates_with_derived_slug(self, api, admin):
        resp = api(admin).post("/api/v1/settings/services/", {"name": "Loja"}, format="json")
        assert resp.status_code == 201
        assert resp.json()["slug"] == "loja"

    def test_agent_reads_but_cannot_write(self, api, agente_suporte, integracoes):
        assert api(agente_suporte).get("/api/v1/settings/services/").status_code == 200
        assert api(agente_suporte).post(
            "/api/v1/settings/services/", {"name": "X"}, format="json"
        ).status_code == 403

    def test_client_cannot_reach_it(self, api, ana, integracoes):
        assert api(ana).get("/api/v1/settings/services/").status_code == 403

    def test_delete_deactivates_keeping_category_link(self, api, admin, integracoes):
        categoria = TicketCategory.objects.create(
            name="Estoque", slug="estoque", service=integracoes
        )
        assert api(admin).delete(
            f"/api/v1/settings/services/{integracoes.pk}/"
        ).status_code == 204

        integracoes.refresh_from_db()
        assert integracoes.is_active is False
        categoria.refresh_from_db()
        assert categoria.service_id == integracoes.pk  # classificação intacta


class TestCategoryExposesService:
    def test_public_category_list_includes_service(self, api, ana, integracoes):
        TicketCategory.objects.create(name="Estoque", slug="estoque", service=integracoes)
        resp = api(ana).get("/api/v1/categories/")
        linha = next(c for c in resp.json()["results"] if c["slug"] == "estoque")
        assert linha["service"] == integracoes.pk

    def test_ticket_exposes_service_name_derived_from_category(
        self, api, ana, suporte, integracoes
    ):
        categoria = TicketCategory.objects.create(
            name="Estoque", slug="estoque", service=integracoes
        )
        resp = api(ana).post("/api/v1/tickets/", {
            "team_id": suporte.pk, "subject": "Estoque zerado",
            "body": "corpo", "category_id": categoria.pk,
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["service_name"] == "Integrações"

    def test_ticket_without_category_has_no_service(self, api, ana, suporte):
        resp = api(ana).post("/api/v1/tickets/", {
            "team_id": suporte.pk, "subject": "Sem categoria", "body": "corpo",
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["service_name"] is None
