"""Cota de tickets: consumo, bloqueio e as isenções decididas (P6, F-A, F-C)."""

import pytest

from apps.customers.models import TicketQuotaConsumption
from apps.tickets.models import TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


class TestQuotaConsumption:
    def test_creation_consumes_and_blocks_at_limit(self, api, ana, suporte, acme):
        assert acme.effective_ticket_limit == 3
        client = api(ana)
        payload = {"team_id": suporte.pk, "subject": "s", "body": "b"}

        for _ in range(3):
            assert client.post("/api/v1/tickets/", payload, format="json").status_code == 201

        resp = client.post("/api/v1/tickets/", payload, format="json")
        assert resp.status_code == 422
        data = resp.json()
        assert data["code"] == "quota_exceeded"
        assert data["used"] == 3 and data["limit"] == 3
        assert "Renova em" in data["detail"]

    def test_limit_is_company_wide(self, api, ana, beto, suporte, acme):
        """P1: todos os usuários da empresa somam no mesmo limite."""
        payload = {"team_id": suporte.pk, "subject": "s", "body": "b"}
        assert api(ana).post("/api/v1/tickets/", payload, format="json").status_code == 201
        assert api(ana).post("/api/v1/tickets/", payload, format="json").status_code == 201
        assert api(beto).post("/api/v1/tickets/", payload, format="json").status_code == 201
        # Beto esbarra no limite consumido majoritariamente pela Ana
        assert api(beto).post("/api/v1/tickets/", payload, format="json").status_code == 422

    def test_ledger_snapshot(self, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        row = TicketQuotaConsumption.objects.get(ticket=ticket)
        assert row.limit_snapshot == 3
        assert row.company_id == ana.company_id
        assert row.period_start <= row.period_end

    def test_unlimited_plan_never_blocks(self, api, carla, suporte, bravo):
        bravo.ticket_limit = None
        bravo.plan.default_ticket_limit = None
        bravo.plan.save(update_fields=["default_ticket_limit"])
        payload = {"team_id": suporte.pk, "subject": "s", "body": "b"}
        client = api(carla)
        for _ in range(5):
            assert client.post("/api/v1/tickets/", payload, format="json").status_code == 201
        assert TicketQuotaConsumption.objects.filter(company=bravo).count() == 0


def consumptions_of(company):
    """Contagem SEMPRE escopada à empresa do cenário.

    ⚑ `TicketQuotaConsumption.objects.count()` global falhava de forma
    intermitente: testes transacionais anteriores (chat, reports) criam tickets
    e o `flush` de teardown deles depende de um lock exclusivo que nem sempre
    está disponível — o log do Postgres registra `lock not available` com
    frequência aqui. Um teste que afirma sobre a tabela inteira está acoplado a
    estado que não é dele; escopar remove a classe do problema em vez de
    torcer pela ordem de execução.
    """
    return TicketQuotaConsumption.objects.filter(company=company).count()


class TestQuotaExemptions:
    def test_reopen_does_not_consume(self, make_ticket, ana, suporte, agente_suporte,
                                     acme):
        """P6: a cota é consumida na criação; reabrir não cria ticket."""
        from django.utils import timezone

        ticket = make_ticket(ana, suporte)
        assert consumptions_of(acme) == 1

        ticket_service.close_ticket(
            ticket=ticket, actor=agente_suporte,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="reabrindo!")
        ticket.refresh_from_db()

        assert ticket.status == TicketStatus.OPEN
        assert ticket.reopen_count == 1
        assert consumptions_of(acme) == 1  # nenhuma linha nova

    def test_reopened_ticket_allows_reply_even_at_limit(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        """Empresa no limite ainda conversa nos tickets existentes — o limite
        bloqueia ABERTURA, nunca a conversa."""
        from django.utils import timezone

        tickets = [make_ticket(ana, suporte) for _ in range(3)]  # esgota o limite
        ticket_service.close_ticket(
            ticket=tickets[0], actor=agente_suporte,
            resolution_started_at=tickets[0].created_at,
            resolution_ended_at=timezone.now(),
        )
        resp = api(ana).post(
            f"/api/v1/tickets/{tickets[0].pk}/reply/", {"body": "voltou"}, format="json"
        )
        assert resp.status_code == 201  # reabertura passa mesmo com cota cheia

    def test_internal_creation_exempt(self, api, ana, suporte, agente_suporte,
                                      admin, acme):
        """F-C: agente abrindo em nome do cliente não debita a cota."""
        payload = {
            "team_id": suporte.pk, "subject": "aberto pelo agente",
            "body": "registro de ligação", "requester_id": ana.pk,
        }
        resp = api(admin).post("/api/v1/tickets/", payload, format="json")
        assert resp.status_code == 201
        assert resp.json()["source"] == "internal"
        assert consumptions_of(acme) == 0
