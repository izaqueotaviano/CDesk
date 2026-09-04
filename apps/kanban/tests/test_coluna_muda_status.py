"""O contrato de arrastar: quem muda status e quem não muda.

Duas espécies de coluna, duas respostas, e o quadro precisa ser previsível nas
duas:

- coluna de STATUS (`TicketStage`) — arrastar muda o status do chamado;
- coluna PERSONALIZADA (`BoardLane`) — arrastar organiza e não encosta no
  status.

E a coluna de CONCLUSÃO precisa existir. Ela ficava de fora da lista de
colunas, então não havia onde soltar para concluir um chamado — o gesto mais
natural do quadro não tinha destino, e o efeito prático era "mudar de coluna
não funciona".
"""

import pytest
from django.utils import timezone

from apps.kanban.models import BoardLane
from apps.tickets.models import TicketStage, TicketStatus
from apps.tickets.services import ticket_service

from .test_kanban import (  # noqa: F401 — fixtures do cenário compartilhado
    admin,
    agente,
    ana,
    api,
    board,
    cols,
    suporte,
    ticket,
)

pytestmark = pytest.mark.django_db


def _colunas(api_client, board):
    return api_client.get(f"/api/v1/kanban/boards/{board.pk}/cards/").json()["columns"]


class TestColunaDeStatus:
    def test_arrastar_para_coluna_de_status_muda_o_status(
        self, api, agente, board, ticket, cols
    ):
        assert ticket.status == TicketStatus.NEW
        resp = api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "stage_id": cols["Aberto"].pk}, format="json",
        )
        assert resp.status_code == 200, resp.data
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.stage_id == cols["Aberto"].pk

    def test_status_criado_pelo_admin_aplica_a_categoria_dele(
        self, api, agente, board, ticket
    ):
        """Um status próprio move o chamado para a categoria em que ele nasceu.

        É o que permite "Em análise" existir sem que o SLA e os relatórios
        precisem saber que ele existe.
        """
        proprio = TicketStage.objects.create(
            slug="em-analise", name="Em análise", category=TicketStatus.OPEN,
            color="#5A87B8", order=10,
        )
        api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "stage_id": proprio.pk}, format="json",
        )
        ticket.refresh_from_db()
        assert ticket.stage_id == proprio.pk
        assert ticket.status == TicketStatus.OPEN


class TestColunaPersonalizada:
    def test_arrastar_para_lane_nao_muda_o_status(self, api, agente, board, ticket):
        lane = BoardLane.objects.create(board=board, name="Em análise técnica")
        antes = ticket.status
        resp = api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "lane_id": lane.pk}, format="json",
        )
        assert resp.status_code == 200, resp.data
        ticket.refresh_from_db()
        assert ticket.status == antes, "coluna de organização não pode mexer no status"
        assert ticket.cards.get(board=board).lane_id == lane.pk

    def test_sair_da_lane_para_um_status_volta_a_mudar_o_status(
        self, api, agente, board, ticket, cols
    ):
        """A fixação é reversível e não deixa resíduo no status."""
        lane = BoardLane.objects.create(board=board, name="Em análise técnica")
        api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "lane_id": lane.pk}, format="json",
        )
        api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "stage_id": cols["Aguardando retorno"].pk},
            format="json",
        )
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.PENDING_CUSTOMER
        assert not ticket.cards.filter(board=board, lane__isnull=False).exists()


class TestColunaDeConclusao:
    def test_a_coluna_de_conclusao_aparece_no_quadro(self, api, agente, board):
        """Sem ela não há onde soltar para concluir — e era esse o buraco."""
        conclusao = [c for c in _colunas(api(agente), board) if c["concludes"]]
        assert conclusao, "o quadro precisa de um destino para concluir o chamado"
        assert all(c["category"] == TicketStatus.CLOSED for c in conclusao)

    def test_soltar_na_conclusao_pede_a_janela_de_solucao(
        self, api, agente, board, ticket, cols
    ):
        """D4 continua valendo: fechar exige as datas, e o 409 é o pedido delas."""
        resp = api(agente).post(
            f"/api/v1/kanban/boards/{board.pk}/place/",
            {"ticket_id": ticket.pk, "stage_id": cols["Fechado"].pk}, format="json",
        )
        assert resp.status_code == 409
        assert resp.data["code"] == "close_dialog_required"
        ticket.refresh_from_db()
        assert ticket.status != TicketStatus.CLOSED

    def test_chamado_fechado_sai_do_quadro(self, api, agente, board, ticket):
        """A coluna de conclusão é destino, não depósito."""
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        payload = api(agente).get(
            f"/api/v1/kanban/boards/{board.pk}/cards/"
        ).json()
        assert all(e["ticket"] != ticket.pk for e in payload["entries"])


class TestQuadroNaoEscondeChamado:
    def test_ticket_sem_stage_ainda_aparece(self, api, agente, board, ana, suporte):
        """Chamado importado/semeado sem `stage` cai na coluna da categoria.

        Ele existe: dado antigo e importação não passam pelo serviço que
        preenche o stage, e sumir do quadro seria trabalho invisível.
        """
        orfao = ticket_service.create_ticket(
            requester=ana, team=suporte, subject="Sem stage", body="corpo"
        )
        orfao.stage = None
        orfao.save(update_fields=["stage"])

        payload = api(agente).get(f"/api/v1/kanban/boards/{board.pk}/cards/").json()
        entrada = next(
            (e for e in payload["entries"] if e["ticket"] == orfao.pk), None
        )
        assert entrada is not None, "chamado sem stage não pode sumir do quadro"
        coluna = next(c for c in payload["columns"] if c["key"] == entrada["column"])
        assert coluna["category"] == orfao.status
