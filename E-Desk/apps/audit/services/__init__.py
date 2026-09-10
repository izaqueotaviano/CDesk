"""Camada de aplicação de `audit`.

Nenhum app escreve nas tabelas de auditoria diretamente — só por aqui.
"""

from apps.audit.models import TicketAccessLog


def record_ticket_access(*, ticket, user, context: str, granted: bool, request=None):
    """Log de acesso a ticket de equipe restrita (inclusive negados).

    Chamado em todo retrieve/download de ticket restrito — para agente e admin
    também: o requisito é auditar leitura, não só edição.
    """
    ip = None
    if request is not None:
        ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or \
             request.META.get("REMOTE_ADDR")
    TicketAccessLog.objects.create(
        ticket=ticket, user=user, context=context, was_granted=granted, ip_address=ip or None
    )
