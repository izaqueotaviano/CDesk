"""Serializers de tickets.

O mascaramento da equipe restrita acontece AQUI, derivado do backend
(`ticket.is_content_visible_to`) — o frontend só renderiza `is_restricted`
(cadeado), `content_hidden` (ícone "i" + tooltip) e os campos já mascarados.
Nunca há um caminho em que o dado real saia e a UI decida esconder.
"""

from django.utils import timezone
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.accounts import assinatura
from apps.accounts.models import Team
from apps.tickets.models import (
    ScheduledReply,
    Service,
    Ticket,
    TicketAttachment,
    TicketCategory,
    TicketMessage,
    TicketPriority,
    TicketStatus,
    TicketStatusEvent,
    TicketTag,
)
from apps.tickets.services import mentions as mentions_service

MASKED_REQUESTER = "Usuário protegido"

# quanto antes do vencimento o SLA passa a "em risco" na interface
SLA_AT_RISK_MINUTES = 30


class SLAClockSerializer(serializers.Serializer):
    """Um relógio de SLA já resolvido para a UI.

    `state` evita que o frontend refaça a comparação de datas em cada linha —
    e evita que ele erre a regra de "cumprido" (que depende de first_response_at
    e do status, não só do prazo).
    """

    due_at = serializers.DateTimeField(allow_null=True)
    state = serializers.ChoiceField(choices=["none", "met", "ok", "at_risk", "breached"])
    minutes_left = serializers.IntegerField(allow_null=True)


class SLAPairSerializer(serializers.Serializer):
    """Os dois relógios que a fila mostra."""

    first_response = SLAClockSerializer()
    resolution = SLAClockSerializer()


class PlanBadgeSerializer(serializers.Serializer):
    slug = serializers.CharField()
    name = serializers.CharField()


class TeamSerializer(serializers.ModelSerializer):
    """A equipe como o ticket a mostra: identidade e o que a UI precisa para
    desenhar o cadeado. Mora aqui, e não em accounts, porque é esta a forma
    que vai aninhada em toda linha da fila — os campos de configuração da
    equipe ficam no serializer de administração."""

    class Meta:
        model = Team
        # `internal_only` entra porque o seletor de TRANSFERIR equipe (o painel
        # do detalhe) precisa saber quais equipes podem receber chamado de
        # cliente: sem isso a tela oferece a equipe interna, o agente confirma a
        # transferência e só então toma 400 de
        # `ticket_service` ("Equipe interna não pode receber chamado de
        # cliente."). Não é dado sensível — `TeamViewSet.get_queryset` já
        # esconde a equipe inteira de quem é cliente.
        fields = ["id", "name", "slug", "visibility", "order", "internal_only"]


class ServiceSerializer(serializers.ModelSerializer):
    """Serviço, alimentando o seletor de abertura (categoria depende dele
    na tela, GAPS.md #4 — o filtro categoria×serviço é responsabilidade do
    frontend, lendo `TicketCategorySerializer.service`)."""

    class Meta:
        model = Service
        fields = ["id", "name", "slug", "order"]


class TicketCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = TicketCategory
        fields = ["id", "name", "slug", "service", "order"]


class TicketTagPillSerializer(serializers.ModelSerializer):
    """A etiqueta como a fila e o detalhe a desenham — a pílula colorida."""

    class Meta:
        model = TicketTag
        fields = ["id", "name", "slug", "color"]


class TicketAttachmentSerializer(serializers.ModelSerializer):
    """`url` aponta para a view autenticada — nunca para o arquivo direto (D13).

    `scan_status` e `is_downloadable` existem para a UI poder mostrar
    "verificando…" em vez de oferecer um link que vai responder 409 (D19).
    A decisão continua sendo do backend: o campo informa, não autoriza.
    """

    url = serializers.SerializerMethodField()
    is_downloadable = serializers.BooleanField(read_only=True)

    class Meta:
        model = TicketAttachment
        fields = [
            "id", "filename", "content_type", "size_bytes", "url",
            "scan_status", "is_downloadable",
        ]

    def get_url(self, obj) -> str:
        return f"/api/v1/attachments/{obj.pk}/"


