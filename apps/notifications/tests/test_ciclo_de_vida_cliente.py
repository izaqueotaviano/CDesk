"""O ciclo de vida do chamado como o CLIENTE o recebe por e-mail.

A regra do Painel do Cliente é "e-mail da abertura ao encerramento". Até
aqui o cliente só era avisado de RESPOSTA (`ticket_replied`): abrir um
chamado não confirmava nada, e ele descobria o fechamento entrando no
portal. Cada aviso respeita a preferência da conta, e o texto do
encerramento muda conforme o desfecho — resolvido convida a avaliar;
fechado por falta de retorno orienta a abrir outro.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.core.models import SystemConfig
from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)
from apps.tickets.models import TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db(transaction=True)


def _abrir(ana, suporte, actor=None):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject="Impressora parou",
        body="Corpo do chamado.", actor=actor,
    )


def _fechar(ticket, agente):
    # início/término da solução não podem anteceder a criação do chamado
    return ticket_service.close_ticket(
        ticket=ticket, actor=agente,
        resolution_started_at=ticket.created_at,
        resolution_ended_at=timezone.now(),
    )


class TestConfirmacaoDeAbertura:
    def test_cliente_recebe_a_confirmacao(self, ana, suporte):
        ticket = _abrir(ana, suporte)
        email = OutboundEmail.objects.get(to_email=ana.email, template="ticket_opened")
        assert ticket.reference in email.subject
        assert email.context["team"] == "Suporte"
        assert email.context["link"].endswith(f"/portal/tickets/{ticket.pk}")
        # o conteúdo do chamado NÃO viaja no e-mail — só referência e assunto
        assert "Corpo do chamado." not in str(email.context)

    def test_so_email_nao_aviso_in_app(self, ana, suporte):
        """Ela acabou de abrir: um sino avisando do próprio chamado é ruído."""
        _abrir(ana, suporte)
        assert not Notification.objects.filter(recipient=ana).exists()

    def test_aberto_pelo_agente_em_nome_dela_tambem_confirma(self, ana, suporte, agente):
        _abrir(ana, suporte, actor=agente)
        assert OutboundEmail.objects.filter(to_email=ana.email, template="ticket_opened").exists()

    def test_preferencia_desligada_e_respeitada(self, ana, suporte):
        NotificationPreference.objects.create(user=ana, email={"ticket_created": False})
        _abrir(ana, suporte)
        assert not OutboundEmail.objects.filter(template="ticket_opened").exists()


class TestEncerramento:
    def test_resolvido_avisa_no_sino_e_por_email(self, ana, suporte, agente):
        ticket = _abrir(ana, suporte)
        _fechar(ticket, agente)

        aviso = Notification.objects.get(recipient=ana, kind=NotificationKind.TICKET_CLOSED)
        assert aviso.url == f"/portal/tickets/{ticket.pk}"
        assert ticket.reference in aviso.title

        email = OutboundEmail.objects.get(to_email=ana.email, template="ticket_resolved")
        assert ticket.reference in email.subject
        assert email.context["link"].endswith(f"/portal/tickets/{ticket.pk}")

    def test_email_desligado_mantem_o_aviso_in_app(self, ana, suporte, agente):
        """Os dois canais têm interruptor próprio — desligar o e-mail não
        apaga o sino, e vice-versa."""
        NotificationPreference.objects.create(user=ana, email={"ticket_closed": False})
        ticket = _abrir(ana, suporte)
        _fechar(ticket, agente)
        assert Notification.objects.filter(
            recipient=ana, kind=NotificationKind.TICKET_CLOSED
        ).exists()
        assert not OutboundEmail.objects.filter(template="ticket_resolved").exists()

    def test_fechamento_automatico_tem_outro_texto(self, ana, suporte, agente):
        """Fechado por falta de retorno não reabre: o e-mail orienta a abrir
        um novo chamado, em vez de convidar a avaliar."""
        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = _abrir(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente, body="Pode confirmar?",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        evento = ticket.status_events.filter(
            to_status=TicketStatus.PENDING_CUSTOMER
        ).latest("created_at")
        ticket.status_events.filter(pk=evento.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=80)
        )

        assert ticket_service.auto_close_stale_pending() == 1

        email = OutboundEmail.objects.get(to_email=ana.email, template="ticket_auto_closed")
        assert "falta de retorno" in email.subject
        assert not OutboundEmail.objects.filter(template="ticket_resolved").exists()
        aviso = Notification.objects.get(recipient=ana, kind=NotificationKind.TICKET_CLOSED)
        assert "novo chamado" in aviso.body
