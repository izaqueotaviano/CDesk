"""Serializers do chat v2.

A censura de palavrões acontece AQUI (exibição), para os dois lados — o
banco guarda o texto original, a lista de moderação vale retroativamente.
"""

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from apps.chat.models import (
    BannedWord,
    Chat,
    ChatCloseReason,
    ChatConfig,
    ChatFile,
    ChatMessage,
    ChatRating,
    ClientQuickReply,
)
from apps.chat.services import chat_service


class ChatFileSerializer(serializers.ModelSerializer):
    """Mesmo formato do anexo de ticket (`url`, `is_downloadable`) de
    propósito: o componente `<Attachment/>` do front já desenha isso."""

    url = serializers.SerializerMethodField()
    is_downloadable = serializers.BooleanField(read_only=True)

    class Meta:
        model = ChatFile
        fields = ["id", "filename", "content_type", "size_bytes", "scan_status",
                  "url", "is_downloadable"]

    def get_url(self, obj) -> str:
        return f"/api/v1/chat/files/{obj.pk}/"


class ChatMessageSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    author_is_internal = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    files = ChatFileSerializer(many=True, read_only=True)
    is_deleted = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    reply_preview = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = ["id", "author_name", "author_is_internal", "body",
                  "is_system", "is_internal_note",
                  "sent_at", "read_at", "delivered_at", "files",
                  # espelha TicketMessageSerializer: a tela precisa saber que
                  # o texto mudou depois de enviado, e só oferece editar/
                  # apagar onde o backend deixaria de verdade
                  "edited_at", "is_deleted", "can_edit",
                  "reply_to", "reply_preview"]

    def get_author_name(self, obj) -> str:
        return obj.author.full_name if obj.author else "Sistema"

    def get_author_is_internal(self, obj) -> bool:
        return bool(obj.author and obj.author.is_internal)

    def get_body(self, obj) -> str:
        # inclusive o agente vê a versão censurada — os dois lados iguais
        return chat_service.censor(obj.body)

    def get_is_deleted(self, obj) -> bool:
        return obj.deleted_at is not None

    @extend_schema_field(
        {
            "type": "object",
            "nullable": True,
            "properties": {
                "id": {"type": "integer"},
                "author_name": {"type": "string"},
                "excerpt": {"type": "string"},
                "is_deleted": {"type": "boolean"},
                "has_files": {"type": "boolean"},
            },
        }
    )
    def get_reply_preview(self, obj):
        """O trecho citado, montado no SERVIDOR.

        Não é o front que recorta: a mensagem citada pode ter saído da janela
        que ele carregou (uma resposta a algo de três dias atrás), e mandá-lo
        buscar cada original de volta seria uma requisição por citação. Vem
        junto, já censurado e já aparado.
        """
        alvo = obj.reply_to
        if alvo is None:
            return None
        apagada = alvo.deleted_at is not None
        corpo = "" if apagada else chat_service.censor(alvo.body)
        return {
            "id": alvo.pk,
            "author_name": alvo.author.full_name if alvo.author else "Sistema",
            "excerpt": corpo[:160],
            "is_deleted": apagada,
            "has_files": alvo.files.exists(),
        }

    def get_can_edit(self, obj) -> bool:
        """Mesma regra de `chat_service._pode_mexer_na_mensagem` — quem vê o
        botão é quem a API deixaria usar, não uma segunda verdade no front.

        `context["user"]` é o atalho para quem serializa fora de uma view
        REST — o ChatConsumer (WebSocket) tem `self.user`, não um `request`
        do DRF; inventar um `request` falso ali seria mais frágil do que
        aceitar as duas formas aqui, uma vez, no único lugar que decide.
        """
        user = self.context.get("user") or getattr(self.context.get("request"), "user", None)
        if user is None or not user.is_authenticated:
            return False
        return (
            obj.author_id is not None
            and obj.author_id == user.pk
            and obj.deleted_at is None
        )


class ChatMessageEditSerializer(serializers.Serializer):
    body = serializers.CharField()


class ChatRatingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatRating
        fields = ["service_score", "resolution_score", "justification", "created_at"]


class ChatTimelineMessageSerializer(ChatMessageSerializer):
    """A mensagem na conversa contínua — a de sempre, mais o `chat_id`.

    É o `chat_id` que deixa a tela saber onde um atendimento termina e outro
    começa: sem ele a conversa costurada viraria um bloco só, e o cliente
    perderia a única pista de que houve mais de um atendimento.
    """

    class Meta(ChatMessageSerializer.Meta):
        fields = [*ChatMessageSerializer.Meta.fields, "chat_id"]