class MentionSerializer(serializers.Serializer):
    """Uma menção já resolvida: a referência gravada mais o nome de HOJE.

    `key` é exatamente o miolo da marcação que está no corpo (`user:12`), para
    o front casar chip e texto sem reimplementar a regra da marcação.
    """

    key = serializers.CharField()
    type = serializers.ChoiceField(choices=["user", "team"])
    id = serializers.IntegerField()
    name = serializers.CharField()
    # desativado depois da menção continua legível, em cinza — nunca some
    is_active = serializers.BooleanField()


class TicketMessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_avatar = serializers.SerializerMethodField()
    author_is_internal = serializers.SerializerMethodField()
    attachments = TicketAttachmentSerializer(many=True, read_only=True)
    mentions = serializers.SerializerMethodField()
    is_deleted = serializers.BooleanField(read_only=True)
    can_edit = serializers.SerializerMethodField()
    signature_html = serializers.SerializerMethodField()

    class Meta:
        model = TicketMessage
        fields = [
            "id", "author_name", "author_avatar", "author_is_internal", "body",
            "is_public", "source", "is_first_response", "created_at", "attachments",
            "mentions",
            # a tela precisa saber que o texto mudou depois de enviado: uma
            # correção silenciosa numa conversa que o cliente já leu não é
            # correção, é reescrita
            "edited_at", "is_deleted", "can_edit",
            # rodapé desta mensagem, renderizado do perfil do autor
            "signature_html",
        ]

    def get_signature_html(self, obj) -> str:
        """A assinatura do autor, ou vazio.

        Vem montada do servidor porque é ela que carrega HTML: a tela só
        precisa desenhar, e o que ela desenha já passou pelo higienizador
        (`apps/accounts/assinatura.py`). Nota interna não leva assinatura —
        ninguém assina um bilhete para a própria equipe.
        """
        if not obj.with_signature or not obj.is_public or obj.author_id is None:
            return ""
        if obj.deleted_at is not None:
            return ""
        return assinatura.render_html(obj.author)

    @extend_schema_field(MentionSerializer(many=True))
    def get_mentions(self, obj) -> list:
        """O corpo guarda `@[user:12]`; aqui vem o nome para desenhar o chip.

        Mensagem pública nunca devolve menção — mesmo que alguém tenha digitado
        a marcação à mão, ela fica sem par e o front a renderiza como texto
        literal. A defesa é redundante de propósito: o serviço já não grava
        menção em mensagem pública, e esta linha garante que uma gravação
        antiga ou um caminho novo não abram a porta.
        """
        if obj.is_public:
            return []
        return mentions_service.mencoes_de(obj)

    def get_can_edit(self, obj) -> bool:
        """Quem vê o botão é quem o backend deixaria usar — a MESMA regra de
        `_pode_mexer_na_mensagem`, para a tela não oferecer o que a API nega."""
        user = getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return False
        return (
            obj.author_id is not None
            and obj.author_id == user.pk
            and obj.deleted_at is None
        )

    def get_author_name(self, obj) -> str:
        return obj.author.full_name if obj.author else "Sistema"

    def get_author_avatar(self, obj) -> str | None:
        """A foto de quem escreveu. Mensagem do sistema não tem — e a UI cai
        nas iniciais, que é o que ela já fazia antes de existir avatar."""
        return (obj.author.avatar_url or None) if obj.author else None

    def get_author_is_internal(self, obj) -> bool:
        return bool(obj.author and obj.author.is_internal)


class _MaskingMixin:
    """Campos sensíveis condicionados a is_content_visible_to(user)."""

    def _visible(self, obj) -> bool:
        return obj.is_content_visible_to(self.context["request"].user)

    def get_subject(self, obj) -> str:
        if self._visible(obj) or not obj.team.mask_subject_for_others:
            return obj.subject
        return f"Ticket de {obj.team.name} — acesso restrito"  # D6

    def get_requester_display(self, obj) -> str:
        return obj.requester.full_name if self._visible(obj) else MASKED_REQUESTER

    def get_is_restricted(self, obj) -> bool:
        return obj.is_restricted()  # cadeado na UI

    def get_content_hidden(self, obj) -> bool:
        return not self._visible(obj)  # ícone "i" com tooltip

    def get_restriction_reason(self, obj) -> str:
        if self._visible(obj):
            return ""
        return (
            f"Tickets de {obj.team.name} são visíveis apenas para quem os abriu."
        )


