"""Máquina de estados do ticket: transições, primeira resposta e fechamento (D4/D5)."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


def _close(ticket, actor):
    # janela de resolução válida: começa na criação do ticket, termina agora
    return ticket_service.close_ticket(
        ticket=ticket,
        actor=actor,
        resolution_started_at=ticket.created_at,
        resolution_ended_at=timezone.now(),
    )


class TestAgentReply:
    def test_agent_must_choose_status(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="escolhe o novo status"):
            ticket_service.add_reply(ticket=ticket, author=agente_suporte, body="oi")

    def test_first_response_set_once(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        assert ticket.first_response_at is None

        msg1 = ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="resposta 1",
            new_status=TicketStatus.OPEN,
        )
        ticket.refresh_from_db()
        first = ticket.first_response_at
        assert first is not None
        msg1.refresh_from_db()
        assert msg1.is_first_response is True

        msg2 = ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="resposta 2",
            new_status=TicketStatus.OPEN,
        )
        ticket.refresh_from_db()
        assert ticket.first_response_at == first  # nunca reescrito
        assert msg2.is_first_response is False

    def test_internal_note_no_status_no_first_response(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="nota", is_public=False
        )
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.NEW
        assert ticket.first_response_at is None

    def test_agent_sets_pending_customer(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="aguardo retorno",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.PENDING_CUSTOMER

    def test_agent_close_via_reply_requires_resolution(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="início e de término"):
            ticket_service.add_reply(
                ticket=ticket, author=agente_suporte, body="resolvido",
                new_status=TicketStatus.CLOSED,
            )


class TestClientAutoTransitions:
    def test_pending_back_to_open(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="?",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        ticket_service.add_reply(ticket=ticket, author=ana, body="segue a resposta")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        auto = ticket.status_events.get(
            from_status=TicketStatus.PENDING_CUSTOMER, to_status=TicketStatus.OPEN
        )
        assert auto.is_automatic is True

    def test_reply_on_new_keeps_status(self, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(ticket=ticket, author=ana, body="complemento")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.NEW

    def test_closed_reopens_with_flags(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        _close(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED

        ticket_service.add_reply(ticket=ticket, author=ana, body="voltou a acontecer!")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.reopen_count == 1
        assert ticket.sla_cycle == 2  # D5: novo ciclo de resolução
        assert ticket.closed_at is None
        event = ticket.status_events.get(is_reopen=True)
        assert event.is_automatic is True
        assert ticket.last_reopened_at is not None


class TestClose:
    def test_close_records_resolution_window(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        _close(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.closed_by == agente_suporte
        assert ticket.resolution_started_at < ticket.resolution_ended_at
        assert ticket.closed_at is not None

    def test_close_validates_window(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        now = timezone.now()
        with pytest.raises(TicketRuleViolation, match="anterior ao início"):
            ticket_service.close_ticket(
                ticket=ticket, actor=agente_suporte,
                resolution_started_at=now,
                resolution_ended_at=now - dt.timedelta(hours=1),
            )
        with pytest.raises(TicketRuleViolation, match="anterior à criação"):
            ticket_service.close_ticket(
                ticket=ticket, actor=agente_suporte,
                resolution_started_at=ticket.created_at - dt.timedelta(days=1),
                resolution_ended_at=now,
            )

    def test_client_cannot_close(self, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="internos"):
            _close(ticket, ana)

    def test_close_twice_rejected(self, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        _close(ticket, agente_suporte)
        ticket.refresh_from_db()
        with pytest.raises(TicketRuleViolation, match="já está fechado"):
            _close(ticket, agente_suporte)


class TestReplyPermissions:
    """D9: leitura ≠ participação."""

    def test_colleague_member_cannot_reply(self, api, make_ticket, ana, beto, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(beto).post(
            f"/api/v1/tickets/{ticket.pk}/reply/", {"body": "posso ajudar?"}, format="json"
        )
        assert resp.status_code == 400

    def test_owner_can_reply_company_ticket(self, api, make_ticket, ana, olga, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(olga).post(
            f"/api/v1/tickets/{ticket.pk}/reply/", {"body": "complementando"}, format="json"
        )
        assert resp.status_code == 201

    def test_client_cannot_choose_status(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "oi", "new_status": "closed"},
            format="json",
        )
        assert resp.status_code == 400


class TestAutoClosePending:
    """D5: 'aguardando o cliente' sem resposta além do prazo fecha sozinho."""

    def _por_em_espera(self, make_ticket, ana, suporte, agente_suporte, horas_atras):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="pode confirmar?",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        # recua o evento de entrada em 'aguardando' para simular o tempo parado
        evento = ticket.status_events.filter(
            to_status=TicketStatus.PENDING_CUSTOMER
        ).latest("created_at")
        ticket.status_events.filter(pk=evento.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=horas_atras)
        )
        return ticket

    def test_fecha_apos_o_prazo(self, make_ticket, ana, suporte, agente_suporte,
                               django_capture_on_commit_callbacks):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 80)

        with django_capture_on_commit_callbacks(execute=True):
            fechados = ticket_service.auto_close_stale_pending()

        assert fechados == 1
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        # a mensagem configurada foi postada, pública e sem autor (Sistema)
        ultima = ticket.messages.latest("id")
        assert ultima.is_public is True
        assert ultima.author_id is None

    def test_nao_fecha_dentro_do_prazo(self, make_ticket, ana, suporte, agente_suporte):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 40)

        assert ticket_service.auto_close_stale_pending() == 0
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.PENDING_CUSTOMER

    def test_prazo_zero_desliga(self, make_ticket, ana, suporte, agente_suporte):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 0
        cfg.save()
        self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 200)

        assert ticket_service.auto_close_stale_pending() == 0

    def test_cliente_respondendo_tira_do_alvo(self, make_ticket, ana, suporte, agente_suporte):
        """Se o cliente responde, o status vira 'aberto' e o ticket sai da mira."""
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 80)
        ticket_service.add_reply(ticket=ticket, author=ana, body="respondi")

        assert ticket_service.auto_close_stale_pending() == 0
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN

    def test_marca_auto_closed(self, make_ticket, ana, suporte, agente_suporte,
                               django_capture_on_commit_callbacks):
        """O fechamento automático marca a ORIGEM — é o que distingue de um
        fechamento manual do agente e bloqueia a reabertura por resposta (R)."""
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 80)

        with django_capture_on_commit_callbacks(execute=True):
            ticket_service.auto_close_stale_pending()

        ticket.refresh_from_db()
        assert ticket.auto_closed is True

    def test_fechamento_manual_nao_marca_auto_closed(self, make_ticket, ana, suporte,
                                                      agente_suporte):
        """Fechamento pelo agente (D4) continua sendo reaberto por resposta —
        só o automático (D5) bloqueia."""
        ticket = make_ticket(ana, suporte)
        _close(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.auto_closed is False


class TestAutoCloseBlockReopen:
    """R: fechamento automático não reabre por resposta — o cliente abre um
    novo chamado. Fechamento manual do agente segue reabrindo normalmente
    (test_closed_reopens_with_flags, em TestAgentReply)."""

    def test_resposta_em_ticket_auto_fechado_nao_reabre(self, make_ticket, ana, suporte,
                                                         agente_suporte,
                                                         django_capture_on_commit_callbacks):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = 72
        cfg.save()
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="pode confirmar?",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        evento = ticket.status_events.filter(
            to_status=TicketStatus.PENDING_CUSTOMER
        ).latest("created_at")
        ticket.status_events.filter(pk=evento.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=80)
        )
        with django_capture_on_commit_callbacks(execute=True):
            assert ticket_service.auto_close_stale_pending() == 1
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.auto_closed is True

        with pytest.raises(TicketRuleViolation, match="novo chamado"):
            ticket_service.add_reply(ticket=ticket, author=ana, body="ainda preciso de ajuda")

        # a tentativa bloqueada não deixa rastro: nem mensagem, nem reabertura
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.reopen_count == 0
        assert not ticket.messages.filter(body="ainda preciso de ajuda").exists()


class TestWarnStalePending:
    """R: avisar antes de fechar — reduz reabertura e reclamação."""

    def _por_em_espera(self, make_ticket, ana, suporte, agente_suporte, horas_atras):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="pode confirmar?",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        evento = ticket.status_events.filter(
            to_status=TicketStatus.PENDING_CUSTOMER
        ).latest("created_at")
        ticket.status_events.filter(pk=evento.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=horas_atras)
        )
        return ticket

    def _configurar(self, prazo=72, aviso=24):
        from apps.core.models import SystemConfig

        cfg = SystemConfig.load()
        cfg.auto_close_pending_hours = prazo
        cfg.auto_close_warning_hours = aviso
        cfg.save()
        return cfg

    def test_avisa_quando_falta_pouco_para_fechar(self, make_ticket, ana, suporte,
                                                   agente_suporte):
        # prazo 72h, aviso 24h: dispara com 48h+ de espera
        self._configurar(prazo=72, aviso=24)
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 50)

        assert ticket_service.warn_stale_pending() == 1
        ticket.refresh_from_db()
        assert ticket.auto_close_warned_at is not None
        ultima = ticket.messages.latest("id")
        assert ultima.source == "system"
        assert ultima.is_public is True

    def test_nao_avisa_antes_da_hora(self, make_ticket, ana, suporte, agente_suporte):
        self._configurar(prazo=72, aviso=24)
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 30)

        assert ticket_service.warn_stale_pending() == 0
        ticket.refresh_from_db()
        assert ticket.auto_close_warned_at is None

    def test_nao_avisa_duas_vezes(self, make_ticket, ana, suporte, agente_suporte):
        self._configurar(prazo=72, aviso=24)
        self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 50)

        assert ticket_service.warn_stale_pending() == 1
        assert ticket_service.warn_stale_pending() == 0  # já avisado

    def test_aviso_zero_desliga(self, make_ticket, ana, suporte, agente_suporte):
        self._configurar(prazo=72, aviso=0)
        self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 80)

        assert ticket_service.warn_stale_pending() == 0

    def test_nova_espera_avisa_de_novo(self, make_ticket, ana, suporte, agente_suporte):
        """Cliente responde, some do alvo, entra em espera de novo depois —
        `_change_status` zera `auto_close_warned_at` ao sair de pending, então
        o segundo período de espera pode avisar de novo."""
        self._configurar(prazo=72, aviso=24)
        ticket = self._por_em_espera(make_ticket, ana, suporte, agente_suporte, 50)
        assert ticket_service.warn_stale_pending() == 1
        ticket.refresh_from_db()
        assert ticket.auto_close_warned_at is not None

        ticket_service.add_reply(ticket=ticket, author=ana, body="respondi")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.auto_close_warned_at is None  # zerado ao sair de pending

        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="novo prazo",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        evento = ticket.status_events.filter(
            to_status=TicketStatus.PENDING_CUSTOMER
        ).latest("created_at")
        ticket.status_events.filter(pk=evento.pk).update(
            created_at=timezone.now() - dt.timedelta(hours=50)
        )
        assert ticket_service.warn_stale_pending() == 1
