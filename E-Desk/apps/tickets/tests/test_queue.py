"""Fila de tickets: filtros da listagem e os indicadores que ela expõe."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import SLAPolicy, Ticket, TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def sla(plan_gold, suporte):
    return SLAPolicy.objects.create(
        name="SLA teste", plan=plan_gold, team=None,
        first_response_minutes=60, resolution_minutes=240,
        use_business_hours=False,
    )


class TestAssignmentFilter:
    def test_my_queue_and_unassigned(self, api, make_ticket, ana, suporte,
                                     agente_suporte, supervisor):
        mine = make_ticket(ana, suporte, subject="meu")
        other = make_ticket(ana, suporte, subject="do colega")
        make_ticket(ana, suporte, subject="sem dono")

        ticket_service.assign(ticket=mine, assignee=agente_suporte, actor=supervisor)
        ticket_service.assign(ticket=other, assignee=supervisor, actor=supervisor)

        client = api(agente_suporte)
        assert client.get("/api/v1/tickets/?assignee=me").json()["count"] == 1
        assert client.get("/api/v1/tickets/?assignee=unassigned").json()["count"] == 1
        assert client.get(
            f"/api/v1/tickets/?assignee={supervisor.pk}"
        ).json()["count"] == 1
        assert client.get("/api/v1/tickets/").json()["count"] == 3

    def test_garbage_assignee_is_ignored_not_an_error(self, api, make_ticket, ana,
                                                      suporte, agente_suporte):
        make_ticket(ana, suporte)
        resp = api(agente_suporte).get("/api/v1/tickets/?assignee=lixo")
        assert resp.status_code == 200
        assert resp.json()["count"] == 1


class TestSearchAndPriority:
    def test_search_matches_subject_or_reference(self, api, make_ticket, ana,
                                                 suporte, agente_suporte):
        target = make_ticket(ana, suporte, subject="Boleto não chegou")
        make_ticket(ana, suporte, subject="Site fora do ar")

        client = api(agente_suporte)
        assert client.get("/api/v1/tickets/?q=boleto").json()["count"] == 1
        assert client.get(
            f"/api/v1/tickets/?q={target.reference}"
        ).json()["count"] == 1

    def test_priority_filter(self, api, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=ticket.pk).update(priority="urgent")
        make_ticket(ana, suporte)
        assert api(agente_suporte).get(
            "/api/v1/tickets/?priority=urgent"
        ).json()["count"] == 1


class TestQueueIndicators:
    def test_plan_badge_and_company_ride_along(self, api, make_ticket, ana,
                                               suporte, agente_suporte):
        make_ticket(ana, suporte)
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        assert row["company_name"] == "Acme"
        assert row["plan"] == {"slug": "gold", "name": "Gold"}

    def test_sla_states(self, api, make_ticket, ana, suporte, agente_suporte, sla):
        ticket = make_ticket(ana, suporte)
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        # recém-criado com 60min de prazo: dentro do prazo
        assert row["sla"]["first_response"]["state"] == "ok"
        assert row["sla"]["first_response"]["minutes_left"] > 0

        # prazo em 10 minutos → em risco
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(minutes=10)
        )
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        assert row["sla"]["first_response"]["state"] == "at_risk"

        # prazo vencido → estourado
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(minutes=5)
        )
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        assert row["sla"]["first_response"]["state"] == "breached"

    def test_answered_ticket_shows_met_even_if_late(self, api, make_ticket, ana,
                                                    suporte, agente_suporte, sla):
        """Respondido fora do prazo continua estourado no histórico, mas na fila
        o que importa é que não há mais ação pendente."""
        ticket = make_ticket(ana, suporte)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(hours=2),
            sla_first_response_breached=True,
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="resposta",
            new_status=TicketStatus.OPEN,
        )
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        assert row["sla"]["first_response"]["state"] == "met"

    def test_no_policy_yields_none_state(self, api, make_ticket, ana, suporte,
                                         agente_suporte):
        make_ticket(ana, suporte)
        row = api(agente_suporte).get("/api/v1/tickets/").json()["results"][0]
        assert row["sla"]["first_response"]["state"] == "none"


class TestSlaFilter:
    def test_breached_and_at_risk(self, api, make_ticket, ana, suporte,
                                 agente_suporte, sla):
        late = make_ticket(ana, suporte, subject="atrasado")
        soon = make_ticket(ana, suporte, subject="quase")
        make_ticket(ana, suporte, subject="tranquilo")

        Ticket.objects.filter(pk=late.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(hours=1)
        )
        Ticket.objects.filter(pk=soon.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(minutes=10)
        )

        client = api(agente_suporte)
        breached = client.get("/api/v1/tickets/?sla=breached").json()
        assert [r["subject"] for r in breached["results"]] == ["atrasado"]

        at_risk = client.get("/api/v1/tickets/?sla=at_risk").json()
        assert [r["subject"] for r in at_risk["results"]] == ["quase"]


class TestMaskingSurvivesTheNewFields:
    def test_restricted_row_still_masked_with_plan_visible(self, api, make_ticket,
                                                           ana, beto, financeiro):
        """Plano e empresa são da própria empresa do leitor — aparecem. O que
        não pode aparecer continua não aparecendo."""
        make_ticket(ana, financeiro, subject="Fatura duplicada")
        row = api(beto).get("/api/v1/tickets/").json()["results"][0]

        assert row["plan"]["slug"] == "gold"
        assert row["company_name"] == "Acme"
        assert "Fatura" not in row["subject"]
        assert row["requester_display"] == "Usuário protegido"
        assert row["content_hidden"] is True