class TicketListSerializer(_MaskingMixin, serializers.ModelSerializer):
    subject = serializers.SerializerMethodField()
    tags = TicketTagPillSerializer(many=True, read_only=True)
    requester_display = serializers.SerializerMethodField()
    is_restricted = serializers.SerializerMethodField()
    content_hidden = serializers.SerializerMethodField()
    restriction_reason = serializers.SerializerMethodField()
    team = TeamSerializer(read_only=True)
    assignee_name = serializers.SerializerMethodField()
    assignee_avatar = serializers.SerializerMethodField()
    assignee_id = serializers.IntegerField(read_only=True, allow_null=True)
    # "Dono técnico" — quem responde pela ENTREGA da solução, separado de
    # quem está respondendo o cliente agora (`assignee`). docs/05 §3.2: os
    # dois nomes já existiam no model, sem NENHUMA exposição de API — nem
    # leitura, nem escrita (achado fechando o checklist da Fase 3).
    owner_name = serializers.SerializerMethodField()
    owner_id = serializers.IntegerField(read_only=True, allow_null=True)
    company_name = serializers.CharField(source="company.name", read_only=True)
    plan = serializers.SerializerMethodField()
    sla = serializers.SerializerMethodField()
    category_name = serializers.CharField(
        source="category.name", read_only=True, default=None
    )
    # Derivado da categoria, nunca gravado no ticket (GAPS.md #4) — evita a
    # dessincronia que uma cópia própria de `service` no ticket introduziria
    # se a categoria trocasse de serviço depois.
    service_name = serializers.CharField(
        source="category.service.name", read_only=True, default=None
    )
    # O status que a pessoa LÊ. `status` continua saindo porque é a categoria
    # que o maquinário (SLA, relatório, fechamento) usa; `stage_name` é o que
    # a tela mostra — e são a mesma coisa enquanto ninguém criar status
    # próprio, o que faz esta troca não mudar nada para quem já usava.
    stage_name = serializers.CharField(
        source="stage.name", read_only=True, default=None
    )
    stage_color = serializers.CharField(
        source="stage.color", read_only=True, default=None
    )
    current_status_note = serializers.SerializerMethodField()
    satisfaction = serializers.SerializerMethodField()

    class Meta:
        model = Ticket
        fields = [
            "id", "reference", "subject", "order_number", "status", "stage",
            "stage_name", "stage_color", "priority", "source",
            "team", "requester_display", "assignee_name", "assignee_avatar",
            "assignee_id", "owner_name", "owner_id",
            "company_name", "plan", "sla", "category", "category_name", "service_name",
            "is_restricted", "content_hidden", "restriction_reason",
            "reopen_count", "last_reopened_at", "first_response_at",
            "auto_closed", "current_status_note",
            "tags", "satisfaction", "closed_at",
            "created_at", "updated_at",
        ]

    @extend_schema_field({
        "type": "object", "nullable": True,
        "properties": {
            "score": {"type": "integer"},
            "comment": {"type": "string"},
            "responded_at": {"type": "string", "format": "date-time"},
        },
    })
    def get_satisfaction(self, obj):
        """A nota do CSAT no PRÓPRIO chamado — quem atendeu nunca via a
        avaliação que recebeu (ela só aparecia agregada nos indicadores).
        Nulo enquanto não respondida.

        Sai também na LISTA: a tela de Avaliações do portal mostra a nota de
        cada chamado avaliado, e abrir um detalhe por linha para ler um
        inteiro seria uma requisição por item. O `select_related("survey")`
        da view é o que impede isso de virar N+1."""
        # chamado restrito não devolve nem a nota nem o comentário: o
        # comentário é texto de gente e segue o mesmo corte do conteúdo.
        if not self._visible(obj):
            return None
        survey = getattr(obj, "survey", None)
        if survey is None or survey.score is None:
            return None
        return {
            "score": survey.score,
            "comment": survey.comment,
            "responded_at": survey.responded_at,
        }

    def get_current_status_note(self, obj) -> str | None:
        """"Justificativa": o texto anotado na última mudança de status —
        mesma coluna que a fila do Movidesk chama assim.

        INTERNO, nunca para o cliente — mesma regra de `get_events`: a nota
        de uma troca de status pode citar quem atribuiu o chamado a quem
        ("atribuído a Samuel"), e isso é colaboração interna, não algo que o
        cliente deveria ler.

        Anotado por `Subquery` na listagem (`TicketViewSet.list`), pra não
        custar 1 query por linha — `hasattr` (não `getattr` com default) é o
        que distingue "veio anotado e é None" (não tem nota ainda — não
        precisa consultar de novo) de "não veio anotado" (o detalhe, sem a
        anotação, cai para a consulta direta: a tela já paga o custo de
        carregar o chamado inteiro, uma query a mais não muda o padrão).
        """
        user = self.context["request"].user
        if not user.is_internal:
            return None
        if hasattr(obj, "current_status_note"):
            return obj.current_status_note or None
        ultimo = obj.status_events.exclude(note="").order_by("-created_at").first()
        return ultimo.note if ultimo else None

    def get_assignee_name(self, obj) -> str | None:
        return obj.assignee.full_name if obj.assignee else None

    def get_assignee_avatar(self, obj) -> str | None:
        return (obj.assignee.avatar_url or None) if obj.assignee else None

    def get_owner_name(self, obj) -> str | None:
        return obj.owner.full_name if obj.owner else None

    @extend_schema_field(PlanBadgeSerializer)
    def get_plan(self, obj) -> dict:
        """Selo do plano da empresa cliente — o agente precisa da prioridade
        comercial visível na fila, sem abrir o ticket."""
        return {"slug": obj.company.plan.slug, "name": obj.company.plan.name}

    @extend_schema_field(SLAPairSerializer)
    def get_sla(self, obj) -> dict:
        return {
            "first_response": _sla_clock(
                due_at=obj.sla_first_response_due_at,
                breached=obj.sla_first_response_breached,
                met=obj.first_response_at is not None,
            ),
            "resolution": _sla_clock(
                due_at=obj.sla_resolution_due_at,
                breached=obj.sla_resolution_breached,
                met=obj.status == TicketStatus.CLOSED,
            ),
        }


