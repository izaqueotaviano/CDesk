"""Camada de leitura de `tickets`.

Todo acesso de leitura a tickets passa por aqui. `Ticket.objects.all()` fora
deste módulo é proibido e verificado por teste estrutural (docs/04).
"""

from apps.tickets.models import Ticket


def visible_tickets(user):
    """QuerySet base de qualquer listagem/consulta de tickets para `user`."""
    return (
        Ticket.objects.visible_to(user)
        # `category__service` entra aqui porque o TicketListSerializer lê
        # category.name e category.service.name em toda linha: sem isto, uma
        # página de 25 tickets com categoria dispara 25 queries a mais
        # (medido: 4 → 29). Os outros quatro já cobrem os campos que o
        # serializer toca (empresa, solicitante, responsável, equipe).
        .select_related("team", "requester", "assignee", "company", "category__service")
    )


def visible_ticket_or_none(user, ticket_id):
    """Busca um ticket dentro do escopo do usuário; fora do escopo = não existe."""
    return visible_tickets(user).filter(pk=ticket_id).first()
