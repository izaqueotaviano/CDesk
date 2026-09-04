"""Configuração de tickets pela API (telas `/app/settings`).

Status do quadro, categorias, políticas de SLA e etiquetas. Interno lê, admin
escreve. A EQUIPE não está aqui: ela é de `accounts` desde a fusão com o
departamento.
"""

from django.db.models import Count
from django.utils.text import slugify
from rest_framework import serializers, viewsets
from rest_framework.exceptions import ValidationError

from apps.core.permissions import IsInternalReadAdminWrite
from apps.core.serializer_fields import slug_unico
from apps.core.slugs import unique_slug
from apps.tickets.models import (
    COR_POR_CATEGORIA,
    Service,
    SLAPolicy,
    TicketCategory,
    TicketMacro,
    TicketStage,
    TicketTag,
)


class TicketStageSerializer(serializers.ModelSerializer):
    slug = slug_unico(TicketStage, o_que="uma etapa")
    ticket_count = serializers.IntegerField(read_only=True)
    slug = serializers.SlugField(required=False)
    category_label = serializers.CharField(
        source="get_category_display", read_only=True
    )
    # Sem o `default` que o ModelSerializer geraria sozinho a partir do campo
    # do model (o cinza fixo `#8A8A85`, plano para toda categoria): omitida
    # do payload, `perform_create` precisa saber que o cliente NÃO escolheu
    # cor nenhuma, para aplicar a paleta semântica da categoria em vez do
    # cinza — se o model injetasse o default sozinho, essa distinção some.
    color = serializers.CharField(max_length=7, required=False)

    class Meta:
        model = TicketStage
        fields = [
            "id", "name", "slug", "category", "category_label", "color",
            "order", "is_system", "is_active", "ticket_count",
        ]
        read_only_fields = ["is_system"]

    def validate_category(self, value):
        """Status de fábrica não troca de categoria.

        Trocar a categoria de "Fechado" mudaria, de uma vez, o que conta como
        resolvido em todo relatório já emitido e o que o fechamento automático
        alcança. Status criado pelo admin pode mudar; os quatro do sistema são
        o chão em que o resto se apoia.
        """
        if self.instance and self.instance.is_system and value != self.instance.category:
            raise ValidationError(
                "Status de fábrica não muda de categoria — crie um novo."
            )
        return value


class TicketStageViewSet(viewsets.ModelViewSet):
    """Os status do ticket — que são as colunas do quadro.

    Criar um status aqui é criar uma coluna no kanban, e vice-versa: é a mesma
    coisa vista de duas telas. Por isso o quadro não tem CRUD de coluna
    próprio; ele teria de manter uma segunda lista em dia com esta.
    """

    queryset = TicketStage.objects.annotate(
        ticket_count=Count("tickets")
    ).order_by("order", "id")
    serializer_class = TicketStageSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_create(self, serializer):
        slug = serializer.validated_data.get("slug") or unique_slug(
            TicketStage, serializer.validated_data["name"], fallback="status"
        )
        # Cor explícita do admin sempre vence; sem ela, a cor semântica da
        # categoria escolhida — não o cinza fixo do model (ver comentário
        # no campo `color` do serializer, acima).
        color = serializer.validated_data.get("color") or COR_POR_CATEGORIA.get(
            serializer.validated_data["category"],
            TicketStage._meta.get_field("color").get_default(),
        )
        # entra no fim da fila; reordenar é um PATCH de `order`
        ultimo = TicketStage.objects.order_by("-order").first()
        serializer.save(
            slug=slug,
            color=color,
            order=serializer.validated_data.get(
                "order", (ultimo.order + 1) if ultimo else 0
            ),
        )

    def perform_destroy(self, instance):
        """Apagar um status devolve os chamados dele ao status de fábrica da
        MESMA categoria — nenhum chamado fica sem coluna, e nenhum muda de
        significado (continua aberto se estava aberto).

        Os quatro de fábrica não podem ser apagados: são justamente o destino
        deste resgate.
        """
        if instance.is_system:
            raise ValidationError(
                {"detail": "Status de fábrica não pode ser excluído."}
            )
        destino = TicketStage.objects.filter(
            category=instance.category, is_system=True
        ).first()
        if destino is None:
            raise ValidationError(
                {"detail": "Sem status de fábrica nesta categoria para receber os chamados."}
            )
        instance.tickets.update(stage=destino)
        instance.delete()


class ServiceAdminSerializer(serializers.ModelSerializer):
    category_count = serializers.IntegerField(read_only=True)
    slug = serializers.SlugField(required=False)

    class Meta:
        model = Service
        fields = ["id", "name", "slug", "is_active", "order", "category_count"]


