"""API de notificações in-app: listagem, contador e marcação de leitura."""

from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.models import Notification, NotificationKind, NotificationPreference
from apps.notifications.serializers import NotificationSerializer


class NotificationViewSet(viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    # `queryset` só para o SCHEMA — em runtime quem manda é `get_queryset()`,
    # logo abaixo. Sem ele o gerador não descobre o modelo e tipa o `id` da URL
    # como STRING, e a SPA recebia `id: string` para uma chave inteira.
    queryset = Notification.objects.none()

    def get_queryset(self):
        return Notification.objects.filter(
            recipient=self.request.user
        ).select_related("actor").order_by("-created_at")

    def list(self, request):
        qs = self.get_queryset()
        if request.query_params.get("unread") == "1":
            qs = qs.filter(read_at__isnull=True)
        page = self.paginate_queryset(qs)
        ser = self.get_serializer(page, many=True)
        resp = self.get_paginated_response(ser.data)
        resp.data["unread_count"] = self.get_queryset().filter(
            read_at__isnull=True
        ).count()
        return resp

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        updated = self.get_queryset().filter(pk=pk, read_at__isnull=True).update(
            read_at=timezone.now()
        )
        return Response({"marked_read": updated})

    @action(detail=False, methods=["post"], url_path="read-all")
    def read_all(self, request):
        updated = self.get_queryset().filter(read_at__isnull=True).update(
            read_at=timezone.now()
        )
        return Response({"marked_read": updated})


DEFAULT_IN_APP = {kind: True for kind, _ in NotificationKind.choices}
# Precisa bater com o default de `quer_email()` em services/__init__.py — os
# dois já divergiram uma vez (aqui `False`, lá `True`): a tela mostrava
# "e-mail desligado" para quem nunca configurou nada, e o serviço mandava o
# e-mail do mesmo jeito. `TestPreferenciaPadrao` trava essa paridade.
DEFAULT_EMAIL = {kind: True for kind, _ in NotificationKind.choices}


class NotificationPreferenceSerializer(serializers.Serializer):
    in_app = serializers.DictField(child=serializers.BooleanField(), required=False)
    email = serializers.DictField(child=serializers.BooleanField(), required=False)

    def validate(self, data):
        """Só aceita chaves que existem — evita a preferência acumular lixo de
        versões antigas do frontend."""
        valid = {kind for kind, _ in NotificationKind.choices}
        for field in ("in_app", "email"):
            unknown = set(data.get(field, {})) - valid
            if unknown:
                raise serializers.ValidationError(
                    {field: f"Tipos desconhecidos: {sorted(unknown)}"}
                )
        return data


@extend_schema(
    request=NotificationPreferenceSerializer,
    responses=NotificationPreferenceSerializer,
)
class NotificationPreferenceView(APIView):
    """GET/PUT das preferências do próprio usuário."""

    def get(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        return Response({
            "in_app": {**DEFAULT_IN_APP, **(pref.in_app or {})},
            "email": {**DEFAULT_EMAIL, **(pref.email or {})},
            "kinds": [{"value": v, "label": label} for v, label in NotificationKind.choices],
        })

    def put(self, request):
        ser = NotificationPreferenceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        if "in_app" in ser.validated_data:
            pref.in_app = {**(pref.in_app or {}), **ser.validated_data["in_app"]}
        if "email" in ser.validated_data:
            pref.email = {**(pref.email or {}), **ser.validated_data["email"]}
        pref.save()
        return self.get(request)
