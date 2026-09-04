"""API de clientes: cota (banner do solicitante) e empresas para filtros."""

from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.customers.models import Company
from apps.customers.services import maintenance as maintenance_service
from apps.customers.services import quota as quota_service


class CompanySerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True)

    class Meta:
        model = Company
        fields = ["id", "name", "slug", "plan_name", "is_active"]


class CompanyViewSet(viewsets.ReadOnlyModelViewSet):
    """Alimenta os filtros de relatório. Cliente enxerga só a própria empresa."""

    serializer_class = CompanySerializer
    # `queryset` só para o SCHEMA — em runtime quem manda é `get_queryset()`,
    # logo abaixo. Sem ele o gerador não descobre o modelo e tipa o `id` da URL
    # como STRING, e a SPA recebia `id: string` para uma chave inteira.
    queryset = Company.objects.none()

    def get_queryset(self):
        qs = Company.objects.select_related("plan").filter(is_active=True).order_by("name")
        if not self.request.user.is_internal:
            return qs.filter(pk=self.request.user.company_id)
        return qs


class MaintenanceSerializer(serializers.Serializer):
    used_minutes = serializers.IntegerField()
    limit_minutes = serializers.IntegerField(allow_null=True)
    period_start = serializers.DateField()
    period_end = serializers.DateField()


class QuotaSerializer(serializers.Serializer):
    used = serializers.IntegerField()
    limit = serializers.IntegerField(allow_null=True)
    period_start = serializers.DateField()
    period_end = serializers.DateField()


@extend_schema(responses=MaintenanceSerializer)
class MaintenanceView(APIView):
    """GET /api/v1/maintenance/ — horas do mês da empresa do usuário.

    Separado de `/quota/` de propósito: são duas franquias com períodos
    diferentes (a de tickets pode ser semanal), e juntá-las num payload só faria
    a tela ter de adivinhar a qual período cada número pertence.
    """

    def get(self, request):
        if request.user.is_internal:
            raise PermissionDenied("Franquia de horas é da empresa cliente.")
        return Response(maintenance_service.usage(request.user.company))


@extend_schema(responses=QuotaSerializer)
class QuotaView(APIView):
    """GET /api/v1/quota/ — uso do período corrente (docs/05 §2.5)."""

    def get(self, request):
        if request.user.is_internal:
            raise PermissionDenied("Cota é do usuário cliente.")
        return Response(quota_service.usage(request.user.company, request.user))
