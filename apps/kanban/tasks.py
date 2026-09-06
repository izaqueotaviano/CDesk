"""Alarme do prazo interno do quadro.

O prazo do card ("Proprietário e prazo…") sempre foi digitável e nunca
avisou ninguém — vencia em silêncio. A varredura roda pelo beat e notifica
UMA vez por vencimento: o responsável do ticket, ou o proprietário (owner),
ou o supervisor da equipe — o primeiro que existir.
"""

from celery import shared_task
from django.utils import timezone


@shared_task
def warn_overdue_cards() -> int:
    from apps.kanban.models import Card
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import already_notified, notify, ticket_url
    from apps.tickets.models import TicketStatus

    agora = timezone.now()
    vencidos = (
        Card.objects.filter(due_at__lt=agora)
        .exclude(ticket__status=TicketStatus.CLOSED)
        .select_related("ticket__assignee", "ticket__owner", "ticket__team__supervisor",
                        "board")
    )

    avisados = 0
    for card in vencidos:
        ticket = card.ticket
        destinatario = ticket.assignee or ticket.owner or ticket.team.supervisor
        if destinatario is None:
            continue
        # um aviso por vencimento: mexer no prazo pra frente zera a régua
        if already_notified(
            recipient=destinatario, kind=NotificationKind.KANBAN_DUE,
            ticket=ticket, since=card.due_at,
        ):
            continue
        notify(
            recipient=destinatario,
            kind=NotificationKind.KANBAN_DUE,
            title=f"Prazo do quadro vencido: {ticket.reference}",
            body=f"{ticket.subject} — quadro {card.board.name}",
            url=ticket_url(ticket, destinatario),
            ticket=ticket,
        )
        avisados += 1
    return avisados
