"""API REST do chat v2.

O WebSocket transporta mensagem de texto; o REST é a fonte de recuperação
(reconectar = GET messages/?after=<id> + reabrir o socket) e o caminho do
que não cabe num frame JSON: anexo (inclusive o print colado), ações de
ciclo de vida (pegar, transferir, encerrar, reabrir, avaliar, converter) e
toda a configuração do módulo.

Toda leitura parte de `chat_service.visible_chats(user)` — mesma disciplina
anti-vazamento dos tickets, vigiada pelo teste estrutural.
"""

import datetime as dt

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import status as http
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Team, User
from apps.chat.models import (
    BannedWord,
    ChatCloseReason,
    ChatConfig,
    ChatMessage,
    ChatScanStatus,
    ChatStatus,
    ClientQuickReply,
)
from apps.chat.serializers import (
    BannedWordSerializer,
    ChatCloseReasonSerializer,
    ChatConfigSerializer,
    ChatLinkSerializer,
    ChatMessageEditSerializer,
    ChatMessageSerializer,
    ChatReportRowSerializer,
    ChatSerializer,
    ChatTimelineFileSerializer,
    ChatTimelineMediaSerializer,
    ChatTimelineMessageSerializer,
    ChatTimelineSerializer,
    ChatTimelineSessionSerializer,
    ClientChatConfigSerializer,
    ClientQuickReplySerializer,
    CloseSerializer,
    ConvertSerializer,
    RateSerializer,
    ReopenSerializer,
    TransferSerializer,
)
from apps.chat.services import chat_service
from apps.chat.services.attachments import AttachmentRejected, attach_to_chat_message
from apps.chat.services.chat_service import ChatRuleViolation
from apps.core.permissions import IsAuthenticatedReadAdminWrite, IsInternalReadAdminWrite
from apps.tickets.admin_api import TicketMacroSerializer
from apps.tickets.models import TicketMacro
from apps.tickets.services import transcript


