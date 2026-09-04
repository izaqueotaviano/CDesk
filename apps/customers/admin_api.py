"""Configuração comercial pela API: planos, empresas clientes e cota."""

import re

from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.admin_api import UserAdminSerializer, send_invite
from apps.accounts.models import UserKind
from apps.core.permissions import IsAdmin, IsInternalReadAdminWrite
from apps.core.serializer_fields import slug_unico
from apps.customers.models import (
    Company,
    CompanyChatEmbed,
    CompanyChatEmbedOrigin,
    CompanyDomain,
    Plan,
)
from apps.customers.services import maintenance as maintenance_service
from apps.customers.services import quota as quota_service
from apps.customers.services.embed import generate_secret

# scheme://host[:porta], sem caminho, sem barra final — é exatamente o que o
# header `Origin` do navegador manda, e é contra isso que a origem cadastrada
# é comparada (apps.customers.services.embed.resolve_trusted_origin). Uma
# origem cadastrada sem o `https://` nunca bateria com nada, em silêncio —
# por isso a validação aqui, não só a normalização.
_ORIGIN_RE = re.compile(r"^https?://[a-z0-9.-]+(:\d+)?$")


class PlanAdminSerializer(serializers.ModelSerializer):
    slug = slug_unico(Plan, o_que="um plano")
    company_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Plan
        fields = [
            "id", "slug", "name", "description", "is_active", "rank",
            "default_ticket_limit", "default_limit_period",
            "monthly_maintenance_minutes",
            "chat_enabled", "chat_consumes_quota", "company_count",
        ]


class PlanAdminViewSet(viewsets.ModelViewSet):
    # company_count por annotate: um GROUP BY em vez de um COUNT por linha
    queryset = Plan.objects.annotate(
        company_count=Count("companies")
    ).order_by("-rank")
    serializer_class = PlanAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_destroy(self, instance):
        # plano em uso é PROTECT no banco; desativar é o caminho
        instance.is_active = False
        instance.save(update_fields=["is_active"])


