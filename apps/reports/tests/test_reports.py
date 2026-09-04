"""Relatórios: split aguardando-cliente × aguardando-agente, filtros e CSV."""

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    User,
    UserKind,
)
from apps.customers.models import Company, Plan
from apps.reports.services import metrics
from apps.tickets.models import (
    Ticket,
    TicketStatus,
    TicketStatusEvent,
)
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


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


@pytest.fixture
def carla(bravo):
    return User.objects.create_user(
        email="carla@bravo.test", full_name="Carla", kind=UserKind.CLIENT,
        company=bravo, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _backdated_ticket(requester, team, hours_ago):
    ticket = ticket_service.create_ticket(
        requester=requester, team=team, subject="t", body="b"
    )
    created = timezone.now() - dt.timedelta(hours=hours_ago)
    Ticket.objects.filter(pk=ticket.pk).update(created_at=created)
    ticket.status_events.update(created_at=created)
    ticket.refresh_from_db()
    return ticket


def _event(ticket, frm, to, hours_ago):
    event = TicketStatusEvent.objects.create(
        ticket=ticket, from_status=frm, to_status=to
    )
    TicketStatusEvent.objects.filter(pk=event.pk).update(
        created_at=timezone.now() - dt.timedelta(hours=hours_ago)
    )
    ticket.status = to
    ticket.save(update_fields=["status"])


class TestWaitingSplit:
    def test_split_across_transitions(self, ana, suporte):
        """10h atrás criado; 8h atrás → PENDING (2h agente); 5h atrás → OPEN
        (3h cliente); desde então 5h agente. Total: 7h agente, 3h cliente."""
        ticket = _backdated_ticket(ana, suporte, hours_ago=10)
        _event(ticket, TicketStatus.NEW, TicketStatus.PENDING_CUSTOMER, hours_ago=8)
        _event(ticket, TicketStatus.PENDING_CUSTOMER, TicketStatus.OPEN, hours_ago=5)

        result = metrics.waiting_times(ticket)
        assert abs(result["waiting_agent_seconds"] - 7 * 3600) < 5
        assert abs(result["waiting_customer_seconds"] - 3 * 3600) < 5

    def test_closed_stops_both_clocks(self, ana, suporte):
        """Fechado 2h atrás: o tempo desde então não conta para ninguém."""
        ticket = _backdated_ticket(ana, suporte, hours_ago=6)
        _event(ticket, TicketStatus.NEW, TicketStatus.CLOSED, hours_ago=2)

        result = metrics.waiting_times(ticket)
        assert abs(result["waiting_agent_seconds"] - 4 * 3600) < 5
        assert result["waiting_customer_seconds"] == 0


class TestReportApi:
    def test_summary_and_rows(self, api, admin, ana, suporte, agente):
        ticket = _backdated_ticket(ana, suporte, hours_ago=4)
        ticket_service.add_reply(
            ticket=ticket, author=agente, body="resp",
            new_status=TicketStatus.OPEN,
        )
        data = api(admin).get("/api/v1/reports/tickets/").json()
        assert data["summary"]["total"] == 1
        row = data["rows"][0]
        assert row["reference"] == ticket.reference
        assert row["first_response_seconds"] is not None
        assert row["waiting_agent_seconds"] > 0

    def test_reopen_metrics(self, api, admin, ana, suporte, agente):
        ticket = _backdated_ticket(ana, suporte, hours_ago=4)
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now() - dt.timedelta(hours=1),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="reabre")

        data = api(admin).get("/api/v1/reports/tickets/").json()
        assert data["summary"]["reopened_tickets"] == 1
        assert data["summary"]["reopen_events"] == 1

    def test_filters(self, api, admin, ana, carla, suporte, agente):
        mine = _backdated_ticket(ana, suporte, hours_ago=2)
        _backdated_ticket(carla, suporte, hours_ago=2)
        old = _backdated_ticket(ana, suporte, hours_ago=24 * 40)

        base = "/api/v1/reports/tickets/"
        assert api(admin).get(base).json()["summary"]["total"] == 3
        # por empresa
        by_company = api(admin).get(f"{base}?company={ana.company_id}").json()
        assert by_company["summary"]["total"] == 2
        # por usuário da empresa
        by_user = api(admin).get(f"{base}?requester={carla.pk}").json()
        assert by_user["summary"]["total"] == 1
        # por período
        cutoff = (timezone.now() - dt.timedelta(days=7)).date().isoformat()
        recent = api(admin).get(f"{base}?from={cutoff}").json()
        assert recent["summary"]["total"] == 2
        refs = {r["reference"] for r in recent["rows"]}
        assert old.reference not in refs
        assert mine.reference in refs

    def test_agent_filter(self, api, admin, ana, suporte, agente):
        ticket = _backdated_ticket(ana, suporte, hours_ago=2)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=admin)
        _backdated_ticket(ana, suporte, hours_ago=2)  # sem assignee
        data = api(admin).get(f"/api/v1/reports/tickets/?agent={agente.pk}").json()
        assert data["summary"]["total"] == 1

    def test_scope_follows_visibility(self, api, agente, admin, ana, suporte):
        """Agente vê o relatório só das equipes vinculadas (D1)."""
        financeiro = Team.objects.create(
            name="Financeiro", slug="financeiro", visibility="requester_only"
        )
        _backdated_ticket(ana, suporte, hours_ago=2)
        _backdated_ticket(ana, financeiro, hours_ago=2)
        assert api(agente).get("/api/v1/reports/tickets/").json()["summary"]["total"] == 1
        assert api(admin).get("/api/v1/reports/tickets/").json()["summary"]["total"] == 2

    def test_client_locked_out(self, api, ana, suporte):
        _backdated_ticket(ana, suporte, hours_ago=1)
        assert api(ana).get("/api/v1/reports/tickets/").status_code == 403

    def test_invalid_date_rejected(self, api, admin):
        resp = api(admin).get("/api/v1/reports/tickets/?from=ontem")
        assert resp.status_code == 400


