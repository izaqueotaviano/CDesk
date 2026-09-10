"""Mover um chamado de coluna no quadro.

Dois destinos, dois contratos — e a diferença é o pedido do negócio:

- **Coluna de STATUS** (`TicketStage`): arrastar aplica aquele status ao
  chamado, e solta qualquer fixação — ele volta ao fluxo.
- **Coluna de ORGANIZAÇÃO** (`BoardLane`): arrastar FIXA o chamado ali, sem
  tocar no status. É só visual; o SLA, a fila e o cliente seguem lendo o
  status verdadeiro.

Uma trava permanece: nenhum arrasto fecha chamado. Fechar exige as datas de
solução (D4), e chamado fechado nem aparece no quadro — o caminho é o fluxo
de fechamento do ticket.
"""

from django.db import transaction

from apps.kanban.models import Board, BoardLane, Card
from apps.tickets.models import TicketStage, TicketStatus
from apps.tickets.services import ticket_service


class KanbanRuleViolation(Exception):
    pass


class CloseDialogRequired(Exception):
    """Coluna de conclusão: o move só é aceito após o fechamento formal (D4)."""


def _card(board: Board, ticket):
    return Card.objects.filter(board=board, ticket=ticket).first()


@transaction.atomic
def place(*, board: Board, ticket, actor,
          stage: TicketStage | None = None,
          lane: BoardLane | None = None) -> None:
    """Arrastar para uma coluna. Exatamente UM destino: stage ou lane."""
    if (stage is None) == (lane is None):
        raise KanbanRuleViolation("Escolha uma coluna de destino.")

    if lane is not None:
        if lane.board_id != board.pk:
            raise KanbanRuleViolation("Coluna não pertence a este quadro.")
        _fixar(board, ticket, lane, actor)
        return

    if stage.category == TicketStatus.CLOSED and ticket.status != TicketStatus.CLOSED:
        raise CloseDialogRequired(
            "Mover para esta coluna fecha o ticket: conclua o fechamento "
            "(datas de solução) antes."
        )
    ticket_service.mover_para_stage(
        ticket=ticket, stage=stage, actor=actor, board=board
    )
    _soltar(board, ticket)


def _fixar(board, ticket, lane, actor) -> Card:
    card = _card(board, ticket)
    if card is None:
        return Card.objects.create(board=board, ticket=ticket, lane=lane, added_by=actor)
    card.lane = lane
    card.save(update_fields=["lane", "updated_at"])
    return card


def _soltar(board, ticket) -> None:
    """Solta a fixação. A linha só sobrevive se ainda guardar um prazo."""
    card = _card(board, ticket)
    if card is None or card.lane_id is None:
        return
    if card.due_at is None:
        card.delete()
        return
    card.lane = None
    card.save(update_fields=["lane", "updated_at"])


@transaction.atomic
def set_due(*, board: Board, ticket, due_at, actor) -> Card | None:
    """Prazo interno do quadro. A linha só existe enquanto guarda alguma
    coisa — prazo ou fixação."""
    card = _card(board, ticket)
    if card is None:
        if due_at is None:
            return None
        return Card.objects.create(
            board=board, ticket=ticket, due_at=due_at, added_by=actor
        )
    if due_at is None and card.lane_id is None:
        card.delete()
        return None
    card.due_at = due_at
    card.save(update_fields=["due_at", "updated_at"])
    return card
