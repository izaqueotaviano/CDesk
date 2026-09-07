"""Notificações: outbox de e-mail, in-app (atribuição/menção/reabertura) e SLA."""

import datetime as dt
from types import SimpleNamespace

import pytest
from django.core import mail
from django.utils import timezone

from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)
from apps.notifications.services import quer_email, quer_in_app, ticket_url
from apps.notifications.tasks import sla_scan
from apps.tickets.models import Ticket, TicketStatus
from apps.tickets.services import ticket_service


def _ticket(ana, suporte, **kw):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject=kw.pop("subject", "Assunto"),
        body="Corpo", **kw,
    )


class TestTicketUrl:
    """A rota do sino não pode inventar `/tickets/<id>` — nenhuma das duas
    bases do frontend tem essa rota (ver docstring de `ticket_url`)."""

    def test_interno_cai_no_painel(self):
        assert ticket_url(SimpleNamespace(pk=7), SimpleNamespace(is_internal=True)) == "/chamados/7"

    def test_cliente_cai_no_portal(self):
        cliente = SimpleNamespace(is_internal=False)
        assert ticket_url(SimpleNamespace(pk=7), cliente) == "/portal/tickets/7"

    def test_ancora_e_anexada(self):
        agente = SimpleNamespace(is_internal=True)
        url = ticket_url(SimpleNamespace(pk=7), agente, anchor="#mensagem-9")
        assert url == "/chamados/7#mensagem-9"


@pytest.mark.django_db(transaction=True)
class TestNewTicketEmail:
    def test_email_queued_and_sent(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = "suporte@empresa.test"
        ticket = _ticket(ana, suporte, subject="Site caiu")

        # dois e-mails por abertura: o aviso ao suporte (este) e a
        # confirmação ao cliente (`test_ciclo_de_vida_cliente`)
        row = OutboundEmail.objects.get(ticket=ticket, template="new_ticket")
        assert row.status == OutboundEmail.Status.SENT  # task eager pós-commit
        assert row.dedupe_key == f"new-ticket-{ticket.pk}"

        assert len(mail.outbox) == 2
        sent = next(m for m in mail.outbox if m.to == ["suporte@empresa.test"])
        assert ticket.reference in sent.subject
        assert "Site caiu" in sent.subject
        assert "não recebe respostas" in sent.body  # e-mail é só aviso, de propósito

    def test_team_email_overrides_global(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = "suporte@empresa.test"
        suporte.notification_email = "fila.suporte@empresa.test"
        suporte.save(update_fields=["notification_email"])
        _ticket(ana, suporte)
        destinos = [m.to for m in mail.outbox]
        assert ["fila.suporte@empresa.test"] in destinos
        assert ["suporte@empresa.test"] not in destinos

    def test_no_email_configured_no_crash(self, ana, suporte, settings):
        settings.SUPPORT_NOTIFICATION_EMAIL = ""
        ticket = _ticket(ana, suporte)
        assert ticket.pk  # criação segue normal
        assert not OutboundEmail.objects.filter(template="new_ticket").exists()


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
class TestAgentEmails:
    """TICKET_ASSIGNED e TICKET_REOPENED só avisavam in-app — o toggle de
    e-mail em Minha conta > Notificações existia, mas nada consultava
    `quer_email` para estes tipos (mesmo gap do SLA em `TestSLA` abaixo)."""

    def test_assignment_emails_the_assignee(self, ana, suporte, agente, colega):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        email = OutboundEmail.objects.get(to_email=colega.email, template="ticket_assigned")
        assert email.ticket_id == ticket.pk
        assert ticket.reference in email.subject

    def test_assignment_email_desligado_nao_envia(self, ana, suporte, agente, colega):
        NotificationPreference.objects.create(user=colega, email={"ticket_assigned": False})
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        # o sino continua ligado (in_app não foi mexido) — só o e-mail sai
        assert Notification.objects.filter(recipient=colega).exists()
        assert not OutboundEmail.objects.filter(template="ticket_assigned").exists()

    def test_self_assignment_nao_envia_email(self, ana, suporte, agente):
        """Mesma regra do in-app: atribuir a si mesmo não gera aviso nenhum."""
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        assert not OutboundEmail.objects.filter(template="ticket_assigned").exists()

    def test_reopen_emails_the_assignee(self, ana, suporte, agente):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="voltou!")
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="ticket_reopened", ticket=ticket
        ).exists()

    def test_reopen_email_desligado_nao_envia(self, ana, suporte, agente):
        NotificationPreference.objects.create(user=agente, email={"ticket_reopened": False})
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="voltou!")
        assert not OutboundEmail.objects.filter(template="ticket_reopened").exists()


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

    def test_scan_warns_assignee_by_email(self, ana, suporte, agente, sla_policy):
        """SLA_WARNING só existia in-app — o toggle de e-mail não tinha efeito."""
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(minutes=10)
        )
        sla_scan()
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="sla_warning", ticket=ticket
        ).exists()

    def test_scan_warns_assignee_by_email_desligado_nao_envia(
        self, ana, suporte, agente, sla_policy
    ):
        NotificationPreference.objects.create(user=agente, email={"sla_warning": False})
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() + dt.timedelta(minutes=10)
        )
        sla_scan()
        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.SLA_WARNING
        ).exists()  # sino continua ligado
        assert not OutboundEmail.objects.filter(template="sla_warning").exists()

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

    def test_scan_breach_emails_the_assignee(self, ana, suporte, agente, sla_policy):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(minutes=5)
        )
        sla_scan()
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="sla_breached", ticket=ticket
        ).exists()

    def test_scan_breach_email_desligado_nao_envia(self, ana, suporte, agente, sla_policy):
        NotificationPreference.objects.create(user=agente, email={"sla_breached": False})
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        Ticket.objects.filter(pk=ticket.pk).update(
            sla_first_response_due_at=timezone.now() - dt.timedelta(minutes=5)
        )
        sla_scan()
        assert not OutboundEmail.objects.filter(template="sla_breached").exists()

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