def _sla_clock(*, due_at, breached: bool, met: bool) -> dict:
    """Resolve o estado de um relógio de SLA.

    Ordem importa: cumprido vence prazo estourado — um ticket respondido depois
    do prazo continua "estourado" no histórico (a flag), mas na fila o que
    interessa é que já não há ação pendente.
    """
    if due_at is None:
        return {"due_at": None, "state": "none", "minutes_left": None}

    minutes_left = int((due_at - timezone.now()).total_seconds() // 60)
    if met:
        state = "met"
    elif breached or minutes_left < 0:
        state = "breached"
    elif minutes_left <= SLA_AT_RISK_MINUTES:
        state = "at_risk"
    else:
        state = "ok"
    return {"due_at": due_at, "state": state, "minutes_left": minutes_left}


class TicketEventSerializer(serializers.ModelSerializer):
    """Uma linha do histórico operacional do chamado."""

    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = TicketStatusEvent
        fields = [
            "id", "from_status", "to_status", "actor_name",
            "is_reopen", "is_automatic", "note", "created_at",
        ]

    def get_actor_name(self, obj) -> str | None:
        return obj.changed_by.full_name if obj.changed_by else None


class ScheduledReplySerializer(serializers.ModelSerializer):
    """Uma resposta agendada, para a lista no detalhe do ticket — só o que a
    tela precisa mostrar/cancelar, não os campos de `add_reply` que só o
    disparo usa (`with_signature`, `close_note`...)."""

    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = ScheduledReply
        fields = [
            "id", "body", "is_public", "new_status", "scheduled_at",
            "status", "sent_at", "error", "author_name", "created_at",
        ]


class TicketScheduleReplySerializer(serializers.Serializer):
    """Corpo de `POST /tickets/{id}/schedule-reply/` — mesmos campos de
    `TicketReplySerializer` (ver ali) mais `scheduled_at`, sem anexo (a v1
    do agendamento não segura upload por horas até o disparo)."""

    body = serializers.CharField()
    is_public = serializers.BooleanField(default=True)
    new_status = serializers.ChoiceField(choices=TicketStatus.choices, required=False, allow_blank=True, default="")
    resolution_started_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    resolution_ended_at = serializers.DateTimeField(required=False, allow_null=True, default=None)
    close_note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    with_signature = serializers.BooleanField(default=False)
    scheduled_at = serializers.DateTimeField()


class WatcherSerializer(serializers.Serializer):
    """Seguidor exposto na tela — nasce por @menção (`TicketWatcher`, ver
    `services/mentions.py`); a Fase 2 achou que não havia como sequer LER isso
    no detalhe do ticket, então este campo é a exposição mínima que faltava
    (GAPS.md, achado durante a integração de Chamado). `follow`/`unfollow`,
    abaixo, cobrem o "+ Seguir"/remover manual que o front de referência
    desenha."""

    id = serializers.IntegerField(source="user.id")
    name = serializers.CharField(source="user.full_name")


class RequesterSerializer(serializers.Serializer):
    """Contato do solicitante para o painel do cliente no detalhe. Os campos
    já existiam (User.email, User.ui_language; o fuso vem da empresa do
    chamado) — só não havia exposição. Aparece SÓ quando o conteúdo é visível
    a quem pede (mesma regra de `requester_display`); mascarado, vem null."""

    name = serializers.CharField()
    email = serializers.EmailField()
    ui_language = serializers.CharField()
    timezone = serializers.CharField(allow_null=True)


class TicketDetailSerializer(TicketListSerializer):
    messages = serializers.SerializerMethodField()
    events = serializers.SerializerMethodField()
    watchers = serializers.SerializerMethodField()
    requester = serializers.SerializerMethodField()
    scheduled_replies = serializers.SerializerMethodField()

    # `satisfaction` e `closed_at` SUBIRAM para a lista (a tela de Avaliações
    # do portal precisa da nota sem abrir cada chamado) — herdados daqui.
    class Meta(TicketListSerializer.Meta):
        fields = TicketListSerializer.Meta.fields + [
            "messages", "events", "resolution_started_at", "resolution_ended_at",
            "sla_cycle", "watchers", "requester", "scheduled_replies",
        ]

    @extend_schema_field(ScheduledReplySerializer(many=True))
    def get_scheduled_replies(self, obj):
        """Só a equipe vê — é ferramenta de trabalho do agente, igual a
        `events`; o cliente não sabe (nem precisa saber) que uma resposta
        está programada antes dela chegar."""
        user = self.context["request"].user
        if not user.is_internal or not self._visible(obj):
            return []
        qs = obj.scheduled_replies.select_related("author").order_by("scheduled_at")
        return ScheduledReplySerializer(qs, many=True).data

    @extend_schema_field(RequesterSerializer(allow_null=True))
    def get_requester(self, obj):
        if not self._visible(obj):
            return None
        u = obj.requester
        return {
            "name": u.full_name,
            "email": u.email,
            "ui_language": u.ui_language,
            # o User não tem fuso próprio; o da empresa do chamado é a melhor
            # âncora para "hora local" do cliente
            "timezone": obj.company.timezone if obj.company_id else None,
        }

    @extend_schema_field(WatcherSerializer(many=True))
    def get_watchers(self, obj):
        if not self._visible(obj):
            return []
        qs = obj.watchers.select_related("user").order_by("user__full_name")
        return WatcherSerializer(qs, many=True).data

    @extend_schema_field(TicketEventSerializer(many=True))
    def get_events(self, obj):
        """Histórico operacional — INTERNO, nunca para o cliente.

        Aqui aparece quem atribuiu para quem, quem mencionou quem, e o que o
        sistema fechou sozinho. É a trilha de como o time trabalhou o chamado,
        e mostrá-la ao cliente entregaria o nome de quem foi acionado por
        dentro e a colaboração que ele não deveria ver — o mesmo motivo pelo
        qual nota interna já não sai daqui.
        """
        user = self.context["request"].user
        if not user.is_internal or not self._visible(obj):
            return []
        qs = obj.status_events.select_related("changed_by").order_by("created_at")
        return TicketEventSerializer(qs, many=True).data

    @extend_schema_field(TicketMessageSerializer(many=True))
    def get_messages(self, obj):
        """Conteúdo só sai para quem pode ler (restrição aplicada no backend)."""
        if not self._visible(obj):
            return []
        qs = obj.messages.select_related("author").prefetch_related(
            "attachments", "mentions__user", "mentions__team"
        ).order_by("created_at")
        user = self.context["request"].user
        if not user.is_internal:
            qs = qs.filter(is_public=True)  # nota interna nunca vaza para cliente
        # com o contexto: `can_edit` precisa saber QUEM está pedindo
        return TicketMessageSerializer(qs, many=True, context=self.context).data


class TicketCreateSerializer(serializers.Serializer):
    team_id = serializers.PrimaryKeyRelatedField(
        queryset=Team.objects.filter(is_active=True), source="team"
    )
    subject = serializers.CharField(max_length=200)
    # Opcional e sem formato: cada loja numera do seu jeito. Vem do portal
    # quando a pessoa souber; ninguém trava a abertura por causa dele.
    order_number = serializers.CharField(
        max_length=40, required=False, allow_blank=True,
    )
    body = serializers.CharField()
    priority = serializers.ChoiceField(
        choices=TicketPriority.choices, default=TicketPriority.NORMAL
    )
    # opcional: quem abre pode não saber classificar, e chute vira métrica ruim
    category_id = serializers.PrimaryKeyRelatedField(
        queryset=TicketCategory.objects.filter(is_active=True),
        source="category", required=False, allow_null=True,
    )
    # interno abrindo em nome de um cliente (source=INTERNAL, isento de cota — F-C)
    requester_id = serializers.IntegerField(required=False)
    # "incluir minha assinatura" (só faz efeito para quem é interno; ver
    # `TicketReplySerializer` para o porquê do default False)
    with_signature = serializers.BooleanField(default=False)


def _agentes_ativos():
    from apps.accounts.models import User, UserKind

    return User.objects.filter(is_active=True, kind=UserKind.INTERNAL)


class TicketReclassifySerializer(serializers.Serializer):
    """Entrada do PATCH de triagem — só os campos presentes são alterados.
    `category: null` LIMPA a categoria; ausente não mexe (idem assignee)."""

    priority = serializers.ChoiceField(choices=TicketPriority.choices, required=False)
    category = serializers.PrimaryKeyRelatedField(
        queryset=TicketCategory.objects.filter(is_active=True),
        required=False, allow_null=True,
    )
    team = serializers.PrimaryKeyRelatedField(
        queryset=Team.objects.filter(is_active=True), required=False,
    )
    assignee = serializers.PrimaryKeyRelatedField(
        queryset=_agentes_ativos(), required=False, allow_null=True,
    )
    # lista SUBSTITUI o conjunto (vazia = limpar); ausente não mexe
    tags = serializers.PrimaryKeyRelatedField(
        queryset=TicketTag.objects.all(), many=True, required=False,
    )


class TicketReplySerializer(serializers.Serializer):
    body = serializers.CharField()
    is_public = serializers.BooleanField(default=True)
    # "incluir minha assinatura" do compositor. Default False: quem chama a
    # API sem dizer nada (integração, script) não passa a assinar em nome de
    # ninguém sem pedir.
    with_signature = serializers.BooleanField(default=False)
    # obrigatório para resposta pública de agente; proibido para cliente
    new_status = serializers.ChoiceField(
        choices=TicketStatus.choices, required=False, allow_null=True
    )
    resolution_started_at = serializers.DateTimeField(required=False, allow_null=True)
    resolution_ended_at = serializers.DateTimeField(required=False, allow_null=True)
    # justificativa do fechamento, quando `new_status=closed` — mesmo campo que
    # o endpoint `close/` recebe como `note`. Sem ele, responder-e-fechar numa
    # chamada só perdia a justificativa que a tela pediu.
    close_note = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )


