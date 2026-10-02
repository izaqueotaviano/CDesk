"""Quem pode ser Responsável (assignee) ou Dono técnico (owner) de um ticket.

Pergunta DIFERENTE da de `mentions.alvos_de_mencao`: lá é "quem posso
@mencionar" (qualquer agente ativo, para avisar/trazer alguém pro caso); aqui
é "quem esta lista pode oferecer nos seletores de Responsável/Dono técnico
sem o back depois recusar com 400". As duas listas parecem a mesma coisa (as
duas são "agentes ativos") mas erram nas duas pontas se uma servir a outra:

- o requester precisa aparecer aqui — é como o "Assumir" funciona pelo
  seletor, não só pelo botão dedicado (que some com o ticket fechado). Por
  isso NÃO há `.exclude(pk=requester.pk)` como em `alvos_de_mencao`.
- papel entra no filtro: agente leve é INTERNAL e ativo, mas não pode ser
  responsável (`ticket_service.assign`/`set_owner` recusam com
  `TicketRuleViolation` → 400). Oferecê-lo no seletor é prometer uma
  atribuição que a própria regra de negócio nunca aceita.

A permissão é a mesma que `assign()` e `set_owner()` já checam
(apps/tickets/services/ticket_service.py:642 e :690):
`usuario.can(Perm.TICKET_BE_ASSIGNED)`. Nenhuma das duas filtra por equipe do
ticket — esta lista também não; é a permissão do papel, não o time, que
decide quem pode assumir.
"""

from __future__ import annotations

from apps.accounts.models import User, UserKind
from apps.accounts.rbac import Perm


def agentes_atribuiveis() -> list[dict]:
    """Agentes que `assign()`/`set_owner()` aceitariam, na ordem do seletor.

    Sem parâmetro de ticket de propósito: como as duas funções que esta lista
    serve não recortam por equipe, a lista também não — vale para qualquer
    ticket que o chamador tenha acesso (isso é responsabilidade da view, via
    `get_object()`, não desta função).
    """
    return [
        {
            "id": agente.pk,
            "name": agente.full_name,
            "email": agente.email,
            "avatar_url": agente.avatar_url or "",
        }
        for agente in User.objects.filter(
            kind=UserKind.INTERNAL, is_active=True
        )
        # `select_related`: `.can()` olha `custom_role` por usuário — sem
        # isso, cada chamada seria uma query (N+1) numa lista que já é toda
        # carregada de propósito (ver docstring do módulo).
        .select_related("custom_role").order_by("full_name")
        if agente.can(Perm.TICKET_BE_ASSIGNED)
    ]
