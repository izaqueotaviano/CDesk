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
    from apps.notifications.services import (
        already_notified,
        notify,
        quer_email,
        queue_email,
        ticket_url,
    )
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
        titulo = f"Prazo do quadro vencido: {ticket.reference}"
        corpo = f"{ticket.subject} — quadro {card.board.name}"
        url = ticket_url(ticket, destinatario)
        notify(
            recipient=destinatario,
            kind=NotificationKind.KANBAN_DUE,
            title=titulo,
            body=corpo,
            url=url,
            ticket=ticket,
        )
        # KANBAN_DUE avisa quem responde pelo card (agente, dono técnico ou
        # supervisor) — mas a preferência que vale é sempre a PESSOAL de
        # quem recebe, a mesma tela de Minha conta > Notificações de
        # qualquer usuário interno.
        if destinatario.email and quer_email(destinatario, NotificationKind.KANBAN_DUE):
            from django.conf import settings

            queue_email(
                to=destinatario.email,
                subject=titulo,
                template="kanban_due",
                context={
                    "agent_name": destinatario.full_name,
                    "reference": ticket.reference,
                    "subject": ticket.subject,
                    "board": card.board.name,
                    "link": f"{settings.SITE_URL}{url}",
                },
                ticket=ticket,
                # um aviso por vencimento (mesma régua do `already_notified`
                # acima): `since=card.due_at` no dedupe in-app, aqui o próprio
                # prazo no dedupe_key cumpre o mesmo papel
                dedupe_key=f"kanban-due:{card.pk}:{card.due_at:%Y%m%d%H%M%S}",
            )
        avisados += 1
    return avisados