@extend_schema(parameters=[OpenApiParameter(
    # O `id` da URL é inteiro, e quem diz isso é esta linha.
    #
    # O gerador tentaria descobrir sozinho chamando `get_queryset()` com uma
    # requisição falsa — que estoura aqui, porque o queryset depende do usuário
    # logado. Sem resposta ele assume STRING, e a SPA passava a receber
    # `id: string` para uma chave inteira, num tipo que ela mesma gera do
    # schema. Declarar aqui é mais barato do que um `queryset` de classe: este
    # arquivo é camada de request, onde tocar o manager cru de Chat é
    # proibido pelo teste estrutural (é assim que isolamento entre empresas
    # vaza), e um `.none()` inofensivo abriria exceção numa trava que só vale
    # enquanto não tem exceção.
    "id", OpenApiTypes.INT, OpenApiParameter.PATH,
)])
class ChatViewSet(viewsets.GenericViewSet):
    serializer_class = ChatSerializer
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return chat_service.visible_chats(self.request.user)

    def _get_chat(self):
        chat = self.get_object()  # 404 fora do escopo: não vaza existência
        return chat

    # ------------------------------------------------------------------ #
    # Listagem e abertura
    # ------------------------------------------------------------------ #

    #: Como a lista de FINALIZADOS pode ser ordenada. Lista fechada de
    #: propósito: `order_by` com string livre do cliente ordena por qualquer
    #: coluna do modelo — inclusive as que o serializer esconde.
    ORDENACOES = {
        "recentes": ["-closed_at", "-queued_at"],
        "antigos": ["closed_at", "queued_at"],
        # duração e espera não são colunas: saem de diferenças entre
        # carimbos, anotadas na consulta (ver abaixo)
        "duracao": ["-duracao"],
        "duracao_asc": ["duracao"],
        "espera": ["-espera"],
        "nota": ["-rating__service_score", "-closed_at"],
        "nota_asc": ["rating__service_score", "-closed_at"],
    }

    @extend_schema(parameters=[
        OpenApiParameter("status", str, description="queued | active | closed"),
        OpenApiParameter("q", str, description=(
            "busca por cliente, empresa, nome do chat, e-mail, telefone, "
            "protocolo (#id) ou conteúdo das mensagens"
        )),
        OpenApiParameter("mine", str, description="'1' = só os chats do agente logado"),
        OpenApiParameter("client", int, description="id do cliente — as conversas dele"),
        OpenApiParameter("agent", int, description="finalizados: quem atendeu"),
        OpenApiParameter("reason", int, description="finalizados: id do motivo de encerramento"),
        OpenApiParameter("tag", int, description="finalizados: id da etiqueta"),
        OpenApiParameter("category", int, description="finalizados: id do assunto/categoria"),
        OpenApiParameter("rating", str, description=(
            "finalizados: 'sem' (não avaliados), ou nota mínima 0-10"
        )),
        OpenApiParameter("desde", str, description=(
            "finalizados: encerrados a partir de (AAAA-MM-DD)"
        )),
        OpenApiParameter("ate", str, description="finalizados: encerrados até (AAAA-MM-DD)"),
        OpenApiParameter("ordering", str, description=(
            "recentes | antigos | duracao | duracao_asc | espera | nota | nota_asc"
        )),
    ])
    def list(self, request):
        qs = self.get_queryset()
        if st := request.query_params.get("status"):
            qs = qs.filter(status=st)
        if request.query_params.get("mine") == "1" and request.user.is_internal:
            qs = qs.filter(agent=request.user)
        qs = self._filtros_de_finalizados(request, qs)
        qs = self._ordenar(request, qs)
        # "todas as conversas desta pessoa" — o que o agente abre ao lado da
        # conversa atual. Não precisa de guarda extra: para o cliente o
        # queryset já é só o dele, então filtrar por outro id devolve vazio.
        if cliente := request.query_params.get("client"):
            if not str(cliente).isdigit():
                raise ValidationError({"client": "Informe o id do cliente."})
            qs = qs.filter(client_id=int(cliente))
        if term := request.query_params.get("q"):
            filtro = (Q(client__full_name__icontains=term)
                      | Q(company__name__icontains=term)
                      | Q(client__email__icontains=term)
                      | Q(client__phone__icontains=term))
            # protocolo: o id do atendimento, com ou sem "#"
            if (protocolo := term.strip().lstrip("#")).isdigit():
                filtro |= Q(pk=int(protocolo))
            if request.user.is_internal:
                filtro |= Q(name__icontains=term)  # nome interno: só interno busca
                # conteúdo das mensagens (item 2 do brief). Só para interno:
                # o cliente já vê apenas as próprias conversas, e varrer o
                # corpo delas não acrescenta nada a ele. Mensagem apagada
                # fica de fora — o texto sumiu da tela, não pode voltar pela
                # busca.
                filtro |= Q(messages__body__icontains=term,
                            messages__deleted_at__isnull=True)
            qs = qs.filter(filtro).distinct()
        page = self.paginate_queryset(qs)
        ser = self.get_serializer(page, many=True)
        return self.get_paginated_response(ser.data)

    def _filtros_de_finalizados(self, request, qs):
        """Os recortes da aba Finalizados (item 2 do brief).

        Todos opcionais e combináveis; nenhum deles alarga o que a pessoa
        pode ver — `visible_chats` já recortou isso antes, e filtrar sobre um
        queryset já restrito não tem como devolver o chat de outra empresa.
        """
        p = request.query_params
        if (agente := p.get("agent")) and agente.isdigit():
            qs = qs.filter(agent_id=int(agente))
        if (motivo := p.get("reason")) and motivo.isdigit():
            qs = qs.filter(close_reason_id=int(motivo))
        if (tag := p.get("tag")) and tag.isdigit():
            qs = qs.filter(tags__id=int(tag))
        if (cat := p.get("category")) and cat.isdigit():
            qs = qs.filter(category_id=int(cat))
        if nota := p.get("rating"):
            if nota == "sem":
                qs = qs.filter(rating__isnull=True)
            elif nota.isdigit():
                qs = qs.filter(rating__service_score__gte=int(nota))
        # Período pelo dia local de quem pergunta, não pelo UTC do servidor:
        # "encerrados hoje" tem de bater com o calendário de quem lê a tela.
        if desde := _data(p.get("desde")):
            qs = qs.filter(closed_at__gte=_inicio_do_dia(desde))
        if ate := _data(p.get("ate")):
            qs = qs.filter(closed_at__lt=_inicio_do_dia(ate + dt.timedelta(days=1)))
        return qs

    def _ordenar(self, request, qs):
        """Ordenação da lista. Fora do dicionário, a ordem é a de sempre
        (fila primeiro pelo mais antigo esperando; o resto, mais recente)."""
        escolha = request.query_params.get("ordering")
        campos = self.ORDENACOES.get(escolha or "")
        if campos is None:
            return qs.order_by("-queued_at")
        if any("duracao" in c for c in campos):
            qs = qs.annotate(duracao=F("closed_at") - F("accepted_at"))
        if any("espera" in c for c in campos):
            qs = qs.annotate(espera=F("accepted_at") - F("queued_at"))
        return qs.order_by(*campos)

    def retrieve(self, request, pk=None):
        return Response(self.get_serializer(self._get_chat()).data)

    def create(self, request):
        """Cliente abre um chat. Avaliação pendente BLOQUEIA — a resposta
        devolve os pendentes para o front forçar a nota primeiro."""
        try:
            chat, created = chat_service.open_chat(client=request.user)
        except ChatRuleViolation as exc:
            pendentes = []
            if not request.user.is_internal:
                pendentes = ChatSerializer(
                    chat_service.pending_ratings(request.user), many=True,
                    context={"request": request},
                ).data
            return Response(
                {"detail": str(exc), "code": exc.code, "pending_ratings": pendentes},
                status=http.HTTP_400_BAD_REQUEST,
            )
        return Response(
            self.get_serializer(chat).data,
            status=http.HTTP_201_CREATED if created else http.HTTP_200_OK,
        )

    def partial_update(self, request, pk=None):
        """Campos de atendimento (nome interno, categoria, urgência,
        responsável, etiquetas) — só o agente da conversa (ou admin)."""
        chat = self._get_chat()
        if not request.user.is_internal:
            raise PermissionDenied("Campos de atendimento são internos.")
        if chat.agent_id != request.user.pk and not request.user.is_admin:
            raise PermissionDenied("Só quem está atendendo edita o atendimento.")
        antes = {c: getattr(chat, c) for c in ("name", "category_id", "priority", "assignee_id")}
        tags_antes = sorted(t.name for t in chat.tags.all())
        ser = self.get_serializer(chat, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        if "tags" in request.data:
            chat.tags.set(request.data.get("tags") or [])
        # Item 12 do brief: etiqueta tem HISTÓRICO de alteração. Sem isto,
        # "quem tirou a etiqueta de urgente?" não tem resposta — e é a
        # pergunta que aparece justamente quando alguém tirou.
        chat.refresh_from_db()
        tags_depois = sorted(t.name for t in chat.tags.all())
        mudou = {
            campo: [antes[campo], getattr(chat, campo)]
            for campo in antes
            if antes[campo] != getattr(chat, campo)
        }
        if tags_antes != tags_depois:
            mudou["tags"] = [tags_antes, tags_depois]
        if mudou:
            chat_service.auditar(
                chat=chat, actor=request.user, action="update",
                summary=f"Atendimento editado: {', '.join(mudou)}",
                changes=mudou,
            )
        return Response(self.get_serializer(chat).data)

    @action(detail=False, methods=["get"], url_path="pending-ratings")
    def pending_ratings(self, request):
        """Os fechados sem nota do cliente logado — o que trava chat novo."""
        if request.user.is_internal:
            return Response([])
        ser = self.get_serializer(
            chat_service.pending_ratings(request.user), many=True
        )
        return Response(ser.data)

    # ------------------------------------------------------------------ #
    # Conversa
    # ------------------------------------------------------------------ #

    @extend_schema(
        parameters=[
            OpenApiParameter("after", str, description="id da última mensagem já vista"),
            OpenApiParameter("before", str, description="id da mensagem mais antiga já carregada"),
            OpenApiParameter("limit", int, description="quantas mensagens (as mais recentes)"),
        ],
        responses=ChatMessageSerializer(many=True),
    )
    @action(detail=True, methods=["get"])
    def messages(self, request, pk=None):
        """Histórico da conversa — sempre em ordem de id, em três recortes.

        - `after`  → o que chegou depois (reconexão sem perda);
        - `before` → o que veio ANTES (o "carregar mensagens anteriores", em
          conversa longa);
        - `limit`  → o rabo, as N mais recentes.

        Sem parâmetro nenhum devolve a conversa INTEIRA, que continua sendo o
        contrato antigo: o histórico nunca é podado no servidor, só paginado
        a pedido de quem lê.
        """
        chat = self._get_chat()
        base = chat.messages.select_related("author").prefetch_related("files")
        qs = base.order_by("id")
        if after := request.query_params.get("after"):
            if not after.isdigit():
                raise ValidationError({"after": "Informe o id da última mensagem."})
            qs = qs.filter(id__gt=int(after))
        if before := request.query_params.get("before"):
            if not before.isdigit():
                raise ValidationError({"before": "Informe o id da mensagem mais antiga."})
            qs = qs.filter(id__lt=int(before))

        if limite := request.query_params.get("limit"):
            if not str(limite).isdigit() or int(limite) < 1:
                raise ValidationError({"limit": "Informe um número de mensagens maior que zero."})
            # as N MAIS RECENTES do recorte — corta pela cauda e devolve de
            # volta em ordem crescente, que é como a thread desenha
            ids = list(qs.order_by("-id").values_list("id", flat=True)[: int(limite)])
            qs = base.filter(id__in=ids).order_by("id")
        return Response(ChatMessageSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def read(self, request, pk=None):
        chat = self._get_chat()
        updated = chat.messages.filter(read_at__isnull=True, is_system=False)\
            .exclude(author=request.user).update(read_at=timezone.now())
        return Response({"marked_read": updated})

    @action(detail=True, methods=["post"],
            parser_classes=[JSONParser, MultiPartParser, FormParser])
    def files(self, request, pk=None):
        """Anexo (inclusive print colado) vira mensagem nova — por REST,
        com o MESMO group_send do texto: chega em tempo real do outro lado."""
        chat = self._get_chat()
        if not chat_service.can_send(request.user, chat):
            raise ValidationError({"detail": "Este chat não aceita mensagens suas agora."})

        uploads = request.FILES.getlist("files")
        if not uploads:
            raise ValidationError({"files": "Envie ao menos um arquivo."})

        message = ChatMessage.objects.create(
            chat=chat, author=request.user, body=request.data.get("body", "").strip(),
        )
        try:
            attach_to_chat_message(message=message, uploads=uploads, uploaded_by=request.user)
        except AttachmentRejected as exc:
            message.delete()  # sem mensagem fantasma quando o anexo é recusado
            raise ValidationError({"files": str(exc)}) from exc

        payload = ChatMessageSerializer(message, context={"request": request}).data
        chat_service._sala(chat.pk, {"type": "chat.message", **payload})
        return Response(payload, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["patch", "delete"],
            url_path=r"messages/(?P<message_id>\d+)")
    def message(self, request, pk=None, message_id=None):
        """Corrige ou apaga uma mensagem já enviada — mesma forma da rota
        equivalente de ticket. A diferença é o chat ser tempo real: além de
        responder a quem chamou, avisa a SALA pelo WebSocket, porque o outro
        lado pode estar com a conversa aberta neste exato momento."""
        chat = self._get_chat()
        message = chat.messages.filter(pk=message_id).first()
        if message is None:
            raise NotFound("Mensagem não encontrada neste chat.")

        try:
            if request.method == "DELETE":
                chat_service.delete_message(message=message, actor=request.user)
            else:
                ser = ChatMessageEditSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                chat_service.edit_message(
                    message=message, actor=request.user, body=ser.validated_data["body"]
                )
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        message.refresh_from_db()
        payload = ChatMessageSerializer(message, context={"request": request}).data
        evento = "chat.message_deleted" if request.method == "DELETE" else "chat.message_edited"
        chat_service._sala(chat.pk, {"type": evento, **payload})
        return Response(payload)

    # ------------------------------------------------------------------ #
    # Ciclo de vida
    # ------------------------------------------------------------------ #

    @action(detail=True, methods=["post"])
    def take(self, request, pk=None):
        """Pegar chat — o lock atômico mora no serviço, não no botão."""
        chat = self._get_chat()
        try:
            chat = chat_service.take_chat(chat=chat, agent=request.user)
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=["post"])
    def transfer(self, request, pk=None):
        chat = self._get_chat()
        ser = TransferSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        para = User.objects.filter(pk=ser.validated_data["agent_id"], is_active=True).first()
        if para is None:
            raise ValidationError({"agent_id": "Agente não encontrado."})
        try:
            chat = chat_service.transfer(
                chat=chat, actor=request.user, to_agent=para,
                note=ser.validated_data.get("note", ""),
            )
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        chat = self._get_chat()
        ser = CloseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        motivo = None
        if (rid := ser.validated_data.get("reason_id")) is not None:
            # só motivo ATIVO entra num encerramento novo; os desativados
            # seguem legíveis nos atendimentos que já os usaram
            motivo = ChatCloseReason.objects.filter(pk=rid, is_active=True).first()
            if motivo is None:
                raise ValidationError({"reason_id": "Motivo de encerramento não encontrado."})
        # Encerramento do cliente COM avaliação: uma transação só no serviço —
        # o chat só fica encerrado se a nota gravar (item 1 do brief).
        avaliacao = None
        if ser.validated_data.get("service_score") is not None:
            avaliacao = {
                "service_score": ser.validated_data["service_score"],
                "resolution_score": ser.validated_data["resolution_score"],
                "justification": ser.validated_data.get("justification", ""),
            }
        try:
            chat = chat_service.close_chat(
                chat=chat, actor=request.user,
                agent_score=ser.validated_data.get("agent_score"),
                reason=motivo, note=ser.validated_data.get("note", ""),
                rating=avaliacao,
            )
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        chat = self._get_chat()
        ser = ReopenSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            chat = chat_service.reopen(
                chat=chat, actor=request.user, note=ser.validated_data.get("note", ""),
            )
        except ChatRuleViolation as exc:
            # corpo montado à mão para levar o `code` (fora_do_expediente)
            return Response(
                {"detail": str(exc), "code": exc.code},
                status=http.HTTP_400_BAD_REQUEST,
            )
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=["post"])
    def rate(self, request, pk=None):
        chat = self._get_chat()
        ser = RateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            chat_service.rate(chat=chat, client=request.user, **ser.validated_data)
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        chat.refresh_from_db()
        return Response(self.get_serializer(chat).data)

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        """Conversão manual — o agente escolhe a equipe do ticket."""
        from apps.tickets.services import ticket_service

        chat = self._get_chat()
        if not request.user.is_internal:
            raise PermissionDenied("Conversão é ação do agente.")
        if chat.agent_id != request.user.pk and not request.user.is_admin:
            raise PermissionDenied("Só quem está atendendo converte.")
        ser = ConvertSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        team = Team.objects.filter(pk=ser.validated_data["team_id"], is_active=True).first()
        if team is None:
            raise ValidationError({"team_id": "Equipe não encontrada."})
        ticket = ticket_service.create_from_chat(chat=chat, team=team, actor=request.user)
        chat.refresh_from_db()
        return Response(self.get_serializer(chat).data | {
            "ticket_id": ticket.pk, "ticket_reference": ticket.reference,
        })

    @action(detail=True, methods=["post"], url_path="apply-macro")
    def apply_macro(self, request, pk=None):
        chat = self._get_chat()
        if not request.user.is_internal:
            raise PermissionDenied("Macro é recurso interno.")
        macro = TicketMacro.objects.filter(
            pk=request.data.get("macro_id"), is_active=True
        ).first()
        if macro is None:
            raise ValidationError({"macro_id": "Macro não encontrada."})
        try:
            chat = chat_service.apply_macro(chat=chat, macro=macro, actor=request.user)
        except ChatRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(self.get_serializer(chat).data)