class TestCsvExport:
    def test_csv_download_and_audit(self, api, admin, ana, suporte):
        from apps.audit.models import AuditLog

        _backdated_ticket(ana, suporte, hours_ago=2)
        resp = api(admin).get("/api/v1/reports/tickets/export/")
        assert resp.status_code == 200
        assert resp["Content-Type"].startswith("text/csv")
        assert "attachment" in resp["Content-Disposition"]

        content = resp.content.decode("utf-8-sig")
        lines = content.strip().splitlines()
        assert lines[0].startswith("reference;subject;company")
        assert len(lines) == 2  # header + 1 ticket

        # requisito de auditoria: exportação registrada
        log = AuditLog.objects.get(action="export")
        assert log.actor == admin
        assert "1 linhas" in log.summary

    def test_csv_respects_filters(self, api, admin, ana, carla, suporte):
        _backdated_ticket(ana, suporte, hours_ago=2)
        _backdated_ticket(carla, suporte, hours_ago=2)
        resp = api(admin).get(
            f"/api/v1/reports/tickets/export/?company={carla.company_id}"
        )
        lines = resp.content.decode("utf-8-sig").strip().splitlines()
        assert len(lines) == 2
        assert "Bravo" in lines[1]

    def test_export_logs_access_per_restricted_ticket(self, api, admin, ana, suporte):
        """Exportar lê assunto e solicitante de tickets restritos em massa —
        e é o caminho de maior volume de leitura. A trilha por ticket
        (TicketAccessLog) é o que a política promete e o que pega exfiltração."""
        from apps.audit.models import TicketAccessLog

        financeiro = Team.objects.create(
            name="Financeiro", slug="financeiro", visibility="requester_only"
        )
        restrito = _backdated_ticket(ana, financeiro, hours_ago=2)
        _backdated_ticket(ana, suporte, hours_ago=2)  # normal: não gera log
        TicketAccessLog.objects.all().delete()

        api(admin).get("/api/v1/reports/tickets/export/")

        logs = TicketAccessLog.objects.filter(context="export")
        assert logs.count() == 1
        assert logs.first().ticket_id == restrito.pk
        assert logs.first().was_granted is True
