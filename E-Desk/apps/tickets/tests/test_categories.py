"""Categoria do ticket: cadastro pelo admin e classificação na abertura.

A lista é do negócio (cadastrável como equipe), não do código. Opcional
de propósito: chute na abertura vira indicador ruim — sem categoria o ticket
conta como "Não informada".
"""

import pytest

from apps.tickets.models import TicketCategory

pytestmark = pytest.mark.django_db


@pytest.fixture
def duvida(db):
    return TicketCategory.objects.create(name="Dúvida", slug="duvida")


class TestCategoryAdmin:
    def test_admin_creates_with_derived_slug(self, api, admin):
        resp = api(admin).post("/api/v1/settings/categories/",
                               {"name": "Solicitação de serviço"}, format="json")
        assert resp.status_code == 201
        assert resp.json()["slug"] == "solicitacao-de-servico"

    def test_slug_stays_unique(self, api, admin):
        a = api(admin).post("/api/v1/settings/categories/", {"name": "Problema"},
                            format="json").json()
        b = api(admin).post("/api/v1/settings/categories/", {"name": "Problema!"},
                            format="json").json()
        assert a["slug"] != b["slug"]

    def test_agent_reads_but_cannot_write(self, api, agente_suporte, duvida):
        assert api(agente_suporte).get("/api/v1/settings/categories/").status_code == 200
        assert api(agente_suporte).post("/api/v1/settings/categories/", {"name": "X"},
                                        format="json").status_code == 403

    def test_client_cannot_reach_it(self, api, ana, duvida):
        assert api(ana).get("/api/v1/settings/categories/").status_code == 403

    def test_delete_deactivates_keeping_classification(self, api, admin, duvida,
                                                       make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        ticket.category = duvida
        ticket.save(update_fields=["category"])

        assert api(admin).delete(f"/api/v1/settings/categories/{duvida.pk}/").status_code == 204

        duvida.refresh_from_db()
        assert duvida.is_active is False
        ticket.refresh_from_db()
        assert ticket.category_id == duvida.pk  # histórico intacto


class TestCategoryOnTicket:
    def test_open_ticket_with_category(self, api, ana, suporte, duvida):
        resp = api(ana).post("/api/v1/tickets/", {
            "team_id": suporte.pk, "subject": "Como faço?",
            "body": "corpo", "category_id": duvida.pk,
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["category_name"] == "Dúvida"

    def test_category_is_optional(self, api, ana, suporte):
        resp = api(ana).post("/api/v1/tickets/", {
            "team_id": suporte.pk, "subject": "Sem categoria", "body": "corpo",
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["category_name"] is None

    def test_inactive_category_is_rejected(self, api, ana, suporte, duvida):
        duvida.is_active = False
        duvida.save(update_fields=["is_active"])
        resp = api(ana).post("/api/v1/tickets/", {
            "team_id": suporte.pk, "subject": "x", "body": "y",
            "category_id": duvida.pk,
        }, format="json")
        assert resp.status_code == 400