# ---------------------------------------------------------------------- #
# Download de anexo — D13/D19
# ---------------------------------------------------------------------- #

class AttachmentScanPending(APIException):
    status_code = http.HTTP_423_LOCKED
    default_code = "attachment_scan_pending"
    default_detail = "Anexo em verificação antivírus. Tente novamente em alguns instantes."


class AttachmentQuarantined(APIException):
    status_code = http.HTTP_403_FORBIDDEN
    default_code = "attachment_quarantined"
    default_detail = "Anexo bloqueado pela verificação antivírus."


@extend_schema(
    responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
    description="Download autenticado de anexo de chat (D13), sujeito à quarentena (D19).",
)
class ChatFileDownloadView(APIView):
    """Permissão e quarentena reavaliadas a CADA download — id em mãos não basta."""

    def get(self, request, pk):
        from apps.chat.models import ChatFile

        chat_file = (
            ChatFile.objects.select_related("message__chat").filter(pk=pk).first()
        )
        if chat_file is None:
            raise NotFound

        chat = chat_file.message.chat
        if not chat_service.visible_chats(request.user).filter(pk=chat.pk).exists():
            raise NotFound  # não vaza existência

        if not chat_file.is_downloadable:
            if chat_file.scan_status == ChatScanStatus.PENDING:
                raise AttachmentScanPending()
            raise AttachmentQuarantined()

        try:
            handle = chat_file.file.open("rb")
        except FileNotFoundError as exc:
            raise Http404("Arquivo indisponível.") from exc

        response = FileResponse(handle, content_type=chat_file.content_type)
        response["Content-Disposition"] = content_disposition_header(
            as_attachment=True, filename=chat_file.filename
        )
        response["X-Content-Type-Options"] = "nosniff"
        return response


