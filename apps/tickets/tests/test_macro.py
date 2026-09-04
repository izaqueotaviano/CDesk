"""Macro de chamado — texto pronto + triagem de um clique (Fase 3 do prompt
de integração, GAPS.md #6: achado como gap, decisão registrada de criar
`TicketMacro` espelhando `ChatMacro`).

Duas frentes: o CRUD (`settings/ticket-macros/`, mesmo contrato de
`test_services.py`/`test_categories.py`) e o efeito de aplicar
(`POST tickets/{id}/apply-macro/`, espelhando
`chat/tests/test_api_v2.py::TestMacro`)."""

import pytest

from apps.tickets.models import TicketCategory, TicketMacro, TicketTag
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def estoque(db):
    return TicketCategory.objects.create(name="Estoque", slug="estoque")


class TestMacroAdmin:
    def test_admin_cria(self, api, admin):
        resp = api(admin).post("/api/v1/settings/ticket-macros/", {
            "name": "Estoque parado",
            "body": "Vou verificar a sincronização de estoque...",
        }, format="json")
        assert resp.status_code == 201
        assert resp.json()["body"] == "Vou verificar a sincronização de estoque..."

    def test_agente_le_mas_nao_escreve(self, api, agente_suporte):
        TicketMacro.objects.create(name="X")
        assert api(agente_suporte).get("/api/v1/settings/ticket-macros/").status_code == 200
        assert api(agente_suporte).post(
            "/api/v1/settings/ticket-macros/", {"name": "Y"}, format="json"
        ).status_code == 403

    def test_cliente_nao_alcanca(self, api, ana):
        assert api(ana).get("/api/v1/settings/ticket-macros/").status_code == 403

    def test_nome_e_unico(self, api, admin):
        TicketMacro.objects.create(name="Repetida")
        resp = api(admin).post(
            "/api/v1/settings/ticket-macros/", {"name": "Repetida"}, format="json"
        )
        assert resp.status_code == 400


class TestAplicarMacro:
    def test_preenche_sem_apagar_o_que_ja_existe(
        self, api, agente_suporte, ana, suporte, make_ticket, estoque,
    ):
        """"Soma, não zera": categoria estava vazia (preenche), urgência já
        tinha valor mas a macro tem outro (sobrescreve — só o vazio é
        protegido), etiquetas somam às que o agente já tinha marcado."""
        etiqueta_ja_marcada = TicketTag.objects.create(name="VIP", slug="vip")
        etiqueta_da_macro = TicketTag.objects.create(
            name="Urgente-estoque", slug="urgente-estoque"
        )
        macro = TicketMacro.objects.create(
            name="Estoque parado",
            body="Vou verificar a sincronização de estoque...",
            category=estoque, priority="urgent",
        )
        macro.tags.add(etiqueta_da_macro)

        ticket = make_ticket(requester=ana, team=suporte)
        ticket.priority = "low"
        ticket.save(update_fields=["priority"])
        ticket.tags.add(etiqueta_ja_marcada)

        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["category"] == estoque.pk
        assert corpo["priority"] == "urgent"
        assert {t["name"] for t in corpo["tags"]} == {"VIP", "Urgente-estoque"}

    def test_nao_mexe_no_que_a_macro_deixa_vazio(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        macro = TicketMacro.objects.create(name="Só urgência", priority="high")
        ticket = make_ticket(requester=ana, team=suporte)
        ticket_service.assign(ticket=ticket, assignee=agente_suporte, actor=agente_suporte)

        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["priority"] == "high"
        assert corpo["assignee_id"] == agente_suporte.pk  # não zerou

    def test_macro_inativa_nao_aplica(self, api, agente_suporte, ana, suporte, make_ticket):
        macro = TicketMacro.objects.create(name="Desativada", priority="high", is_active=False)
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 400

    def test_macro_inexistente_400(self, api, agente_suporte, ana, suporte, make_ticket):
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": 999999}, format="json",
        )
        assert resp.status_code == 400

    def test_cliente_nao_aplica_macro(self, api, ana, suporte, make_ticket):
        macro = TicketMacro.objects.create(name="X", priority="high")
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 403

    def test_grava_no_historico(self, api, agente_suporte, ana, suporte, make_ticket):
        macro = TicketMacro.objects.create(name="Registrada", priority="high")
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        ultimo = ticket.status_events.latest("id")
        assert "Registrada" in ultimo.note

    def test_nada_muda_nao_grava_evento_novo(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        """Macro sem nenhum campo preenchido não é erro — só não faz nada
        (mesmo espírito idempotente de `reclassify()`: sem mudança, sem
        evento de histórico novo)."""
        macro = TicketMacro.objects.create(name="Vazia")
        ticket = make_ticket(requester=ana, team=suporte)
        antes = ticket.status_events.count()
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 200
        assert ticket.status_events.count() == antes
