"""Antes de reabrir, a nota (decisão de produto).

Responder a um chamado resolvido reabre — mas se a pesquisa de satisfação
dele ainda está aberta, o solicitante precisa responder primeiro. Só o
solicitante: o responsável da empresa não tem pesquisa para responder e não
pode ficar num beco sem saída. E um chamado reaberto por outra via deixa de
cobrar nota até fechar de novo.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import TicketStatus
from apps.tickets.services import satisfaction, ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


@pytest.fixture
def resolvido(make_ticket, ana, suporte, agente_suporte, django_capture_on_commit_callbacks):
    ticket = make_ticket(ana, suporte)
    with django_capture_on_commit_callbacks(execute=True):
        ticket_service.close_ticket(
            ticket=ticket, actor=agente_suporte,
            resolution_started_at=ticket.created_at, resolution_ended_at=timezone.now(),
        )
    ticket.refresh_from_db()
    assert ticket.survey.score is None
    return ticket


class TestReabrirExigeNota:
    def test_solicitante_sem_nota_nao_reabre(self, resolvido, ana):
        with pytest.raises(TicketRuleViolation, match="Avalie"):
            ticket_service.add_reply(ticket=resolvido, author=ana, body="ainda não resolveu")
        resolvido.refresh_from_db()
        assert resolvido.status == TicketStatus.CLOSED

    def test_depois_da_nota_reabre(self, resolvido, ana):
        satisfaction.answer(resolvido.survey, score=8)
        ticket_service.add_reply(ticket=resolvido, author=ana, body="voltou a acontecer")
        resolvido.refresh_from_db()
        assert resolvido.status == TicketStatus.OPEN
        assert resolvido.reopen_count == 1

    def test_pesquisa_expirada_nao_trava(self, resolvido, ana):
        survey = resolvido.survey
        survey.expires_at = timezone.now() - dt.timedelta(days=1)
        survey.save(update_fields=["expires_at"])
        ticket_service.add_reply(ticket=resolvido, author=ana, body="voltou")
        resolvido.refresh_from_db()
        assert resolvido.status == TicketStatus.OPEN

    def test_responsavel_da_empresa_reabre_sem_nota(self, resolvido, olga):
        """A pesquisa é da Ana; a Olga não tem como respondê-la."""
        ticket_service.add_reply(ticket=resolvido, author=olga, body="pela Ana: voltou")
        resolvido.refresh_from_db()
        assert resolvido.status == TicketStatus.OPEN

    def test_reaberto_pelo_agente_para_de_cobrar_nota(self, resolvido, ana, agente_suporte):
        assert [s.ticket_id for s in satisfaction.pending_for(ana)] == [resolvido.pk]
        ticket_service.add_reply(
            ticket=resolvido, author=agente_suporte, body="reabrindo para revisar",
            new_status=TicketStatus.OPEN,
        )
        assert list(satisfaction.pending_for(ana)) == []
