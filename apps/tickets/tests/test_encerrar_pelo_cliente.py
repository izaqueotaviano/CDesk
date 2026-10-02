"""O CLIENTE encerra o próprio chamado — mesma rota `/close/` do agente, sem
o registro de trabalho técnico (D4) que só faz sentido para quem atendeu.

O que precisa ficar provado:

- o solicitante fecha, sem `resolution_started_at`/`resolution_ended_at`;
- o OWNER da empresa também fecha (mesma população de `can_reply`, D9);
- colega comum (MEMBER, não solicitante) NÃO fecha;
- cliente de outra empresa nem enxerga o ticket (404, isolamento D-cross-company);
- OWNER que não é o solicitante NÃO fecha um ticket restrito (conteúdo
  mascarado, `is_content_visible_to` continua valendo);
- fechar de novo é recusado;
- a pesquisa de satisfação nasce igual ao fechamento do agente.
"""

import pytest
from django.utils import timezone

from apps.tickets.models import SatisfactionSurvey, TicketStatus
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


class TestEncerrarPelaRota:
    def test_solicitante_encerra_sem_campos_de_resolucao(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(ana).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 200, resp.data
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.closed_by == ana
        # D4 é do trabalho TÉCNICO de quem atende — o cliente não preenche isso
        assert ticket.resolution_started_at is None
        assert ticket.resolution_ended_at is None

    def test_owner_da_empresa_tambem_encerra(self, api, make_ticket, ana, olga, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(olga).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 200, resp.data
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.closed_by == olga

    def test_colega_sem_papel_de_responsavel_nao_encerra(self, api, make_ticket, ana, beto, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(beto).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 400
        ticket.refresh_from_db()
        assert ticket.status != TicketStatus.CLOSED

    def test_cliente_de_outra_empresa_nem_enxerga_o_ticket(self, api, make_ticket, ana, carla, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(carla).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 404

    def test_owner_nao_encerra_ticket_restrito_que_nao_e_dele(
        self, api, make_ticket, ana, olga, financeiro
    ):
        """Restrito = só quem abriu vê o conteúdo (D1) — OWNER da empresa não
        contorna essa trava só por ser titular."""
        ticket = make_ticket(ana, financeiro)
        resp = api(olga).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 400
        ticket.refresh_from_db()
        assert ticket.status != TicketStatus.CLOSED

    def test_ja_fechado_nao_fecha_de_novo(self, api, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.close_ticket_by_requester(ticket=ticket, actor=ana)
        resp = api(ana).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 400

    def test_agente_interno_continua_exigindo_os_campos_de_resolucao(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        """A MESMA rota — mas pelo lado interno, D4 continua obrigatório."""
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/close/", {}, format="json")
        assert resp.status_code == 400
        assert "resolution_started_at" in resp.data


class TestEfeitosColaterais:
    def test_abre_pesquisa_de_satisfacao_igual_ao_fechamento_do_agente(
        self, make_ticket, ana, suporte, django_capture_on_commit_callbacks
    ):
        ticket = make_ticket(ana, suporte)
        with django_capture_on_commit_callbacks(execute=True):
            ticket_service.close_ticket_by_requester(ticket=ticket, actor=ana)
        survey = SatisfactionSurvey.objects.get(ticket=ticket)
        assert survey.score is None

    def test_note_chega_ao_evento_de_fechamento(self, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.close_ticket_by_requester(ticket=ticket, actor=ana, note="resolvi por conta própria")
        evento = ticket.status_events.filter(to_status=TicketStatus.CLOSED).latest("id")
        assert evento.note == "resolvi por conta própria"

    def test_agente_nao_pode_usar_o_fechamento_do_cliente_direto_no_servico(
        self, make_ticket, ana, suporte, agente_suporte
    ):
        """`close_ticket_by_requester` é só do lado de fora — chamado por um
        interno é rejeitado mesmo direto no serviço, não só pela view."""
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation):
            ticket_service.close_ticket_by_requester(ticket=ticket, actor=agente_suporte)