class CompanyAdminSerializer(serializers.ModelSerializer):
    slug = slug_unico(Company, o_que="uma empresa")
    plan_name = serializers.CharField(source="plan.name", read_only=True)
    user_count = serializers.IntegerField(read_only=True)
    effective_limit = serializers.SerializerMethodField()
    effective_period = serializers.SerializerMethodField()
    quota_usage = serializers.SerializerMethodField()
    effective_maintenance_minutes = serializers.SerializerMethodField()
    maintenance_usage = serializers.SerializerMethodField()
    # Lista simples de strings pra tela (GAPS.md #11), não os ids de
    # CompanyDomain — a tela edita "quais domínios", nunca as linhas em si.
    # `write_only`: `instance.domains` é o related manager reverso de
    # CompanyDomain, não uma lista pronta — deixar o DRF tentar serializá-lo
    # sozinho estoura ("RelatedManager não é iterável"). A LEITURA sai só de
    # `to_representation`, que monta a lista com uma query própria.
    domains = serializers.ListField(
        child=serializers.CharField(max_length=190), required=False, write_only=True,
        help_text="Domínios de e-mail vinculados (ex.: 'convertize.com.br'). Substitui o conjunto.",
    )

    class Meta:
        model = Company
        fields = [
            "id", "name", "legal_name", "tax_id", "slug", "plan", "plan_name",
            "is_active", "ticket_limit", "limit_period", "limit_scope",
            "timezone", "business_calendar", "account_manager",
            "contract_started_at", "contract_ended_at", "notes", "domains",
            "user_count", "effective_limit", "effective_period", "quota_usage",
            "maintenance_minutes", "effective_maintenance_minutes", "maintenance_usage",
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["domains"] = list(
            instance.domains.order_by("domain").values_list("domain", flat=True)
        )
        return data

    def validate_domains(self, domains):
        """Domínio é de NO MÁXIMO uma empresa (é o que torna o vínculo
        automático determinístico) — recusa em vez de "roubar" o domínio de
        outra empresa em silêncio."""
        limpos = {d.strip().lower().lstrip("@") for d in domains if d.strip()}
        de_outra = (
            CompanyDomain.objects.filter(domain__in=limpos)
            .exclude(company=self.instance)
            .select_related("company")
        )
        if conflito := de_outra.first():
            raise serializers.ValidationError(
                f"O domínio '{conflito.domain}' já pertence a "
                f"'{conflito.company.name}'."
            )
        return domains

    def _sync_domains(self, company, domains):
        """Substitui o conjunto de domínios pelo enviado — mesma semântica de
        `tags`/`seguidores` no resto do sistema (lista enviada = lista final)."""
        limpos = {d.strip().lower().lstrip("@") for d in domains if d.strip()}
        existentes = set(company.domains.values_list("domain", flat=True))
        CompanyDomain.objects.filter(company=company, domain__in=existentes - limpos).delete()
        CompanyDomain.objects.bulk_create(
            [CompanyDomain(company=company, domain=d) for d in limpos - existentes]
        )

    def create(self, validated_data):
        domains = validated_data.pop("domains", None)
        company = super().create(validated_data)
        if domains is not None:
            self._sync_domains(company, domains)
        return company

    def update(self, instance, validated_data):
        domains = validated_data.pop("domains", None)
        company = super().update(instance, validated_data)
        if domains is not None:
            self._sync_domains(company, domains)
        return company

    def get_effective_limit(self, obj) -> int | None:
        return obj.effective_ticket_limit

    def get_effective_period(self, obj) -> str:
        return obj.effective_limit_period

    def get_effective_maintenance_minutes(self, obj) -> int | None:
        return obj.effective_maintenance_minutes

    def get_maintenance_usage(self, obj) -> dict:
        """Horas do mês — a mesma barra que o cliente vê, do nosso lado."""
        usage = maintenance_service.usage(obj)
        return {**usage,
                "period_start": usage["period_start"].isoformat(),
                "period_end": usage["period_end"].isoformat()}

    def get_quota_usage(self, obj) -> dict:
        """Uso do período corrente — a tela de empresa mostra sem outra chamada."""
        usage = quota_service.usage(obj)
        return {**usage,
                "period_start": usage["period_start"].isoformat(),
                "period_end": usage["period_end"].isoformat()}


class CompanyAdminViewSet(viewsets.ModelViewSet):
    # user_count por annotate; quota_usage/maintenance_usage seguem por linha
    # (COUNT/SUM do período) — aceitável na escala de dezenas de empresas, é o
    # próximo ponto a revisar se a lista crescer muito.
    queryset = (
        Company.objects.select_related("plan")
        .annotate(user_count=Count("users"))
        .order_by("name")
    )
    serializer_class = CompanyAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_destroy(self, instance):
        # LGPD (D11): empresa nunca é apagada — desativa, e anonimiza sob pedido
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @action(detail=True, methods=["get"])
    def quota(self, request, pk=None):
        company = self.get_object()
        usage = quota_service.usage(company)
        return Response({**usage,
                         "period_start": usage["period_start"].isoformat(),
                         "period_end": usage["period_end"].isoformat()})

    @extend_schema(responses=UserAdminSerializer(many=True))
    @action(detail=True, methods=["get", "post"], url_path="users")
    def users(self, request, pk=None):
        """Os usuários DESTA empresa — e a criação de mais um dentro dela.

        A empresa vem da URL, nunca do corpo. Quem está na tela da empresa já
        respondeu "de quem é esta pessoa" ao chegar aqui; repetir a pergunta
        como um select de empresas é oferecer a chance de errá-la, e errar
        aqui põe alguém dentro do isolamento de dados da empresa errada.
        """
        company = self.get_object()
        if request.method == "GET":
            usuarios = (
                company.users.filter(kind=UserKind.CLIENT)
                .select_related("company")
                .prefetch_related("team_links")
                .order_by("full_name")
            )
            return Response(UserAdminSerializer(usuarios, many=True).data)

        # POST — escrita é de admin, como no resto das telas de configuração
        if not IsAdmin().has_permission(request, self):
            return Response({"detail": IsAdmin.message}, status=403)

        serializer = UserAdminSerializer(data={
            **request.data,
            "kind": UserKind.CLIENT,
            "company": company.pk,
            "internal_role": None,
        })
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        # senha nunca é digitada por quem cadastra: ela nasce do convite
        user.set_unusable_password()
        user.save(update_fields=["password"])
        send_invite(user)
        return Response(UserAdminSerializer(user).data, status=201)

    # ------------------------------------------------------------------ #
    # Mini chat embutido (docs/14-seguranca.md §10)
    # ------------------------------------------------------------------ #

    @action(detail=True, methods=["get", "patch"], url_path="chat-embed")
    def chat_embed(self, request, pk=None):
        """GET: estado atual (nunca a chave crua — ver `regenerate-secret`).
        PATCH: liga/desliga e/ou substitui o conjunto de origens (mesma
        semântica de `domains` — lista enviada é a lista final)."""
        company = self.get_object()
        # nasce sob pedido, desligado: a primeira leitura da tela já cria a
        # linha, mas ninguém fica embutível só por isso.
        embed, _ = CompanyChatEmbed.objects.get_or_create(company=company)

        if request.method == "PATCH":
            if not IsAdmin().has_permission(request, self):
                return Response({"detail": IsAdmin.message}, status=403)
            if "enabled" in request.data:
                embed.enabled = bool(request.data["enabled"])
                embed.save(update_fields=["enabled"])
            if "origins" in request.data:
                origins = request.data.get("origins")
                if not isinstance(origins, list):
                    raise ValidationError({"origins": "Envie uma lista de origens."})
                self._sync_embed_origins(embed, origins)

        return Response(self._serialize_embed(embed))

    @action(detail=True, methods=["post"], url_path="chat-embed/regenerate-secret")
    def chat_embed_regenerate_secret(self, request, pk=None):
        """A chave só existe em texto puro NESTA resposta — quem chama
        precisa copiar pro backend do outro lado agora; depois disso ela
        volta a ser só o que assina, nunca o que se lê. Trocar a chave
        invalida na hora qualquer snippet com a antiga (é o "revogar" —
        não existe desligar só uma chave velha, existe substituir)."""
        if not IsAdmin().has_permission(request, self):
            return Response({"detail": IsAdmin.message}, status=403)
        company = self.get_object()
        embed, _ = CompanyChatEmbed.objects.get_or_create(company=company)
        embed.secret = generate_secret()
        embed.save(update_fields=["secret", "rotated_at"])
        return Response({"secret": embed.secret})

    @staticmethod
    def _sync_embed_origins(embed, origins):
        limpas = set()
        for bruta in origins:
            o = bruta.strip().rstrip("/").lower()
            if not o:
                continue
            if not _ORIGIN_RE.match(o):
                raise ValidationError({
                    "origins": f"'{bruta}' não é uma origem válida. Use o formato "
                               "https://dominio.com.br, sem caminho e sem barra final.",
                })
            limpas.add(o)
        existentes = set(embed.origins.values_list("origin", flat=True))
        CompanyChatEmbedOrigin.objects.filter(embed=embed, origin__in=existentes - limpas).delete()
        CompanyChatEmbedOrigin.objects.bulk_create(
            [CompanyChatEmbedOrigin(embed=embed, origin=o) for o in limpas - existentes]
        )

    @staticmethod
    def _serialize_embed(embed) -> dict:
        return {
            "enabled": embed.enabled,
            "origins": list(embed.origins.order_by("origin").values_list("origin", flat=True)),
            "rotated_at": embed.rotated_at.isoformat(),
        }