# ---------------------------------------------------------------------- #
# Configurações do módulo (admin)
# ---------------------------------------------------------------------- #

#: Quantas mensagens a conversa contínua entrega sem pedir. Cabe numa
#: rolagem confortável e não custa nada; o resto vem por `before`.
TIMELINE_PADRAO = 60
#: Teto por pedido, para um `?limit=100000` não virar um despejo do histórico.
TIMELINE_MAX = 200


def _data(valor: str | None) -> dt.date | None:
    """"AAAA-MM-DD" → date. Texto inválido vira `None` (o filtro some) em vez
    de 400: um parâmetro de recorte digitado errado não deve derrubar a
    listagem inteira."""
    if not valor:
        return None
    try:
        return dt.date.fromisoformat(valor)
    except ValueError:
        return None


def _inicio_do_dia(dia: dt.date) -> dt.datetime:
    """Meia-noite DAQUELE dia no fuso da aplicação — o filtro de período
    precisa bater com o calendário de quem lê, não com o UTC do banco."""
    return timezone.make_aware(dt.datetime.combine(dia, dt.time.min))


def _so_cliente(user):
    """A conversa contínua é do cliente.

    Para um interno "todas as minhas sessões" não quer dizer nada — ele
    atende várias pessoas, e `visible_chats` devolveria a conversa de TODO
    MUNDO numa resposta só. 403 é mais honesto (e mais seguro) do que
    inventar um recorte que ninguém pediu.
    """
    if user.is_internal:
        raise PermissionDenied(
            "A conversa contínua é do cliente. O atendimento vê os chats pela fila."
        )


