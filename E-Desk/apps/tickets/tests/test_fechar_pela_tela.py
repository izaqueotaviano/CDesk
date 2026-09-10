"""Fechar um ticket pelo caminho que a tela usa.

Existia teste para `close_ticket` e para `add_reply(new_status=closed)`, e os
dois passavam — mas nenhum descrevia a chamada que a SPA realmente fazia, e era
exatamente ela que estava quebrada: a tela mandava a resposta SEM `new_status`
e só depois batia em `close/`, e o backend recusa resposta pública de agente sem
status. Resultado: o ticket não fechava por caminho nenhum.

Estes testes fixam o contrato do caminho de tela — responder-e-fechar numa
chamada só, com justificativa — e a precisão de minuto que o
`<input type="datetime-local">` impõe.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


def _no_minuto(instante: dt.datetime) -> dt.datetime:
    """O que o <input type="datetime-local"> consegue representar."""
    return instante.replace(second=0, microsecond=0)


class TestResponderEFechar:
    """A tela manda UMA requisição: resposta + status + janela de resolução."""

    def test_uma_chamada_responde_e_fecha(self, api, make_ticket, ana, suporte,
                                          agente_suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {
                "body": "Trocamos o cabo; segue funcionando.",
                "is_public": True,
                "new_status": "closed",
                "resolution_started_at": _no_minuto(ticket.created_at).isoformat(),
                "resolution_ended_at": timezone.now().isoformat(),
                "close_note": "resolvido na troca do cabo",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.closed_by == agente_suporte
        assert ticket.resolution_started_at is not None
        # a resposta entrou junto — fechar não pode engolir a mensagem
        assert ticket.messages.filter(body__startswith="Trocamos o cabo").exists()

    def test_justificativa_chega_ao_evento_de_fechamento(self, make_ticket, ana, suporte,
                                                         agente_suporte):
        """`close_note` não pode se perder no caminho da resposta.

        O endpoint `close/` sempre gravou a nota; responder-e-fechar não
        repassava, e a justificativa que a tela pede sumia em silêncio.
        """
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="resolvido",
            new_status=TicketStatus.CLOSED,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
            close_note="cliente confirmou por telefone",
        )
        evento = ticket.status_events.filter(to_status=TicketStatus.CLOSED).latest("id")
        assert evento.note == "cliente confirmou por telefone"

    def test_fechar_sem_escrever_resposta(self, api, make_ticket, ana, suporte,
                                          agente_suporte):
        """Resolver por telefone e só registrar o desfecho é rotina."""
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/close/",
            {
                "resolution_started_at": _no_minuto(ticket.created_at).isoformat(),
                "resolution_ended_at": timezone.now().isoformat(),
            },
            format="json",
        )
        assert resp.status_code == 200, resp.data
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED


class TestPrecisaoDeMinuto:
    """O campo da tela não tem segundos — a regra tem de caber nele."""

    def test_inicio_no_minuto_da_criacao_e_aceito(self, make_ticket, ana, suporte,
                                                  agente_suporte):
        """Ticket criado às 17:35:35 só pode ser descrito como 17:35.

        Comparar com o instante cru reprovava o valor que a própria tela sugere:
        o fechamento ficava impossível por uma fração de minuto.
        """
        ticket = make_ticket(ana, suporte)
        assert ticket.created_at.second or ticket.created_at.microsecond, (
            "o teste precisa de um created_at com segundos para ter sentido"
        )
        ticket_service.close_ticket(
            ticket=ticket, actor=agente_suporte,
            resolution_started_at=_no_minuto(ticket.created_at),
            resolution_ended_at=timezone.now(),
        )
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED

    def test_minuto_anterior_a_criacao_continua_recusado(self, make_ticket, ana, suporte,
                                                         agente_suporte):
        """A tolerância é a do arredondamento, não um cheque em branco."""
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation, match="anterior à criação"):
            ticket_service.close_ticket(
                ticket=ticket, actor=agente_suporte,
                resolution_started_at=_no_minuto(ticket.created_at) - dt.timedelta(minutes=1),
                resolution_ended_at=timezone.now(),
            )