class ChatTimelineSessionSerializer(serializers.ModelSerializer):
    """O resumo de um atendimento, para o marcador entre um e outro.

    Vem numa lista à parte, não repetido em cada mensagem: numa conversa de
    meses o mesmo par (agente, nota) se repetiria centenas de vezes.
    """

    agent_name = serializers.CharField(source="agent.full_name", default=None)
    rating = ChatRatingSerializer(read_only=True)

    class Meta:
        model = Chat
        # queued_at entra aqui pelo mesmo motivo do resto: o marcador entre
        # atendimentos precisa dizer QUANDO um começou e terminou, não só
        # quem atendeu — "Meus chats" (LinhaChat, portal) já mostra isso,
        # e aqui é o mesmo dado, só que por sessão dentro da conversa.
        fields = ["id", "status", "queued_at", "closed_at", "agent_name", "rating"]


class ChatTimelineFileSerializer(ChatFileSerializer):
    """O anexo no painel: o mesmo formato de sempre — o `<Attachment/>` do
    front já o desenha — mais onde e quando ele foi mandado."""

    chat_id = serializers.IntegerField(source="message.chat_id", read_only=True)
    message_id = serializers.IntegerField(source="message.id", read_only=True)
    sent_at = serializers.DateTimeField(source="message.sent_at", read_only=True)

    class Meta(ChatFileSerializer.Meta):
        fields = [*ChatFileSerializer.Meta.fields, "chat_id", "message_id", "sent_at"]


class ChatLinkSerializer(serializers.Serializer):
    """Link achado no corpo de uma mensagem (extração no servidor —
    `chat_service.extrair_links`)."""

    url = serializers.URLField()
    chat_id = serializers.IntegerField()
    message_id = serializers.IntegerField()
    sent_at = serializers.DateTimeField()
    author_name = serializers.CharField()


class ChatTimelineSerializer(serializers.Serializer):
    """O envelope da conversa contínua.

    Existe para o contrato publicado DESCREVER esta resposta. Sem ele o
    gerador dá de ombros ("unable to guess serializer") e o front passa a
    consumir uma rota que o OpenAPI não conhece — o tipo de buraco que só
    aparece quando alguém muda o formato e nada acusa.
    """

    messages = ChatTimelineMessageSerializer(many=True)
    sessions = ChatTimelineSessionSerializer(many=True)
    #: há mensagens ANTES da primeira devolvida — o "carregar anteriores".
    #: É um booleano, e não um total, porque contar uma conversa de meses
    #: para desenhar um botão seria caro à toa.
    has_more = serializers.BooleanField()


class ChatTimelineMediaSerializer(serializers.Serializer):
    files = ChatTimelineFileSerializer(many=True)
    links = ChatLinkSerializer(many=True)


#: O que o AGENTE edita na ficha do atendimento; o resto do payload é derivado.
#: Vive fora da classe porque uma comprehension no corpo dela não enxerga os
#: nomes da própria classe.
_EDITAVEIS_DO_CHAT = ("name", "category", "priority", "assignee")


class ChatCloseReasonSerializer(serializers.ModelSerializer):
    """O cadastro de motivos. `slug` é gerado do nome quando não vem — quem
    cadastra escreve "Sem resposta", não "sem-resposta"."""

    slug = serializers.SlugField(required=False, allow_blank=True)

    class Meta:
        model = ChatCloseReason
        fields = ["id", "name", "slug", "requires_note", "is_active", "order"]

    def validate(self, attrs):
        from django.utils.text import slugify

        if not attrs.get("slug"):
            nome = attrs.get("name") or getattr(self.instance, "name", "")
            attrs["slug"] = slugify(nome)[:50]
        return attrs


