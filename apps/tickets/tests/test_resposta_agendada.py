"""Resposta agendada: o agente escreve agora, o sistema dispara sozinho na
hora marcada (`ScheduledReply` + `dispatch_scheduled_replies`).

O que precisa ficar provado:

- só interno agenda, e só quem já poderia responder agora;
- resposta pública exige o status de destino (mesma regra de `add_reply`);
- fechar ao enviar exige os campos de resolução (D4), já na hora de agendar;
- `scheduled_at` tem que estar no futuro;
- cancelar é só do autor, e só enquanto pendente;
- o disparo reusa `add_reply` (mesma máquina de estado), marca SENT/FAILED,
  e revalida o status depois do lock (corrida com cancelamento).
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import ScheduledReply, ScheduledReplyStatus, TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


def _futuro(minutos=60):
    return timezone.now() + dt.timedelta(minutes=minutos)


class TestAgendar:
    def test_agente_agenda_resposta_publica(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="Bom dia! Segue a atualização.",
            scheduled_at=_futuro(), new_status=TicketStatus.OPEN,
        )
        assert agendada.status == ScheduledReplyStatus.PENDING
        assert agendada.author_id == agente_suporte.pk
        assert agendada.new_status == TicketStatus.OPEN
        # nada mudou no ticket ainda — só nasceu o agendamento
        ticket.refresh_from_db()
        assert ticket.messages.count() == 1  # só a mensagem de abertura

    def test_cliente_nao_agenda(self, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="ação da equipe"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=ana, body="oi", scheduled_at=_futuro(),
                new_status=TicketStatus.OPEN,
            )

    def test_resposta_publica_exige_status_valido(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="status"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            )

    def test_fechar_ao_enviar_exige_campos_de_resolucao(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="D4"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=agente_suporte, body="resolvido",
                scheduled_at=_futuro(), new_status=TicketStatus.CLOSED,
            )

    def test_data_no_passado_e_recusada(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="futuro"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=agente_suporte, body="oi",
                scheduled_at=timezone.now() - dt.timedelta(minutes=1),
                new_status=TicketStatus.OPEN,
            )

    def test_nota_interna_nao_exige_status(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="lembrete pra equipe",
            scheduled_at=_futuro(), is_public=False,
        )
        assert agendada.new_status == ""

    def test_agente_leve_nao_agenda_resposta_publica(self, make_ticket, ana, suporte, agente_leve):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="Seu papel"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=agente_leve, body="oi", scheduled_at=_futuro(),
                new_status=TicketStatus.OPEN,
            )

    def test_corpo_vazio_e_recusado(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="texto"):
            ticket_service.schedule_reply(
                ticket=ticket, actor=agente_suporte, body="   ", scheduled_at=_futuro(),
                new_status=TicketStatus.OPEN,
            )


class TestCancelar:
    def test_autor_cancela(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        cancelada = ticket_service.cancel_scheduled_reply(scheduled=agendada, actor=agente_suporte)
        assert cancelada.status == ScheduledReplyStatus.CANCELLED

    def test_outra_pessoa_nao_cancela(
        self, make_ticket, ana, suporte, agente_suporte, agente_financeiro
    ):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        with pytest.raises(TicketRuleViolation, match="Só quem agendou"):
            ticket_service.cancel_scheduled_reply(scheduled=agendada, actor=agente_financeiro)

    def test_nao_cancela_a_que_ja_foi_enviada(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        agendada.status = ScheduledReplyStatus.SENT
        agendada.save(update_fields=["status"])
        with pytest.raises(TicketRuleViolation, match="não está mais pendente"):
            ticket_service.cancel_scheduled_reply(scheduled=agendada, actor=agente_suporte)


class TestDisparo:
    def _vencida(self, agendada, minutos_atras=5):
        ScheduledReply.objects.filter(pk=agendada.pk).update(
            scheduled_at=timezone.now() - dt.timedelta(minutes=minutos_atras)
        )

    def test_dispara_a_vencida_e_reusa_add_reply(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="Bom dia! Segue a atualização.",
            scheduled_at=_futuro(), new_status=TicketStatus.PENDING_CUSTOMER,
        )
        self._vencida(agendada)

        enviadas = ticket_service.dispatch_scheduled_replies()

        assert enviadas == 1
        agendada.refresh_from_db()
        assert agendada.status == ScheduledReplyStatus.SENT
        assert agendada.sent_at is not None
        assert agendada.message is not None
        assert agendada.message.body == "Bom dia! Segue a atualização."
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.PENDING_CUSTOMER

    def test_nao_dispara_antes_da_hora(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        assert ticket_service.dispatch_scheduled_replies() == 0

    def test_nao_dispara_cancelada(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        self._vencida(agendada)
        ticket_service.cancel_scheduled_reply(scheduled=agendada, actor=agente_suporte)

        assert ticket_service.dispatch_scheduled_replies() == 0
        agendada.refresh_from_db()
        assert agendada.status == ScheduledReplyStatus.CANCELLED

    def test_falha_no_disparo_marca_failed_com_o_motivo(
        self, make_ticket, ana, suporte, agente_leve
    ):
        """Simula o agendamento ter ficado inválido até a hora do disparo —
        aqui, criado direto pelo ORM (contornando a validação de
        `schedule_reply`) para exercitar o caminho de erro do disparo."""
        ticket = make_ticket(ana, suporte)
        agendada = ScheduledReply.objects.create(
            ticket=ticket, author=agente_leve, body="oi", is_public=True,
            new_status=TicketStatus.OPEN, scheduled_at=timezone.now() - dt.timedelta(minutes=1),
        )

        enviadas = ticket_service.dispatch_scheduled_replies()

        assert enviadas == 0
        agendada.refresh_from_db()
        assert agendada.status == ScheduledReplyStatus.FAILED
        assert agendada.error  # guarda o motivo pra quem agendou entender
        assert ticket.messages.count() == 1  # nenhuma mensagem nova entrou

    def test_idempotente_nao_reenviar_apos_marcar_enviada(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        self._vencida(agendada)
        assert ticket_service.dispatch_scheduled_replies() == 1
        assert ticket_service.dispatch_scheduled_replies() == 0


class TestPelaRota:
    def test_agenda_pela_api(self, api, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/schedule-reply/",
            {
                "body": "Bom dia! Segue a atualização.",
                "new_status": "open",
                "scheduled_at": _futuro().isoformat(),
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert resp.data["status"] == "pending"
        assert ScheduledReply.objects.filter(ticket=ticket).count() == 1

    def test_cliente_recebe_400_ao_tentar_agendar(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/schedule-reply/",
            {"body": "oi", "new_status": "open", "scheduled_at": _futuro().isoformat()},
            format="json",
        )
        assert resp.status_code == 400

    def test_cancela_pela_api(self, api, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        agendada = ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/schedule-reply/{agendada.pk}/cancel/"
        )
        assert resp.status_code == 200, resp.data
        assert resp.data["status"] == "cancelled"

    def test_detalhe_do_ticket_lista_os_agendamentos_pendentes_so_pra_interno(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        ticket_service.schedule_reply(
            ticket=ticket, actor=agente_suporte, body="oi", scheduled_at=_futuro(),
            new_status=TicketStatus.OPEN,
        )
        corpo_agente = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert len(corpo_agente["scheduled_replies"]) == 1

        corpo_cliente = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert corpo_cliente["scheduled_replies"] == []
