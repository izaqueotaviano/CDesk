"""Autorização fora do DRF — o mesmo catálogo (`rbac.Perm`), outras portas.

As views da API já têm `HasPerm` (apps/core/permissions.py). Estas duas
peças cobrem o que NÃO é uma view do DRF e ainda assim decide algo sobre
tickets: uma view comum do Django (download de anexo, export), um
management command chamado por alguém, um mixin para ViewSets que listam
tickets e não podem esquecer o escopo.

A regra continua a mesma de sempre: permissão é `user.can(Perm.X)`, escopo
de leitura é `Ticket.objects.visible_to(user)`. Aqui só há atalhos para
ninguém reescrever isso na mão.
"""

from functools import wraps

from django.core.exceptions import PermissionDenied
from django.http import JsonResponse


def require_perm(*perms: str, any_of: bool = False):
    """Decorator para view comum do Django (função ou método `dispatch`).

    ::

        @require_perm(Perm.TICKET_VIEW)
        def baixar_anexo(request, pk): ...

        @require_perm(Perm.REPORT_VIEW, Perm.AUDIT_VIEW, any_of=True)
        def exportar(request): ...

    Anônimo recebe 401 (é o que a SPA espera para mandar ao login);
    autenticado sem a permissão recebe 403. Nunca redireciona: este backend
    é API pura, e um 302 para /login numa chamada `fetch` vira um erro mudo.
    """

    def decorator(view):
        @wraps(view)
        def wrapper(request, *args, **kwargs):
            user = request.user
            if not user.is_authenticated:
                return JsonResponse({"detail": "Faça login para continuar."}, status=401)
            ok = (any if any_of else all)(user.can(p) for p in perms)
            if not ok:
                return JsonResponse(
                    {"detail": "Você não tem permissão para esta ação."}, status=403
                )
            return view(request, *args, **kwargs)

        return wrapper

    return decorator


class EscopoDeTicketMixin:
    """Para ViewSets que listam tickets ou algo pendurado neles (mensagens,
    anexos, eventos): o queryset SEMPRE nasce de `visible_to(user)`.

    ::

        class AnexoViewSet(EscopoDeTicketMixin, viewsets.ReadOnlyModelViewSet):
            queryset = TicketAttachment.objects.all()
            caminho_ate_o_ticket = "message__ticket"

    Um `get_queryset` que esquece o escopo devolve a fila inteira da
    empresa errada — é a classe de bug que o teste estrutural de
    `apps/tickets/tests` caça. O mixin torna o esquecimento impossível: a
    view herda o filtro em vez de lembrar dele.
    """

    #: caminho ORM do model da view até o `Ticket` ("" quando a view é de tickets)
    caminho_ate_o_ticket: str = ""

    def get_queryset(self):
        from apps.tickets.models import Ticket

        qs = super().get_queryset()
        visiveis = Ticket.objects.visible_to(self.request.user)
        if not self.caminho_ate_o_ticket:
            return qs.filter(pk__in=visiveis.values("pk"))
        return qs.filter(**{f"{self.caminho_ate_o_ticket}__in": visiveis})


def garantir_conteudo_visivel(ticket, user) -> None:
    """Para código de serviço (fora de view): levanta `PermissionDenied` se o
    usuário não pode ver o CONTEÚDO do ticket — a regra de ticket restrito,
    que `visible_to` deixa passar mascarado de propósito."""
    if not ticket.is_content_visible_to(user):
        raise PermissionDenied("Você não tem acesso ao conteúdo deste ticket.")
