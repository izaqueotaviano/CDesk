"""API de clientes: cota (banner do solicitante) e empresas para filtros."""

from django.contrib.contenttypes.models import ContentType
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.validators import UniqueValidator
from rest_framework.views import APIView

from apps.accounts.rbac import Perm
from apps.audit.models import AuditAction, AuditLog
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


class MyCompanySerializer(serializers.ModelSerializer):
    """A empresa como o PRÓPRIO cliente a vê — Configurações → Empresa.

    Só razão social e CNPJ são editáveis, e só pelo responsável da conta:
    nome fantasia, plano, fuso e gerente de conta são decisão da
    administração — o cliente vê, não muda. Cota e limites já saem em
    `/auth/me/` (`quota`), não se repetem aqui.
    """

    plan_name = serializers.CharField(source="plan.name", read_only=True)
    account_manager_name = serializers.CharField(
        source="account_manager.full_name", read_only=True, default=None
    )
    members = serializers.SerializerMethodField()
    domains = serializers.SerializerMethodField()
    tax_id = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, max_length=20,
        validators=[UniqueValidator(
            queryset=Company.objects.all(),
            message="Este CNPJ já está cadastrado em outra empresa.",
        )],
    )

    class Meta:
        model = Company
        fields = [
            "id", "name", "legal_name", "tax_id", "plan_name", "timezone",
            "account_manager_name", "contract_started_at", "members", "domains",
        ]
        read_only_fields = [
            "id", "name", "plan_name", "timezone", "account_manager_name",
            "contract_started_at",
        ]

    def get_members(self, obj) -> int:
        """Quantas pessoas da empresa têm acesso — dá contexto ao responsável."""
        return obj.users.filter(is_active=True).count()

    def get_domains(self, obj) -> list[str]:
        return list(obj.domains.order_by("domain").values_list("domain", flat=True))

    def validate_tax_id(self, value):
        # `unique=True, null=True`: vazio precisa virar NULL, senão duas
        # empresas sem CNPJ colidem entre si.
        value = (value or "").strip()
        return value or None


class MyCompanyView(APIView):
    """GET/PATCH /api/v1/me/company/ — a empresa de quem está pedindo.

    Self-service do portal: sempre `request.user.company`, nunca um id na
    URL — não existe como pedir a de outra empresa. Interno não tem empresa
    cliente (403). Editar exige `portal.company_edit` (o responsável tem;
    um membro comum só lê), e toda mudança vai para a trilha de auditoria:
    CNPJ e razão social são dado fiscal, precisa dar para saber quem mexeu.
    """

    def _company(self, request) -> Company:
        if request.user.is_internal or request.user.company_id is None:
            raise PermissionDenied("Esta tela é da empresa cliente.")
        return Company.objects.select_related("plan", "account_manager").get(
            pk=request.user.company_id
        )

    @extend_schema(responses=MyCompanySerializer)
    def get(self, request):
        return Response(MyCompanySerializer(self._company(request)).data)

    @extend_schema(request=MyCompanySerializer, responses=MyCompanySerializer)
    def patch(self, request):
        company = self._company(request)
        if not request.user.can(Perm.PORTAL_COMPANY_EDIT):
            raise PermissionDenied(
                "Só o responsável pela conta altera os dados da empresa."
            )
        antes = {"legal_name": company.legal_name, "tax_id": company.tax_id}
        ser = MyCompanySerializer(company, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        mudancas = {
            campo: [valor, getattr(company, campo)]
            for campo, valor in antes.items()
            if valor != getattr(company, campo)
        }
        if mudancas:
            AuditLog.objects.create(
                actor=request.user,
                action=AuditAction.UPDATE,
                content_type=ContentType.objects.get_for_model(Company),
                object_id=str(company.pk),
                changes=mudancas,
                summary="Dados da empresa alterados pelo responsável, no portal",
            )
        return Response(ser.data)
