"""API do mural.

Leitura: qualquer usuário autenticado, filtrada pela audiência no service.
Escrita: só admin (requisito 2/4) — supervisor e agente não publicam avisos.
"""

from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.response import Response

from apps.announcements.models import Announcement, AnnouncementRead
from apps.announcements.serializers import AnnouncementSerializer
from apps.announcements.services import announcements_for


class AnnouncementViewSet(viewsets.ModelViewSet):
    serializer_class = AnnouncementSerializer
    # `queryset` só para o SCHEMA — em runtime quem manda é `get_queryset()`,
    # logo abaixo. Sem ele o gerador não descobre o modelo e tipa o `id` da URL
    # como STRING, e a SPA recebia `id: string` para uma chave inteira.
    queryset = Announcement.objects.none()

    def get_queryset(self):
        user = self.request.user
        if self.action in ("list", "retrieve"):
            is_admin = user.is_internal and user.is_admin
            history = self.request.query_params.get("history") == "1"
            # `manage=1`: tela de administração — o admin gerencia TODOS os avisos,
            # inclusive os que mira em outros públicos (senão não consegue editar
            # um aviso feito para clientes) e os que ele mesmo desativou.
            manage = is_admin and self.request.query_params.get("manage") == "1"
            if manage:
                qs = self._manage_queryset(include_inactive=history)
            else:
                qs = announcements_for(user, include_expired=is_admin and history)
            return qs.annotate(
                user_dismissed=Exists(
                    AnnouncementRead.objects.filter(
                        announcement=OuterRef("pk"), user=user, dismissed=True
                    )
                )
            )
        return Announcement.objects.all()

    @staticmethod
    def _manage_queryset(*, include_inactive):
        """Visão do administrador, sem filtro de audiência.

        Histórico traz tudo (desativados e expirados); vigentes traz só o que
        está no ar agora — ativo e dentro da vigência.
        """
        qs = Announcement.objects.all()
        if not include_inactive:
            now = timezone.now()
            qs = qs.filter(is_active=True, starts_at__lte=now).filter(
                Q(ends_at__isnull=True) | Q(ends_at__gte=now)
            )
        return qs.order_by("-is_pinned", "-starts_at")

    def _require_admin(self):
        user = self.request.user
        if not (user.is_internal and user.is_admin):
            raise PermissionDenied("Apenas administradores gerenciam avisos.")

    def perform_create(self, serializer):
        self._require_admin()
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        # histórico é requisito: aviso não é apagado, é desativado
        self._require_admin()
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @action(detail=True, methods=["post"])
    def dismiss(self, request, pk=None):
        """Usuário oculta o aviso do próprio dashboard (não o apaga).

        Só se pode dispensar o que se poderia ver: sem o filtro de audiência,
        `get_object()` cairia em `Announcement.objects.all()` e um cliente
        conseguiria dispensar — e assim CONFIRMAR a existência de — um aviso
        interno pelo id. 404 para o que está fora da audiência não vaza nada.
        """
        user = request.user
        announcement = announcements_for(user).filter(pk=pk).first()
        if announcement is None:
            raise NotFound
        AnnouncementRead.objects.update_or_create(
            announcement=announcement, user=user,
            defaults={"dismissed": True},
        )
        return Response({"dismissed": True})