class ChatSerializer(serializers.ModelSerializer):
    client_id = serializers.IntegerField(read_only=True)
    client_name = serializers.CharField(source="client.full_name", read_only=True)
    client_email = serializers.CharField(source="client.email", read_only=True)
    client_phone = serializers.CharField(source="client.phone", read_only=True)
    client_avatar = serializers.SerializerMethodField()
    company_name = serializers.CharField(source="company.name", read_only=True)
    agent_name = serializers.SerializerMethodField()
    agent_id = serializers.IntegerField(read_only=True, allow_null=True)
    agent_avatar = serializers.SerializerMethodField()
    category_name = serializers.CharField(
        source="category.name", read_only=True, default=None
    )
    assignee_name = serializers.SerializerMethodField()
    tag_ids = serializers.SerializerMethodField()
    unread_count = serializers.SerializerMethodField()
    last_message_preview = serializers.SerializerMethodField()
    rating = ChatRatingSerializer(read_only=True)
    rating_pending = serializers.BooleanField(read_only=True)
    ticket_id = serializers.SerializerMethodField()
    ticket_reference = serializers.SerializerMethodField()
    #: Disponibilidade do CLIENTE — "ele ainda está na tela?" é a pergunta
    #: que decide se vale esperar a resposta ou encerrar. Some para o próprio
    #: cliente no `to_representation` (ele não precisa saber de si mesmo).
    client_presence = serializers.CharField(source="client.presence", read_only=True)
    # nota interna do agente — NUNCA sai para o cliente (ver to_representation)
    agent_score = serializers.IntegerField(read_only=True, allow_null=True)
    # motivo/observação/quem encerrou — a observação é INTERNA (some no
    # to_representation para o cliente, junto com a nota do agente)
    close_reason_name = serializers.CharField(
        source="close_reason.name", read_only=True, default=None
    )
    closed_by_name = serializers.SerializerMethodField()
    ws_url = serializers.SerializerMethodField()

    class Meta:
        model = Chat
        fields = [
            "id", "status", "name",
            "client_id", "client_name", "client_email", "client_phone", "client_avatar",
            "company_name",
            "agent_name", "agent_id", "agent_avatar",
            "category", "category_name", "priority", "assignee", "assignee_name",
            "tag_ids",
            "queued_at", "accepted_at", "closed_at", "reopen_count",
            "close_reason", "close_reason_name", "close_note",
            "closed_automatically", "closed_by_name",
            "agent_score", "timeout_converted",
            "unread_count", "last_message_preview", "client_presence",
            "rating", "rating_pending", "ticket_id", "ticket_reference",
            "ws_url",
        ]
        read_only_fields = [f for f in fields if f not in _EDITAVEIS_DO_CHAT]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        user = self.context["request"].user
        if not user.is_internal:
            # o que é interno morre aqui: nota do agente sobre o cliente e o
            # nome interno do chat (o cliente só o vê se virar ticket/assunto)
            data.pop("agent_score", None)
            # observação de encerramento é anotação de operação, não recado:
            # o cliente vê QUE encerrou, não o que a equipe escreveu sobre
            data.pop("close_note", None)
            # a presença é para quem ATENDE decidir se espera; devolvê-la ao
            # próprio cliente seria contar a ele o que já sabe de si
            data.pop("client_presence", None)
            data["name"] = ""
        return data

    def get_closed_by_name(self, obj) -> str | None:
        return obj.closed_by.full_name if obj.closed_by else None

    def get_client_avatar(self, obj) -> str | None:
        return obj.client.avatar_url or None

    def get_agent_name(self, obj) -> str | None:
        return obj.agent.full_name if obj.agent else None

    def get_agent_avatar(self, obj) -> str | None:
        return (obj.agent.avatar_url or None) if obj.agent else None

    def get_assignee_name(self, obj) -> str | None:
        return obj.assignee.full_name if obj.assignee else None

    def get_tag_ids(self, obj) -> list[int]:
        return [t.pk for t in obj.tags.all()]

    def get_unread_count(self, obj) -> int:
        user = self.context["request"].user
        return chat_service.mensagens_visiveis(
            obj.messages.filter(read_at__isnull=True, is_system=False), user
        ).exclude(author=user).count()

    def get_last_message_preview(self, obj) -> str | None:
        # a prévia é o lugar mais fácil de esquecer: ela aparece na LISTA, não
        # na conversa, e uma nota interna vazando ali chegaria ao cliente sem
        # ninguém abrir nada
        user = self.context["request"].user
        last = chat_service.mensagens_visiveis(
            obj.messages.filter(is_system=False), user
        ).order_by("-id").first()
        if last is None:
            return None
        if last.body:
            return chat_service.censor(last.body)[:90]
        primeiro = last.files.first()
        return f"📎 {primeiro.filename}" if primeiro else None

    def get_ticket_id(self, obj) -> int | None:
        ticket = getattr(obj, "generated_ticket", None)
        return ticket.pk if ticket else None

    def get_ticket_reference(self, obj) -> str | None:
        ticket = getattr(obj, "generated_ticket", None)
        return ticket.reference if ticket else None

    def get_ws_url(self, obj) -> str:
        return f"/ws/chat/{obj.pk}/"


class RateSerializer(serializers.Serializer):
    """Entrada da avaliação — a validação de escala/justificativa mora no
    serviço (usa os números CORRENTES do config, que são editáveis)."""

    service_score = serializers.IntegerField()
    resolution_score = serializers.IntegerField()
    justification = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=1000
    )