@pytest.mark.django_db
class TestPreferenciaPadrao:
    """O default exibido em GET /notification-preferences/ precisa bater com
    o default que `quer_in_app`/`quer_email` realmente aplicam para quem
    nunca configurou nada — já divergiu uma vez (a tela mostrava e-mail
    desligado, o serviço mandava o e-mail do mesmo jeito), sem nenhum teste
    flagrando. Isto trava a paridade para os dois canais e todos os tipos."""

    def test_get_bate_com_o_que_o_servico_realmente_aplica(self, agente, api):
        assert not NotificationPreference.objects.filter(user=agente).exists()

        resp = api(agente).get("/api/v1/notification-preferences/")
        assert resp.status_code == 200
        dados = resp.json()

        for kind, _ in NotificationKind.choices:
            assert dados["in_app"][kind] == quer_in_app(agente, kind), kind
            assert dados["email"][kind] == quer_email(agente, kind), kind

    def test_email_ligado_por_padrao(self, agente, api):
        # Regressão específica do bug: a view chegou a devolver False aqui
        # enquanto o serviço já mandava e-mail mesmo assim (default `True`).
        resp = api(agente).get("/api/v1/notification-preferences/")
        assert resp.json()["email"][NotificationKind.TICKET_REPLIED] is True
        assert quer_email(agente, NotificationKind.TICKET_REPLIED) is True

    def test_desligar_um_tipo_e_respeitado_e_nao_mexe_nos_outros(self, agente, api):
        client = api(agente)
        client.put(
            "/api/v1/notification-preferences/",
            {"email": {NotificationKind.TICKET_REPLIED: False}},
            format="json",
        )
        assert quer_email(agente, NotificationKind.TICKET_REPLIED) is False
        assert quer_email(agente, NotificationKind.SLA_BREACHED) is True
        assert quer_in_app(agente, NotificationKind.TICKET_REPLIED) is True