class MentionTargetSerializer(serializers.Serializer):
    """Um item do autocomplete de menção — pessoa ou equipe.

    `group` é a ordem que o backend decidiu (quem está no ticket, quem atende a
    equipe, o resto, e as equipes num grupo próprio no fim). O front respeita a
    ordem que chega e apenas filtra o que a pessoa digitou; a política de quem
    vem antes é do serviço, não da tela.
    """

    type = serializers.ChoiceField(choices=["user", "team"])
    id = serializers.IntegerField()
    name = serializers.CharField()
    # vazio para equipe; o filtro do autocomplete busca por nome E e-mail
    email = serializers.CharField(allow_blank=True)
    avatar_url = serializers.CharField(allow_blank=True)
    group = serializers.ChoiceField(choices=["ticket", "equipe", "outros", "equipes"])


class AssignableAgentSerializer(serializers.Serializer):
    """Um item do seletor de Responsável/Dono técnico.

    Mesmos 4 campos de `MentionTargetSerializer` (id/name/email/avatar_url) —
    de propósito, para o front consumir as duas listas com o mesmo tipo
    TypeScript. Sem `type` nem `group`: esta lista é só de gente (nunca
    equipe), então não há o que discriminar nem agrupar
    (apps/tickets/services/atribuicao.py::agentes_atribuiveis).
    """

    id = serializers.IntegerField()
    name = serializers.CharField()
    email = serializers.CharField(allow_blank=True)
    avatar_url = serializers.CharField(allow_blank=True)