def _inteiro(params, nome, *, maximo=None):
    bruto = params.get(nome)
    if bruto is None:
        return None
    if not str(bruto).isdigit() or int(bruto) < 1:
        raise ValidationError({nome: "Informe um número maior que zero."})
    valor = int(bruto)
    return min(valor, maximo) if maximo else valor


@extend_schema(
    parameters=[
        OpenApiParameter("before", int, description="id da mensagem mais antiga já carregada"),
        OpenApiParameter("limit", int, description=f"quantas mensagens (máx. {TIMELINE_MAX})"),
        OpenApiParameter("q", str, description="busca no corpo das mensagens"),
    ],
    responses=ChatTimelineSerializer,
)
class ChatTimelineView(APIView):
    """A conversa contínua do cliente: todas as sessões dele numa linha só.

    Existe porque o cliente vê UMA conversa com o atendimento, ainda que a
    operação a divida em atendimentos (cada um com fila, aceite e nota
    próprios). A costura acontece aqui, na leitura — o modelo continua
    separado, e é ele que fila, SLA e relatórios seguem medindo.

    O recorte (`before` + `limit`) é o mesmo do `messages/` de um chat, de
    propósito: não deve existir um segundo jeito de paginar conversa neste
    sistema.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _so_cliente(request.user)
        mensagens, tem_anteriores = chat_service.timeline(
            request.user,
            before=_inteiro(request.query_params, "before"),
            limit=_inteiro(request.query_params, "limit", maximo=TIMELINE_MAX)
            or TIMELINE_PADRAO,
            q=(request.query_params.get("q") or "").strip(),
        )
        # as sessões que aparecem NESTE recorte — não todas as do cliente:
        # quem carregou as 60 últimas mensagens não precisa do resumo de um
        # atendimento de um ano atrás que não está na tela
        sessoes = {m.chat_id: m.chat for m in mensagens}
        return Response({
            "messages": ChatTimelineMessageSerializer(mensagens, many=True).data,
            "sessions": ChatTimelineSessionSerializer(
                sorted(sessoes.values(), key=lambda c: c.pk), many=True,
            ).data,
            "has_more": tem_anteriores,
        })


@extend_schema(responses={(200, "application/pdf"): OpenApiTypes.BINARY})
class ChatTimelineExportView(APIView):
    """A conversa contínua do cliente em PDF.

    Sem recorte: exportar existe para levar a conversa INTEIRA para fora, e
    um PDF paginado pelas últimas 60 mensagens seria pior que não ter — a
    pessoa acharia que tem tudo. `_so_cliente` guarda a porta pelo mesmo
    motivo da timeline: "todas as minhas sessões" não quer dizer nada para
    um interno, que atende várias pessoas.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _so_cliente(request.user)
        mensagens, _ = chat_service.timeline(request.user, limit=None)
        sessoes = sorted({m.chat_id: m.chat for m in mensagens}.values(), key=lambda c: c.pk)
        try:
            pdf, nome = transcript.chat_pdf(mensagens, sessoes, para=request.user)
        except RuntimeError as exc:
            return Response({"detail": str(exc)}, status=http.HTTP_501_NOT_IMPLEMENTED)
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{nome}"'
        return resp