class ServiceAdminViewSet(viewsets.ModelViewSet):
    """Serviço — nível acima de Categoria (GAPS.md #4). Interno lê, admin escreve."""

    queryset = Service.objects.annotate(
        category_count=Count("categories")
    ).order_by("order", "name")
    serializer_class = ServiceAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_create(self, serializer):
        slug = serializer.validated_data.get("slug") or unique_slug(
            Service, serializer.validated_data["name"], fallback="servico"
        )
        serializer.save(slug=slug)

    def perform_destroy(self, instance):
        # serviço usado em categoria não some: desativa (o FK é SET_NULL)
        instance.is_active = False
        instance.save(update_fields=["is_active"])


class TicketCategoryAdminSerializer(serializers.ModelSerializer):
    ticket_count = serializers.IntegerField(read_only=True)
    # o admin cadastra só o nome; o slug é identidade interna, derivada
    slug = serializers.SlugField(required=False)
    service_name = serializers.CharField(source="service.name", read_only=True, default=None)

    class Meta:
        model = TicketCategory
        fields = [
            "id", "name", "slug", "service", "service_name",
            "is_active", "order", "ticket_count",
        ]


class TicketCategoryAdminViewSet(viewsets.ModelViewSet):
    queryset = TicketCategory.objects.select_related("service").annotate(
        ticket_count=Count("tickets")
    ).order_by("order", "name")
    serializer_class = TicketCategoryAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_create(self, serializer):
        slug = serializer.validated_data.get("slug") or unique_slug(
            TicketCategory, serializer.validated_data["name"], fallback="categoria"
        )
        serializer.save(slug=slug)

    def perform_destroy(self, instance):
        # categoria usada em ticket não some: desativa, senão o histórico
        # perderia a classificação (o FK é SET_NULL)
        instance.is_active = False
        instance.save(update_fields=["is_active"])


class SLAPolicyAdminSerializer(serializers.ModelSerializer):
    plan_name = serializers.CharField(source="plan.name", read_only=True, default=None)
    team_name = serializers.CharField(
        source="team.name", read_only=True, default=None
    )

    class Meta:
        model = SLAPolicy
        fields = [
            "id", "name", "plan", "plan_name", "team", "team_name",
            "first_response_minutes", "resolution_minutes",
            "use_business_hours", "is_active",
        ]

    def validate(self, data):
        first = data.get("first_response_minutes")
        resolution = data.get("resolution_minutes")
        if first and resolution and resolution < first:
            raise serializers.ValidationError({
                "resolution_minutes":
                    "O prazo de resolução não pode ser menor que o de primeira resposta.",
            })
        return data


class SLAPolicyAdminViewSet(viewsets.ModelViewSet):
    queryset = SLAPolicy.objects.select_related("plan", "team").order_by(
        "plan__rank", "team__order"
    )
    serializer_class = SLAPolicyAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]


class TicketTagSerializer(serializers.ModelSerializer):
    slug = slug_unico(TicketTag, o_que="uma etiqueta")
    """`slug` nasce do nome quando não vem: quem cadastra pela tela digita
    "Cliente VIP", não "cliente-vip" — slug é detalhe de URL, não formulário."""

    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = TicketTag
        fields = ["id", "name", "slug", "color"]

    def validate(self, data):
        if not data.get("slug"):
            if data.get("name"):
                data["slug"] = slugify(data["name"])
            else:
                # PATCH sem nome nem slug: não sobrescrever o slug existente
                data.pop("slug", None)
        return data


class TicketTagViewSet(viewsets.ModelViewSet):
    queryset = TicketTag.objects.all().order_by("name")
    serializer_class = TicketTagSerializer
    permission_classes = [IsInternalReadAdminWrite]


class TicketMacroSerializer(serializers.ModelSerializer):
    """A macro, cadastro único de chamado e chat (ver `TicketMacro`)."""

    category_name = serializers.CharField(
        source="category.name", read_only=True, default=None
    )
    assignee_name = serializers.SerializerMethodField()

    class Meta:
        model = TicketMacro
        fields = [
            "id", "name", "body", "chat_name", "category", "category_name",
            "priority", "assignee", "assignee_name", "tags",
            "is_active", "order",
        ]

    def get_assignee_name(self, obj) -> str | None:
        return obj.assignee.full_name if obj.assignee else None


class TicketMacroViewSet(viewsets.ModelViewSet):
    """Macros de chamado — interno lê (pra aplicar no composer), admin
    gerencia. Aplicar de fato é `POST tickets/{id}/apply-macro/`
    (`TicketViewSet.apply_macro`, em `views.py`) — aqui é só o CRUD."""

    queryset = TicketMacro.objects.select_related("category", "assignee").order_by(
        "order", "name"
    )
    serializer_class = TicketMacroSerializer
    permission_classes = [IsInternalReadAdminWrite]