class TicketMessageEditSerializer(serializers.Serializer):
    body = serializers.CharField()


class TicketCloseSerializer(serializers.Serializer):
    resolution_started_at = serializers.DateTimeField()
    resolution_ended_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class TicketCloseByRequesterSerializer(serializers.Serializer):
    """Sem `resolution_started_at`/`resolution_ended_at` (D4) — esse registro
    é do trabalho técnico de quem atende; o cliente só diz "pode fechar"."""

    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")


class TicketPendingRatingSerializer(serializers.Serializer):
    """O que o modal do painel precisa pra perguntar a nota — sem
    reference/subject de OUTRO ticket, e sem token (aqui a sessão já é
    a credencial)."""

    ticket_id = serializers.IntegerField()
    reference = serializers.CharField(source="ticket.reference")
    subject = serializers.CharField(source="ticket.subject")


class TicketRatingAnswerSerializer(serializers.Serializer):
    score = serializers.IntegerField(min_value=0, max_value=10)
    comment = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class TabsSerializer(serializers.Serializer):
    """PUT do estado de abas: lista ordenada de ids + aba ativa."""

    ticket_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)
    active_ticket_id = serializers.IntegerField(required=False, allow_null=True)


class _BulkTicketIdsSerializer(serializers.Serializer):
    """Base das 3 ações em lote (Fase 3 do prompt de integração, GAPS.md):
    a lista de ids em comum. `max_length` é limite técnico (corpo do
    request limitado), não regra de negócio — a view ainda filtra pelos
    tickets VISÍVEIS antes de aplicar qualquer coisa, do mesmo jeito que
    `tabs` já faz (`get_queryset().filter(pk__in=ids)`)."""

    ticket_ids = serializers.ListField(
        child=serializers.IntegerField(), allow_empty=False, max_length=500,
    )


class BulkAssignSerializer(_BulkTicketIdsSerializer):
    assignee_id = serializers.IntegerField(required=False, allow_null=True)


class BulkPrioritySerializer(_BulkTicketIdsSerializer):
    priority = serializers.ChoiceField(choices=TicketPriority.choices)


class BulkCloseSerializer(_BulkTicketIdsSerializer):
    resolution_started_at = serializers.DateTimeField()
    resolution_ended_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