class CloseSerializer(serializers.Serializer):
    """Entrada do encerramento. Motivo e observação são opcionais AQUI e a
    obrigatoriedade real (motivo que exige nota) mora no serviço — é lá que
    o `requires_note` do cadastro é lido, com o valor corrente."""

    agent_score = serializers.IntegerField(required=False, allow_null=True, default=None)
    reason_id = serializers.IntegerField(required=False, allow_null=True, default=None)
    note = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )
    #: A avaliação do CLIENTE, quando ele é quem encerra: encerrar e avaliar
    #: viram uma operação só (ver `close_chat`). Os três campos andam juntos —
    #: mandar nota sem a outra nota é erro de quem chama, não meio caminho.
    service_score = serializers.IntegerField(required=False, allow_null=True, default=None)
    resolution_score = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )
    justification = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=1000
    )

    def validate(self, attrs):
        atendimento = attrs.get("service_score")
        resolucao = attrs.get("resolution_score")
        if (atendimento is None) != (resolucao is None):
            raise serializers.ValidationError(
                "Avaliação incompleta: as duas notas (atendimento e resolução) "
                "vêm juntas ou nenhuma vem."
            )
        return attrs


class TransferSerializer(serializers.Serializer):
    agent_id = serializers.IntegerField()
    #: observação INTERNA de quem transfere ("cliente quer falar de fatura").
    #: Vai para a auditoria, nunca para a conversa.
    note = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )


class ReopenSerializer(serializers.Serializer):
    #: por que está reabrindo — interno, entra na trilha de auditoria
    note = serializers.CharField(
        required=False, allow_blank=True, default="", max_length=2000
    )


class ConvertSerializer(serializers.Serializer):
    team_id = serializers.IntegerField()


class ChatReportRowSerializer(serializers.Serializer):
    """Uma linha do relatório do chat, em qualquer eixo.

    Existe para o SCHEMA, e o schema existe para a SPA: sem serializer
    declarado o gerador desistia da view ("unable to guess serializer") e o
    endpoint sumia do `resolv-openapi.yaml` — a tela de relatórios ficava
    com um tipo escrito à mão que nada garantia bater com a resposta.

    Os campos variam por eixo (`?by=`): o eixo `score` conta ocorrências por
    nota e não tem desfechos; os outros três trazem a contagem completa, e só
    `agent` tem a autoavaliação. Por isso quase tudo é opcional aqui — a forma
    é honesta sobre ser condicional, em vez de prometer campos que não vêm.
    """

    rotulo = serializers.CharField(allow_null=True)
    total = serializers.IntegerField(required=False)
    fechados = serializers.IntegerField(required=False)
    convertidos = serializers.IntegerField(required=False)
    nao_atendidos = serializers.IntegerField(required=False)
    nota_atendimento = serializers.FloatField(required=False, allow_null=True)
    nota_resolucao = serializers.FloatField(allow_null=True)
    # só no eixo `agent`: a nota que o próprio agente deu ao encerrar
    nota_do_agente = serializers.FloatField(required=False, allow_null=True)
    # minutos (não timedelta — JSON não sabe serializar isso). Nulo quando
    # a média não tem nenhum chat atendido/fechado pra calcular em cima.
    espera_media_minutos = serializers.FloatField(required=False, allow_null=True)
    atendimento_medio_minutos = serializers.FloatField(required=False, allow_null=True)
    # só no eixo `score`: quantas conversas receberam aquela nota
    quantidade = serializers.IntegerField(required=False)


class ClientChatConfigSerializer(serializers.ModelSerializer):
    """A fatia da config que o PORTAL usa.

    O modal de avaliação do cliente desenha a régua com `score_min/max` e abre
    a justificativa obrigatória pelo `low_score_threshold`; a mensagem de boas-
    vindas abre a conversa. O resto da config é operação interna (equipe
    padrão, timeout, teto por agente) e não sai para cliente.

    O estado da fila SAI para o cliente, e não é operação interna: é o que a
    tela dele precisa para dizer se dá para começar uma conversa agora. Sem
    isso o portal ficava sem resposta e assumia "aberto", convidava a pessoa a
    escrever e só recusava no envio — a promessa que a tela não podia cumprir.
    Não há nada de sensível aqui: `queue_open` é o mesmo sim/não que o botão
    de enviar já revela, e `queue_opens_at` é o horário comercial publicado.
    """

    queue_open = serializers.SerializerMethodField()
    queue_opens_at = serializers.SerializerMethodField()

    class Meta:
        model = ChatConfig
        fields = [
            "welcome_message", "score_min", "score_max", "low_score_threshold",
            "queue_open", "queue_opens_at",
        ]
        read_only_fields = fields

    # Mesma fonte do serializer interno (`chat_service.estado_da_fila`), de
    # propósito: duas contas para a mesma pergunta acabariam discordando.
    def _fila(self):
        if not hasattr(self, "_fila_cache"):
            self._fila_cache = chat_service.estado_da_fila()
        return self._fila_cache

    @extend_schema_field(serializers.BooleanField())
    def get_queue_open(self, _obj) -> bool:
        return self._fila()[0]

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_queue_opens_at(self, _obj):
        abre = self._fila()[1]
        return abre.isoformat() if abre else None