class ChatTimelineMediaView(APIView):
    """Anexos e links de todas as sessões do cliente — o painel do chat.

    Os links saem do SERVIDOR porque é a única forma de alcançar o histórico
    inteiro: extrair no navegador só encontraria os das mensagens já roladas
    até a tela.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ChatTimelineMediaSerializer)
    def get(self, request):
        _so_cliente(request.user)
        arquivos, links = chat_service.timeline_media(request.user)
        return Response({
            "files": ChatTimelineFileSerializer(arquivos, many=True).data,
            "links": ChatLinkSerializer(links, many=True).data,
        })


class ChatConfigView(APIView):
    """Singleton: GET devolve, PUT altera — admin escreve.

    O GET é para TODO autenticado, mas com formas diferentes: o CLIENTE também
    é consumidor desta config — o modal de avaliação dele desenha a régua com
    `score_min/max` e decide quando exigir justificativa pelo
    `low_score_threshold`. Quando a leitura era só de interno, o portal levava
    403 e o modal caía na escala padrão do código: bastava um admin mudar a
    escala para o cliente passar a avaliar na errada, em silêncio.

    O cliente recebe só a fatia que usa; equipe padrão, timeout de fila e teto
    de chats por agente são operação interna e ficam de fora da resposta dele.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=ChatConfigSerializer)
    def get(self, request):
        config = ChatConfig.load()
        if request.user.is_internal:
            return Response(ChatConfigSerializer(config).data)
        return Response(ClientChatConfigSerializer(config).data)

    @extend_schema(request=ChatConfigSerializer, responses=ChatConfigSerializer)
    def put(self, request):
        # a escrita continua atrás da trava de admin — o IsAuthenticated acima
        # só abriu a LEITURA
        if not (request.user.is_internal and request.user.is_admin):
            raise PermissionDenied("Apenas administradores podem alterar esta configuração.")
        config = ChatConfig.load()
        ser = ChatConfigSerializer(config, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


class ChatMacroViewSet(viewsets.ModelViewSet):
    """Macros — interno lê (pra aplicar), admin gerencia.

    Serve o MESMO cadastro de `/settings/ticket-macros/`: macro é uma só
    desde a unificação (ver `TicketMacro`). A rota sobrevive porque é o que
    a tela de chat já chama; as duas devolvem a mesma lista.
    """

    queryset = TicketMacro.objects.all()
    serializer_class = TicketMacroSerializer
    permission_classes = [IsInternalReadAdminWrite]


class ClientQuickReplyViewSet(viewsets.ModelViewSet):
    """Atalhos de mensagem do chat — QUALQUER autenticado lê, admin gerencia.

    A leitura é aberta ao cliente de propósito: é ele quem usa os atalhos.
    Como `BannedWordViewSet` é `IsInternalReadAdminWrite`, seria fácil copiar
    a permissão de lá por reflexo e o portal levaria 403 na própria função
    que o recurso existe para servir.

    Quem não é interno vê só os ATIVOS: um atalho desligado é decisão de
    operação, não algo para o cliente descobrir que existe.
    """

    serializer_class = ClientQuickReplySerializer
    permission_classes = [IsAuthenticatedReadAdminWrite]

    def get_queryset(self):
        qs = ClientQuickReply.objects.all()
        if not self.request.user.is_internal:
            qs = qs.filter(is_active=True)
        # `?contexto=chat|ticket`. Sem o recorte, o compositor do chamado
        # ofereceria as frases que ABREM uma conversa como resposta a uma
        # pergunta do atendimento. Sem o parâmetro devolve tudo — é o que a
        # tela de cadastro do admin precisa ver.
        contexto = self.request.query_params.get("contexto")
        if contexto in ClientQuickReply.Contexto.values:
            qs = qs.filter(contexto=contexto)
        return qs


class BannedWordViewSet(viewsets.ModelViewSet):
    """Lista de moderação — interno lê, admin gerencia."""

    queryset = BannedWord.objects.order_by("word")
    serializer_class = BannedWordSerializer
    permission_classes = [IsInternalReadAdminWrite]


class ChatCloseReasonViewSet(viewsets.ModelViewSet):
    """Motivos de encerramento — o agente LÊ (para escolher ao encerrar), o
    admin gerencia. Mesma divisão do resto do cadastro do chat.

    A listagem devolve tudo, inclusive desativados: a aba Finalizados precisa
    do motivo antigo para filtrar e para escrever a legenda de um atendimento
    que o usou. Quem esconde o desativado do seletor de encerramento é a tela
    — e o backend recusa encerrar com motivo inativo (ver `close`).
    """

    queryset = ChatCloseReason.objects.all()
    serializer_class = ChatCloseReasonSerializer
    permission_classes = [IsInternalReadAdminWrite]


# ---------------------------------------------------------------------- #
# Relatórios — métrica própria do chat, separada de tickets
# ---------------------------------------------------------------------- #

class ChatReportView(APIView):
    """Agregados por empresa (loja), cliente, agente e nota."""

    permission_classes = [IsInternalReadAdminWrite]

    @extend_schema(
        parameters=[
            OpenApiParameter("by", str, description="company | client | agent | score"),
        ],
        responses=ChatReportRowSerializer(many=True),
    )
    def get(self, request):
        eixo = request.query_params.get("by", "company")
        base = chat_service.visible_chats(request.user)

        # Duração é `timedelta` no Python — `Avg()` sobre ela também sai
        # como `timedelta`, e o JSONRenderer do DRF não sabe serializar
        # isso (achado nesta rodada: sem a conversão abaixo, a resposta
        # quebra com TypeError). Por isso os dois viram minutos (float)
        # antes do Response, nunca a duração crua.
        #
        # `accepted_at`/`closed_at` nulos (chat ainda na fila, ou nunca
        # atendido) fazem a subtração inteira virar NULL — Avg() já ignora
        # NULL sozinho, sem precisar filtrar antes.
        espera = ExpressionWrapper(
            F("accepted_at") - F("queued_at"), output_field=DurationField()
        )
        atendimento = ExpressionWrapper(
            F("closed_at") - F("accepted_at"), output_field=DurationField()
        )
        metricas = dict(
            total=Count("id"),
            fechados=Count("id", filter=Q(status=ChatStatus.CLOSED)),
            convertidos=Count("generated_ticket"),
            nao_atendidos=Count("id", filter=Q(timeout_converted=True)),
            nota_atendimento=Avg("rating__service_score"),
            nota_resolucao=Avg("rating__resolution_score"),
            espera_media_minutos=Avg(espera),
            atendimento_medio_minutos=Avg(atendimento),
        )

        if eixo == "company":
            linhas = base.values(rotulo=models_f("company__name")).annotate(**metricas)
        elif eixo == "client":
            linhas = base.values(rotulo=models_f("client__full_name")).annotate(**metricas)
        elif eixo == "agent":
            linhas = base.exclude(agent=None).values(
                rotulo=models_f("agent__full_name")
            ).annotate(**metricas, nota_do_agente=Avg("agent_score"))
        elif eixo == "score":
            linhas = base.exclude(rating=None).values(
                rotulo=models_f("rating__service_score")
            ).annotate(
                quantidade=Count("id"),
                nota_resolucao=Avg("rating__resolution_score"),
            ).order_by("rotulo")
        else:
            raise ValidationError({"by": "Use company, client, agent ou score."})

        linhas = list(linhas.order_by("-total") if eixo != "score" else linhas)
        for linha in linhas:
            for chave in ("espera_media_minutos", "atendimento_medio_minutos"):
                if chave in linha and linha[chave] is not None:
                    linha[chave] = round(linha[chave].total_seconds() / 60, 1)
        return Response(linhas)


def models_f(campo: str):
    from django.db.models import F
    return F(campo)
