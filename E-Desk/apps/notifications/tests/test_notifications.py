"""Notificações: outbox de e-mail, in-app (atribuição/menção/reabertura) e SLA."""

import datetime as dt

import pytest
from django.core import mail
from django.utils import timezone

from apps.notifications.models import Notification, NotificationKind, OutboundEmail
from apps.notifications.tasks import sla_scan
from apps.tickets.models import Ticket, TicketStatus
from apps.tickets.services import ticket_service


def _ticket(ana, suporte, **kw):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject=kw.pop("subject", "Assunto"),
        body="Corpo", **kw,
    )


@pytest.mark.django_db(transaction=True)
class TestNewTicketEmail:
    def test_email_queued_and_sent(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = "suporte@empresa.test"
        ticket = _ticket(ana, suporte, subject="Site caiu")

        row = OutboundEmail.objects.get(ticket=ticket)
        assert row.status == OutboundEmail.Status.SENT  # task eager pós-commit
        assert row.dedupe_key == f"new-ticket-{ticket.pk}"

        assert len(mail.outbox) == 1
        sent = mail.outbox[0]
        assert ticket.reference in sent.subject
        assert "Site caiu" in sent.subject
        assert sent.to == ["suporte@empresa.test"]
        assert "não recebe respostas" in sent.body  # e-mail é só aviso, de propósito

    def test_team_email_overrides_global(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = "suporte@empresa.test"
        suporte.notification_email = "fila.suporte@empresa.test"
        suporte.save(update_fields=["notification_email"])
        _ticket(ana, suporte)
        assert mail.outbox[0].to == ["fila.suporte@empresa.test"]

    def test_no_email_configured_no_crash(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = ""
        ticket = _ticket(ana, suporte)
        assert ticket.pk  # criação segue normal
        assert OutboundEmail.objects.count() == 0


@pytest.mark.django_db
class TestInAppNotifications:
    def test_assignment_notifies_assignee(self, ana, suporte, agente, colega):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        n = Notification.objects.get(recipient=colega)
        assert n.kind == NotificationKind.TICKET_ASSIGNED
        assert ticket.reference in n.title

    def test_self_assignment_is_silent(self, ana, suporte, agente):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        assert Notification.objects.count() == 0

    def test_mention_in_internal_note(self, ana, suporte, agente, colega):
        """A menção guarda a REFERÊNCIA (`@[user:id]`), não o e-mail digitado —
        ver apps/tickets/services/mentions.py."""
        ticket = _ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente, is_public=False,
            body=f"@[user:{colega.pk}] consegue olhar este caso?",
        )
        n = Notification.objects.get(recipient=colega)
        assert n.kind == NotificationKind.MENTION
        assert "Samuel" in n.title

    def test_reopen_notifies_assignee(self, ana, suporte, agente):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="voltou!")
        n = Notification.objects.get(kind=NotificationKind.TICKET_REOPENED)
        assert n.recipient == agente

    def test_client_reply_notifies_assignee(self, ana, suporte, agente):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        ticket_service.add_reply(ticket=ticket, author=ana, body="mais contexto")
        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.TICKET_REPLIED
        ).exists()


@pytest.mark.django_db
class TestSLA:
    def test_sla_applied_on_creation(self, ana, suporte, sla_policy):
        ticket = _ticket(ana, suporte)
        assert ticket.sla_policy == sla_policy
        # 60min corridos a partir da criação
        expected = ticket.created_at + dt.timedelta(minutes=60)
        assert abs((ticket.sla_first_response_due_at - expected).total_seconds()) < 2

    def test_scan_warns_assignee_near_due(self, ana, suporte, agente, sla_policy):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Notification.objects.all().delete()
        # prazo daqui a 10 min: dentro da janela de aviso (30)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(minutes=10)
        )
        result = sla_scan()
        assert result["warned"] >= 1
        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.SLA_WARNING
        ).exists()

    def test_scan_marks_breach_once(self, ana, suporte, agente, sla_policy):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Notification.objects.all().delete()
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(minutes=5)
        )
        sla_scan()
        ticket.refresh_from_db()
        assert ticket.sla_first_response_breached is True
        count = Notification.objects.filter(kind=NotificationKind.SLA_BREACHED).count()

        sla_scan()  # segunda varredura: deduplicada
        assert Notification.objects.filter(
            kind=NotificationKind.SLA_BREACHED
        ).count() == count

    def test_breach_mark_is_idempotent_conditional_update(self, ana, suporte, agente, sla_policy):
        """A marcação de estouro é um UPDATE condicional (guarda no WHERE): rodar
        de novo, ou já entrar com a flag ligada, não estoura nem regride nada."""
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        # simula um escritor concorrente que já marcou o estouro antes do scan
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(minutes=5),
            sla_first_response_breached=True,
        )
        sla_scan()  # não deve levantar exceção nem desmarcar
        ticket.refresh_from_db()
        assert ticket.sla_first_response_breached is True

    def test_reopen_restarts_resolution_sla(self, ana, suporte, agente, sla_policy):
        ticket = _ticket(ana, suporte)
        original_due = ticket.sla_resolution_due_at
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="reabre aí")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.sla_resolution_due_at > original_due  # D5: prazo novo
        assert ticket.sla_first_response_due_at is not None  # 1ª resposta intocada


@pytest.mark.django_db
class TestNotificationApi:
    def test_list_and_unread_count(self, api, ana, suporte, agente, colega):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        data = api(colega).get("/api/v1/notifications/").json()
        assert data["count"] == 1
        assert data["unread_count"] == 1

    def test_mark_read_and_read_all(self, api, ana, suporte, agente, colega):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        n = Notification.objects.get()
        client = api(colega)
        assert client.post(f"/api/v1/notifications/{n.pk}/read/").json() == {
            "marked_read": 1
        }
        assert client.get("/api/v1/notifications/").json()["unread_count"] == 0

    def test_user_only_sees_own(self, api, ana, suporte, agente, colega):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        assert api(agente).get("/api/v1/notifications/").json()["count"] == 0