class ChatConfigSerializer(serializers.ModelSerializer):
    default_team_name = serializers.CharField(
        source="default_team.name", read_only=True, default=None
    )
    # Estado da fila AGORA, calculado no servidor. É o que a tela do agente usa
    # pra dizer "fila fechada até amanhã, 8h" em vez de mostrar uma fila vazia
    # sem explicar por quê. Refazer a conta no navegador (fuso do calendário,
    # feriado de meio período) criaria uma segunda verdade pra discordar desta.
    queue_open = serializers.SerializerMethodField()
    queue_opens_at = serializers.SerializerMethodField()

    class Meta:
        model = ChatConfig
        fields = [
            "welcome_message", "queue_timeout_minutes", "max_chats_per_agent",
            "score_min", "score_max", "low_score_threshold",
            "default_team", "default_team_name",
            "queue_open", "queue_opens_at",
            "inactivity_warning_minutes", "inactivity_close_minutes",
        ]

    def _fila(self):
        if not hasattr(self, "_fila_cache"):
            self._fila_cache = chat_service.estado_da_fila()
        return self._fila_cache

    @extend_schema_field(serializers.BooleanField())
    def get_queue_open(self, _obj) -> bool:
        return self._fila()[0]

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_queue_opens_at(self, _obj):
        abre = self._fila()[1]
        return abre.isoformat() if abre else None

    def validate(self, data):
        minimo = data.get("score_min", getattr(self.instance, "score_min", 0))
        maximo = data.get("score_max", getattr(self.instance, "score_max", 10))
        gatilho = data.get(
            "low_score_threshold", getattr(self.instance, "low_score_threshold", 5)
        )
        if minimo >= maximo:
            raise serializers.ValidationError(
                {"score_max": "O máximo da escala precisa ser maior que o mínimo."}
            )
        if not (minimo <= gatilho <= maximo):
            raise serializers.ValidationError(
                {"low_score_threshold": "O gatilho da justificativa precisa caber na escala."}
            )

        # Avisar DEPOIS de encerrar não existe: o chat já fechou quando o
        # relógio do aviso o alcança, e o aviso nunca chegaria a ninguém.
        aviso = data.get(
            "inactivity_warning_minutes",
            getattr(self.instance, "inactivity_warning_minutes", 0),
        )
        fechar = data.get(
            "inactivity_close_minutes",
            getattr(self.instance, "inactivity_close_minutes", 0),
        )
        if aviso and fechar and aviso >= fechar:
            raise serializers.ValidationError(
                {"inactivity_warning_minutes":
                 "O aviso precisa vir antes do encerramento — use um tempo menor."}
            )
        return data


class PalavraNormalizada(serializers.CharField):
    """Minúscula e sem espaço nas pontas ANTES de qualquer validador.

    O `validate_word` do serializer normalizava tarde demais: o DRF roda
    `to_internal_value` e só depois `run_validators` (onde mora o
    `UniqueValidator`), e o `validate_<campo>` vem depois dos dois. Então
    cadastrar "DROGA" com "droga" já na lista passava batido pela checagem
    de duplicada — e ia morrer na constraint do banco, virando 500 com
    IntegrityError. Normalizando aqui, o validador de unicidade compara o
    mesmo texto que o banco vai guardar.
    """

    def to_internal_value(self, data):
        return super().to_internal_value(data).strip().lower()


class ClientQuickReplySerializer(serializers.ModelSerializer):
    """Atalhos de mensagem do cliente. O portal só lê; o admin gerencia."""

    class Meta:
        model = ClientQuickReply
        fields = ["id", "contexto", "rotulo", "texto", "is_active", "order"]


class BannedWordSerializer(serializers.ModelSerializer):
    word = PalavraNormalizada(
        max_length=60,
        validators=[UniqueValidator(
            queryset=BannedWord.objects.all(),
            message="Esta palavra já está na lista.",
        )],
    )

    class Meta:
        model = BannedWord
        fields = ["id", "word"]

    def validate_word(self, valor: str) -> str:
        if not valor:
            raise serializers.ValidationError("Informe a palavra.")
        return valor
