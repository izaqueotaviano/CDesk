"""API de tickets (DRF).

Views orquestram, nunca decidem: leitura via selectors (visible_to), escrita
via ticket_service, mascaramento nos serializers, acesso restrito logado em
audit. Nenhuma regra de negócio mora aqui.
"""

import datetime as dt

from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, Value, When
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from django.utils.http import content_disposition_header
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import status as http
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import (
    APIException,
    NotFound,
    PermissionDenied,
    ValidationError,
)
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Team, TeamVisibility, User, UserKind
from apps.accounts.rbac import Perm
from apps.audit.services import record_ticket_access
from apps.customers.services.quota import QuotaExceeded
from apps.tickets import selectors
from apps.tickets.models import (
    ScanStatus,
    ScheduledReply,
    Service,
    Ticket,
    TicketAttachment,
    TicketCategory,
    TicketMacro,
    TicketMessage,
    TicketPriority,
    TicketSource,
    TicketStage,
    TicketStatus,
    TicketStatusEvent,
    TicketWatcher,
    UserTicketTabs,
)
from apps.tickets.serializers import (
    SLA_AT_RISK_MINUTES,
    AssignableAgentSerializer,
    BulkAssignSerializer,
    BulkCloseSerializer,
    BulkPrioritySerializer,
    BulkStatusSerializer,
    MentionTargetSerializer,
    PresencaBatimentoSerializer,
    PresencaSerializer,
    ScheduledReplySerializer,
    ServiceSerializer,
    TabsSerializer,
    TeamSerializer,
    TicketCategorySerializer,
    TicketCloseByRequesterSerializer,
    TicketCloseSerializer,
    TicketCreateSerializer,
    TicketDetailSerializer,
    TicketListSerializer,
    TicketMessageEditSerializer,
    TicketPendingRatingSerializer,
    TicketRatingAnswerSerializer,
    TicketReclassifySerializer,
    TicketReplySerializer,
    TicketScheduleReplySerializer,
)
from apps.tickets.services import (
    atribuicao,
    mentions,
    response_estimate,
    satisfaction,
    ticket_service,
    transcript,
)

# alias: a ação da view também se chama `presenca` (é o nome da rota)
from apps.tickets.services import presenca as presenca_service
from apps.tickets.services.attachments import (
    AttachmentRejected,
    attach_to_message,
    validar_uploads,
)
from apps.tickets.services.satisfaction import SurveyClosed
from apps.tickets.services.ticket_service import TicketRuleViolation


def _exige(user, perm: str) -> None:
    """Porta de permissão nas ações da API.

    O 403 sai daqui, cedo e com mensagem do próprio catálogo; a regra de
    negócio continua no `ticket_service`, que também vale para quem chama o
    serviço sem passar por HTTP. Ver o cabeçalho de apps/core/permissions.py.
    """
    if not user.can(perm):
        raise PermissionDenied(Perm(perm).label)


class TeamViewSet(viewsets.ReadOnlyModelViewSet):
    """Equipes ativas — alimenta o formulário de abertura do chamado."""

    queryset = Team.objects.filter(is_active=True)
    serializer_class = TeamSerializer

    def get_queryset(self):
        """Equipe interna não é opção para cliente — nem no seletor, nem
        no autocomplete de filtro, que lêem os dois desta mesma lista."""
        qs = super().get_queryset()
        if self.request.user.is_internal:
            return qs
        return qs.filter(internal_only=False)


class ServiceViewSet(viewsets.ReadOnlyModelViewSet):
    """Serviços ativos — alimenta o seletor de abertura (GAPS.md #4); a
    categoria dependente do serviço escolhido é filtrada no frontend a
    partir de `TicketCategorySerializer.service`. Só leitura: o cadastro é
    admin, em `settings/services/`."""

    queryset = Service.objects.filter(is_active=True).order_by("order", "name")
    serializer_class = ServiceSerializer


class TicketCategoryViewSet(viewsets.ReadOnlyModelViewSet):
    """Categorias ativas — alimenta o formulário de abertura, para cliente
    também. Só leitura: o cadastro é admin, em `settings/categories/`."""

    queryset = (
        TicketCategory.objects.filter(is_active=True)
        .select_related("service")
        .order_by("order", "name")
    )
    serializer_class = TicketCategorySerializer


# --------------------------------------------------------------------------- #
# Visões salvas da barra lateral
# --------------------------------------------------------------------------- #

def _apply_saved_view(qs, view, user):
    """Recortes nomeados. Nome desconhecido não filtra nada — a lista completa
    é o pior resultado possível aqui, e é melhor do que uma tela vazia sem
    explicação."""
    unresolved = ~Q(status=TicketStatus.CLOSED)
    regras = {
        # o que o agente abre de manhã
        "meus-nao-resolvidos": Q(assignee=user) & unresolved,
        "todos": Q(),
        # ninguém respondeu ainda: é a fila que sangra SLA
        "sem-atendimento": unresolved & Q(first_response_at__isnull=True),
        "nao-resolvidos": unresolved,
        # TODO ticket visível está no quadro (ele é a fila vista por status),
        # então "estar no kanban" não recorta nada. O que recorta é o que só
        # existe no quadro: o PRAZO INTERNO que alguém anotou ali.
        "em-kanban": Q(cards__due_at__isnull=False),
        "nao-atribuidos": unresolved & Q(assignee__isnull=True),
        "resolvidos": Q(status=TicketStatus.CLOSED),
        # aberto por um interno em nome do cliente (F-C): não consome cota
        "internos": Q(source=TicketSource.INTERNAL),
        # Citaram você numa nota interna. A tabela de menções existe desde
        # sempre justamente para esta pergunta ser um índice e não um regex
        # no corpo da mensagem (ver TicketMention). Menção a EQUIPE conta
        # para quem está na equipe: chamar "o Suporte" é chamar quem atende.
        "mencionam-voce": unresolved & (
            Q(messages__mentions__user=user)
            | Q(messages__mentions__team__agent_links__user=user)
        ),
        # A bola está com você: é seu, não está fechado, e quem falou por
        # último foi o cliente. Sem isto "meus tickets" mistura o que espera
        # resposta com o que espera o cliente — e são coisas opostas.
        "aguardando-voce": (
            Q(assignee=user)
            & unresolved
            & Q(status__in=[TicketStatus.NEW, TicketStatus.OPEN])
        ),
    }
    # `distinct()` porque menção entra por JOIN em mensagens: um ticket com
    # três notas citando você voltaria três vezes, e a CONTAGEM da barra
    # lateral é o primeiro lugar onde isso apareceria errado.
    return qs.filter(regras[view]).distinct() if view in regras else qs


SAVED_VIEWS = (
    "meus-nao-resolvidos", "todos", "sem-atendimento", "nao-resolvidos",
    "em-kanban", "nao-atribuidos", "resolvidos", "internos",
    "mencionam-voce", "aguardando-voce",
)

# `?periodo=` da fila: quantos dias de calendário (hoje incluso) cada opção
# cobre. Só valores fechados — um `?periodo=` livre viraria um segundo
# `desde` com outra sintaxe.
PERIODOS_RELATIVOS = {"hoje": 1, "7d": 7, "30d": 30, "90d": 90}

# Ordenação por coluna da fila (allowlist — nunca o nome do campo cru vindo
# da URL): cada chave pública aponta pro campo (ou anotação) real que o
# `order_by` usa. `criado` e `espera` apontam para o MESMO campo — "aberto
# em" e "tempo de espera" são a mesma data, só a direção padrão que o front
# escolhe pra cada clique é diferente (ver colunasDaFila no front).
ALLOWED_ORDERING = {
    # ordenar por "número" ordena por id (numérico): a string ordenaria
    # TD-100000 antes de TD-99999, e intercalaria por prefixo (TD-/MD-)
    "reference": "id",
    "subject": "subject",
    "criado": "created_at",
    "espera": "created_at",
    "cliente": "company__name",
    "responsavel": "assignee__full_name",
    "categoria": "category__name",
    "urgencia": "priority_rank",
    "status": "stage__order",
    "justificativa": "current_status_note",
    # achado de QA: a coluna SLA existe na tabela e não dava pra ordenar por
    # ela. O mesmo prazo que a célula mostra (SlaCell usa `resolution`,
    # não `first_response`) — NULL (sem SLA) fica sempre por último com o
    # comportamento padrão do Postgres em ASC, o que já é o lugar certo pra
    # quem não tem prazo nenhum.
    "sla": "sla_resolution_due_at",
}

# Baixa < Normal < Alta < Urgente — a ordem que importa pra quem está
# triando, não a ordem alfabética das choices (que dá Alta, Baixa, Normal,
# Urgente e mistura tudo).
_PRIORITY_RANK = Case(
    When(priority=TicketPriority.LOW, then=Value(1)),
    When(priority=TicketPriority.NORMAL, then=Value(2)),
    When(priority=TicketPriority.HIGH, then=Value(3)),
    When(priority=TicketPriority.URGENT, then=Value(4)),
    default=Value(0),
    output_field=IntegerField(),
)


@extend_schema(parameters=[OpenApiParameter(
    # O `id` da URL é inteiro, e quem diz isso é esta linha.
    #
    # O gerador tentaria descobrir sozinho chamando `get_queryset()` com uma
    # requisição falsa — que estoura aqui, porque o queryset depende do usuário
    # logado. Sem resposta ele assume STRING, e a SPA passava a receber
    # `id: string` para uma chave inteira, num tipo que ela mesma gera do
    # schema. Declarar aqui é mais barato do que um `queryset` de classe: este
    # arquivo é camada de request, onde tocar o manager cru de Ticket é
    # proibido pelo teste estrutural (é assim que isolamento entre empresas
    # vaza), e um `.none()` inofensivo abriria exceção numa trava que só vale
    # enquanto não tem exceção.
    "id", OpenApiTypes.INT, OpenApiParameter.PATH,
)])
class TicketViewSet(viewsets.GenericViewSet):
    serializer_class = TicketDetailSerializer
    # aceita JSON e multipart: abrir chamado pode vir com anexo (o cliente
    # manda o print junto). DRF escolhe o parser pelo Content-Type.
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def get_queryset(self):
        return selectors.visible_tickets(self.request.user)

    def get_serializer_class(self):
        """A listagem devolve a forma resumida; o detalhe, a completa.
        Declarar por ação é o que faz o schema (e os tipos do frontend)
        distinguirem `TicketList` de `TicketDetail`."""
        if self.action in ("list", "tabs"):
            return TicketListSerializer
        return TicketDetailSerializer

    # ------------------------------------------------------------------ #
    # CRUD
    # ------------------------------------------------------------------ #

    @extend_schema(parameters=[
        OpenApiParameter(
            "status", str,
            description=(
                "new | open | pending_customer | closed — ou uma LISTA separada "
                "por vírgula (`new,open`)."
            ),
        ),
        OpenApiParameter("team", str, description="slug da equipe"),
        OpenApiParameter("company", int, description="id da empresa"),
        OpenApiParameter(
            "assignee", str,
            description="'me' (minha fila), 'unassigned' (sem responsável) ou o id do agente",
        ),
        OpenApiParameter(
            "priority", str,
            description="low | normal | high | urgent — ou uma LISTA separada por vírgula.",
        ),
        OpenApiParameter("requester", int, description="id do solicitante"),
        OpenApiParameter("q", str, description="busca por assunto ou referência"),
        OpenApiParameter(
            "sla", str,
            description="'breached' ou 'at_risk' — tickets com prazo estourado ou próximo",
        ),
        OpenApiParameter("source", str, description="web | chat | internal"),
        OpenApiParameter(
            "view", str,
            description="visão salva da barra lateral: " + " | ".join(SAVED_VIEWS),
        ),
        OpenApiParameter(
            "ordering", str,
            description=(
                "coluna clicada na fila — " + " | ".join(ALLOWED_ORDERING)
                + " — com `-` na frente pra decrescente (ex.: `-criado`)."
            ),
        ),
        OpenApiParameter(
            "resolucao", str,
            description=(
                "`resolvido` (fechado e ainda reabrível) ou `fechado` "
                "(encerrado automaticamente por falta de resposta, não reabre). "
                "Os dois são `status=closed`; o que muda é se responder reabre."
            ),
        ),
        OpenApiParameter("category", int, description="id da categoria."),
        OpenApiParameter(
            "desde", str,
            description="data de ABERTURA mínima (YYYY-MM-DD), inclusive.",
        ),
        OpenApiParameter(
            "ate", str,
            description="data de ABERTURA máxima (YYYY-MM-DD), inclusive.",
        ),
        OpenApiParameter(
            "periodo", str,
            description=(
                "abertura relativa a hoje: " + " | ".join(PERIODOS_RELATIVOS)
                + " (dias de calendário, hoje incluso)."
            ),
        ),
        OpenApiParameter(
            "avaliacao", str,
            description=(
                "`sim` (CSAT respondido) ou `nao` (fechado e ainda sem nota)."
            ),
        ),
    ])
    def list(self, request):
        ultima_nota = (
            TicketStatusEvent.objects.filter(ticket=OuterRef("pk"))
            .exclude(note="").order_by("-created_at").values("note")[:1]
        )
        qs = (
            self.get_queryset()
            .select_related(
                "company__plan", "stage", "assignee", "category__service",
                # `satisfaction` saiu no serializer da LISTA; sem isto seria
                # uma consulta por linha só para ler a nota.
                "survey",
            )
            .prefetch_related("tags")
            .annotate(priority_rank=_PRIORITY_RANK, current_status_note=Subquery(ultima_nota))
        )
        qs = _aplicar_filtros(qs, request.query_params, request.user)

        # allowlist, nunca o campo cru da URL: `?ordering=` vira SQL direto no
        # `order_by`, e um campo fora da lista abriria caminho pra sondar
        # relações que a fila não deveria expor (ou simplesmente 500 num
        # nome que não existe).
        campo_pedido = request.query_params.get("ordering", "")
        chave = campo_pedido.lstrip("-")
        campo_real = ALLOWED_ORDERING.get(chave)
        if campo_real:
            sentido = "-" if campo_pedido.startswith("-") else ""
            # desempate estável: duas linhas empatadas (dois "Alta" na mesma
            # hora) sempre voltam na mesma ordem entre páginas, senão a
            # paginação repete ou pula linha ao virar página.
            qs = qs.order_by(f"{sentido}{campo_real}", "-created_at")
        else:
            qs = qs.order_by("-created_at")

        page = self.paginate_queryset(qs.distinct())
        ser = TicketListSerializer(page, many=True, context={"request": request})
        return self.get_paginated_response(ser.data)

    def retrieve(self, request, pk=None):
        ticket = self.get_object()  # 404 fora do escopo: não vaza existência
        if ticket.is_restricted():
            # requisito de auditoria: LEITURA logada, inclusive de interno,
            # inclusive tentativa que recebeu conteúdo mascarado
            record_ticket_access(
                ticket=ticket,
                user=request.user,
                context="detail",
                granted=ticket.is_content_visible_to(request.user),
                request=request,
            )
        ser = TicketDetailSerializer(ticket, context={"request": request})
        return Response(ser.data)

    def create(self, request):
        ser = TicketCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        if request.user.kind == UserKind.CLIENT:
            requester = request.user
        else:
            # interno abre em nome de um cliente (F-C: não consome cota)
            requester_id = data.get("requester_id")
            if not requester_id:
                raise ValidationError({"requester_id": "Obrigatório para usuário interno."})
            requester = User.objects.filter(
                pk=requester_id, kind=UserKind.CLIENT, is_active=True
            ).first()
            if requester is None:
                raise ValidationError({"requester_id": "Cliente não encontrado."})

        # O anexo é conferido ANTES de criar o chamado. `create_ticket` abre e
        # fecha a própria transação (ATOMIC_REQUESTS=False,
        # config/settings/base.py): recusar o arquivo só na hora de gravá-lo
        # deixava o chamado nascido e devolvia 400 — a tela lia "não criou", o
        # agente reenviava e o chamado saía duplicado.
        uploads = request.FILES.getlist("files")
        if uploads:
            try:
                validar_uploads(uploads)
            except AttachmentRejected as exc:
                raise ValidationError({"files": str(exc)}) from exc

        try:
            ticket = ticket_service.create_ticket(
                requester=requester,
                team=data["team"],
                subject=data["subject"],
                body=data["body"],
                priority=data["priority"],
                category=data.get("category"),
                order_number=data.get("order_number", ""),
                actor=request.user,
                with_signature=data.get("with_signature", False),
            )
        except QuotaExceeded as exc:
            # 422 com dados para a mensagem clara exigida pelo requisito
            return Response(
                {
                    "detail": (
                        f"Limite de tickets atingido: {exc.used} de {exc.limit} "
                        f"neste período. Renova em {exc.renews_at:%d/%m/%Y}."
                    ),
                    "code": "quota_exceeded",
                    "used": exc.used,
                    "limit": exc.limit,
                    "renews_at": exc.renews_at.isoformat(),
                },
                status=http.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        # Anexo enviado junto na abertura entra na PRIMEIRA mensagem do chamado.
        # A conferência acontece de novo aqui dentro: `attach_to_message`
        # (apps/tickets/services/attachments.py) é a dona da regra e a única
        # porta de gravação — a chamada lá em cima é só antecipação, barata e
        # sem efeito colateral.
        if uploads:
            primeira = ticket.messages.order_by("id").first()
            try:
                attach_to_message(
                    message=primeira, uploads=uploads, uploaded_by=request.user
                )
            except AttachmentRejected as exc:
                raise ValidationError({"files": str(exc)}) from exc

        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data, status=http.HTTP_201_CREATED)

    @extend_schema(request=TicketReclassifySerializer, responses=TicketDetailSerializer)
    def partial_update(self, request, pk=None):
        """Triagem: urgência, categoria, equipe e responsável de um chamado
        já aberto. É o PATCH que o kanban usa ao arrastar por prioridade/
        responsável — e a única porta de reclassificação do sistema."""
        if not request.user.is_internal:
            raise PermissionDenied("Reclassificação é ação interna.")
        ticket = self.get_object()
        ser = TicketReclassifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dados = ser.validated_data

        try:
            if any(k in dados for k in ("priority", "category", "team", "tags")):
                ticket = ticket_service.reclassify(
                    ticket=ticket, actor=request.user,
                    priority=dados.get("priority"),
                    category=dados["category"] if "category" in dados
                    else ticket_service._NAO_INFORMADO,
                    team=dados.get("team"),
                    tags=dados.get("tags"),
                )
            if "assignee" in dados:
                ticket = ticket_service.assign(
                    ticket=ticket, assignee=dados["assignee"], actor=request.user,
                )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    # ------------------------------------------------------------------ #
    # Ações de negócio
    # ------------------------------------------------------------------ #

    @extend_schema(responses=MentionTargetSerializer(many=True))
    # sem paginação: a lista inteira é o contrato (o autocomplete filtra em
    # memória, ver o hook `useMentionTargets`) e uma resposta paginada aqui
    # faria o schema prometer páginas que a view não devolve
    @action(detail=False, methods=["get"], url_path="response-estimate",
            pagination_class=None)
    def response_estimate(self, request):
        """Em quanto tempo a equipe COSTUMA dar a primeira resposta.

        Não é o prazo do SLA — esse já existe e continua valendo. Este é o
        que a operação vem entregando de fato, e é o número que acalma quem
        acabou de abrir. Sem amostra suficiente devolve `null` e a tela não
        mostra nada: previsão tirada de dois chamados é chute com cara de
        dado (ver `services/response_estimate.py`).
        """
        slug = (request.query_params.get("team") or "").strip()
        team = Team.objects.filter(slug=slug, is_active=True).first() if slug else None
        if team is None:
            return Response({"minutes": None, "sample": 0, "label": None})
        minutos, amostra = response_estimate.para_equipe(team)
        return Response({
            "minutes": minutos,
            "sample": amostra,
            "label": response_estimate.humanizar(minutos),
        })

    @action(detail=True, methods=["get"], url_path="export")
    def export(self, request, pk=None):
        """Transcrição do chamado em PDF.

        `get_object()` já resolveu o acesso (404 fora do escopo, sem vazar
        existência) — aqui só falta a regra de CONTEÚDO: num chamado de
        equipe restrita, quem não é o solicitante lê a lista mascarada na
        tela, e um PDF é justamente o formato que sai do sistema. Baixar o
        texto integral por outra porta desfaria a máscara.
        """
        ticket = self.get_object()
        if not ticket.is_content_visible_to(request.user):
            raise PermissionDenied(
                "Este ticket é restrito ao solicitante; a conversa não pode ser exportada."
            )
        if ticket.is_restricted():
            record_ticket_access(
                ticket=ticket, user=request.user, context="export",
                granted=True, request=request,
            )
        try:
            pdf, nome = transcript.ticket_pdf(ticket, para=request.user)
        except RuntimeError as exc:
            # extra ausente: falha explícita, nunca um PDF vazio
            return Response({"detail": str(exc)}, status=http.HTTP_501_NOT_IMPLEMENTED)
        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{nome}"'
        return resp

    @action(detail=True, methods=["get"], url_path="mention-targets",
            pagination_class=None)
    def mention_targets(self, request, pk=None):
        """Quem pode ser mencionado neste ticket — agentes ativos e equipes.

        Cliente nunca chega aqui: menção é conversa interna, e devolver a lista
        de agentes para quem está do lado de fora já seria vazamento, mesmo sem
        ele conseguir mencionar. A lista sai inteira e o filtro por texto é do
        front — ver o porquê em `services/mentions.alvos_de_mencao`.
        """
        if not request.user.is_internal:
            raise PermissionDenied("Menção é recurso interno.")
        ticket = self.get_object()
        alvos = mentions.alvos_de_mencao(ticket=ticket, requester=request.user)
        return Response(MentionTargetSerializer(alvos, many=True).data)

    @action(detail=True, methods=["get"], url_path="assignable-agents",
            pagination_class=None)
    def assignable_agents(self, request, pk=None):
        """Quem os seletores de Responsável e Dono técnico podem oferecer.

        Pergunta DIFERENTE da de `mention_targets` — ver o porquê completo em
        `services/atribuicao.py`. Resumo: aqui o requester PRECISA aparecer
        (é o "Assumir" pelo seletor) e agente leve NÃO aparece (não passa em
        `assign()`/`set_owner()`, que exigem `Perm.TICKET_BE_ASSIGNED`).

        `self.get_object()` só para 404 fora do escopo — igual a
        `mention_targets`, a lista em si não depende do ticket (nem tem
        recorte por equipe: `services/atribuicao.agentes_atribuiveis`).
        """
        if not request.user.is_internal:
            raise PermissionDenied("Atribuição é recurso interno.")
        self.get_object()
        agentes = atribuicao.agentes_atribuiveis()
        return Response(AssignableAgentSerializer(agentes, many=True).data)

    @action(detail=True, methods=["post"],
            parser_classes=[JSONParser, MultiPartParser, FormParser])
    def reply(self, request, pk=None):
        ticket = self.get_object()
        ser = TicketReplySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        if not request.user.is_internal and data.get("new_status"):
            raise ValidationError({"new_status": "Cliente não escolhe status."})

        # Mesmo motivo do `create`: o anexo é conferido antes de gravar a
        # mensagem. `add_reply` já muda o status, notifica e conta SLA em
        # transação própria; recusar o arquivo depois disso deixava a resposta
        # publicada e pedia "tente de novo" — cada retentativa gravava outra
        # mensagem na thread.
        uploads = request.FILES.getlist("files")
        if uploads:
            try:
                validar_uploads(uploads)
            except AttachmentRejected as exc:
                raise ValidationError({"files": str(exc)}) from exc

        try:
            message = ticket_service.add_reply(
                ticket=ticket,
                author=request.user,
                body=data["body"],
                is_public=data["is_public"],
                new_status=data.get("new_status"),
                resolution_started_at=data.get("resolution_started_at"),
                resolution_ended_at=data.get("resolution_ended_at"),
                close_note=data.get("close_note", ""),
                with_signature=data.get("with_signature", False),
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        # anexos entram na mesma requisição: validação em lote antes de gravar
        # (repetida de propósito — ver o comentário na conferência acima)
        if uploads:
            try:
                attach_to_message(
                    message=message, uploads=uploads, uploaded_by=request.user
                )
            except AttachmentRejected as exc:
                raise ValidationError({"files": str(exc)}) from exc

        ticket.refresh_from_db()
        # dica de realtime: quem acompanha o ticket revalida a conversa (a
        # resposta do cliente que chega por e-mail aparece sem F5)
        from apps.notifications.services import broadcast_ticket_event

        broadcast_ticket_event(ticket=ticket, kind="reply", actor=request.user)
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data, status=http.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        if not request.user.is_internal:
            raise PermissionDenied("Apenas usuários internos atribuem tickets.")
        ticket = self.get_object()
        assignee = None
        if assignee_id := request.data.get("assignee_id"):
            # só AGENTE recebe atribuição — conta de cliente aqui deixaria o
            # ticket com um responsável que nem consegue enxergá-lo
            assignee = User.objects.filter(
                pk=assignee_id, is_active=True, kind=UserKind.INTERNAL,
            ).first()
            if assignee is None:
                raise ValidationError({"assignee_id": "Agente não encontrado."})
        try:
            ticket = ticket_service.assign(
                ticket=ticket, assignee=assignee, actor=request.user
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @extend_schema(request=None, responses=TicketDetailSerializer)
    @action(detail=False, methods=["post"], url_path="take-next")
    def take_next(self, request):
        """"Pegar o próximo" do Início: escolhe E atribui numa transação só.

        Antes a tela escolhia pela listagem e atribuía com `assign/` em dois
        pedidos — dois agentes clicando no mesmo segundo pegavam o MESMO
        chamado, e o segundo passava por cima do primeiro. Aqui a linha
        escolhida fica travada (`select_for_update`) até a atribuição gravar,
        e `skip_locked` faz o segundo clique pular para o próximo da fila em
        vez de esperar pelo mesmo.

        A ordem é a da tela (resolv/inicio/pegarProximo.ts): o prazo de SLA de
        resolução que vence primeiro (sem prazo por último), depois a
        prioridade mais alta, depois o mais antigo. "Aguardando o cliente"
        fica de fora — ali a bola está com o cliente.
        """
        user = request.user
        if not user.is_internal:
            raise PermissionDenied("Apenas usuários internos pegam tickets.")
        if not user.can(Perm.TICKET_BE_ASSIGNED):
            raise PermissionDenied("Seu papel não pode ser responsável por tickets.")
        try:
            ticket = ticket_service.take_next(
                actor=user, candidatos=selectors.visible_tickets(user),
            )
        except ticket_service.NadaParaPegar:
            return Response(
                {"code": "nada_para_pegar", "detail": "Nenhum ticket sem responsável agora."},
                status=http.HTTP_409_CONFLICT,
            )
        except TicketRuleViolation as exc:
            raise PermissionDenied(str(exc)) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"], url_path="set-owner")
    def set_owner(self, request, pk=None):
        """"Dono técnico" — campo separado de `assignee` (ver
        `ticket_service.set_owner`, docs/05 §3.2). Mesma validação de
        `assign()`: só agente interno ativo."""
        if not request.user.is_internal:
            raise PermissionDenied("Apenas usuários internos definem o dono técnico.")
        ticket = self.get_object()
        owner = None
        if owner_id := request.data.get("owner_id"):
            owner = User.objects.filter(
                pk=owner_id, is_active=True, kind=UserKind.INTERNAL,
            ).first()
            if owner is None:
                raise ValidationError({"owner_id": "Agente não encontrado."})
        try:
            ticket = ticket_service.set_owner(
                ticket=ticket, owner=owner, actor=request.user
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"], url_path="apply-macro")
    def apply_macro(self, request, pk=None):
        """Aplica uma macro de chamado — espelha `ChatViewSet.apply_macro`
        (`apps/chat/views.py`). O texto pronto (`macro.body`) o front já tem
        no payload de `settings/ticket-macros/`; esta ação só grava os
        campos de negócio (ver `ticket_service.apply_macro`)."""
        ticket = self.get_object()
        if not request.user.is_internal:
            raise PermissionDenied("Macro é recurso interno.")
        macro = TicketMacro.objects.filter(
            pk=request.data.get("macro_id"), is_active=True
        ).first()
        if macro is None:
            raise ValidationError({"macro_id": "Macro não encontrada."})
        try:
            ticket = ticket_service.apply_macro(ticket=ticket, macro=macro, actor=request.user)
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"])
    def follow(self, request, pk=None):
        """"+ Seguir" manual (GAPS.md — achado durante a Fase 2: só existia o
        efeito colateral de virar seguidor por @menção, `mentions.py:108`,
        nenhuma porta para fazer isso de propósito)."""
        if not request.user.is_internal:
            raise PermissionDenied("Seguir ticket é ação interna.")
        ticket = self.get_object()
        if not ticket.is_content_visible_to(request.user):
            raise PermissionDenied("Sem acesso ao conteúdo deste ticket.")
        TicketWatcher.objects.get_or_create(ticket=ticket, user=request.user)
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"])
    def unfollow(self, request, pk=None):
        ticket = self.get_object()
        TicketWatcher.objects.filter(ticket=ticket, user=request.user).delete()
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @extend_schema(request=PresencaBatimentoSerializer, responses=PresencaSerializer)
    @action(detail=True, methods=["post", "delete"], url_path="presenca")
    def presenca(self, request, pk=None):
        """Quem mais está com este ticket aberto — detecção de colisão.

        POST é o batimento (ao abrir, a cada `BATIMENTO_S` e quando começa ou
        para de digitar); DELETE é "fechei a tela". Os dois devolvem a lista
        atual. Estado só em cache, com TTL: ver apps/tickets/services/presenca.py.

        Só interno, e o 403 sai ANTES de olhar o ticket: para cliente a
        resposta é a mesma exista o ticket ou não. Para interno, `get_object`
        aplica o escopo de sempre (`visible_tickets`) — fora dele, 404 — então
        só entra na lista, e só recebe a lista, quem enxerga o chamado.
        """
        if not request.user.is_internal:
            raise PermissionDenied("Presença no ticket é recurso interno.")
        ticket = self.get_object()
        if request.method == "DELETE":
            presentes = presenca_service.sair(ticket=ticket, user=request.user)
        else:
            ser = PresencaBatimentoSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            presentes = presenca_service.registrar(
                ticket=ticket, user=request.user,
                digitando=ser.validated_data.get("digitando"),
            )
        return Response({
            "presentes": presentes,
            "batimento_segundos": presenca_service.BATIMENTO_S,
        })

    @action(detail=True, methods=["patch", "delete"],
            url_path=r"messages/(?P<message_id>\d+)")
    def message(self, request, pk=None, message_id=None):
        """Corrige ou apaga uma mensagem já enviada.

        Passa pelo `get_object()` do ticket de propósito: quem não enxerga o
        chamado não alcança as mensagens dele nem por id direto. Quem PODE
        mexer é decidido no serviço (só o autor) — a view não duplica a regra.
        """
        ticket = self.get_object()
        message = ticket.messages.filter(pk=message_id).first()
        if message is None:
            raise NotFound("Mensagem não encontrada neste ticket.")
        # conteúdo mascarado (equipe restrita) não vira superfície de escrita
        if not ticket.is_content_visible_to(request.user):
            raise PermissionDenied("Sem acesso ao conteúdo deste ticket.")

        try:
            if request.method == "DELETE":
                ticket_service.delete_message(message=message, actor=request.user)
            else:
                ser = TicketMessageEditSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                ticket_service.edit_message(
                    message=message, actor=request.user, body=ser.validated_data["body"]
                )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        ticket.refresh_from_db()
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Fecha o ticket — o agente com o registro de trabalho técnico
        (D4), o cliente sem ele (`close_ticket_by_requester`). É a MESMA
        rota pros dois lados; quem decide qual caminho seguir é
        `request.user.is_internal`, não um endpoint separado por papel —
        mesma forma da rota de chat (`ChatViewSet.close`)."""
        ticket = self.get_object()
        try:
            if request.user.is_internal:
                ser = TicketCloseSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                ticket = ticket_service.close_ticket(
                    ticket=ticket,
                    actor=request.user,
                    resolution_started_at=ser.validated_data["resolution_started_at"],
                    resolution_ended_at=ser.validated_data["resolution_ended_at"],
                    note=ser.validated_data.get("note", ""),
                )
            else:
                ser = TicketCloseByRequesterSerializer(data=request.data)
                ser.is_valid(raise_exception=True)
                ticket = ticket_service.close_ticket_by_requester(
                    ticket=ticket,
                    actor=request.user,
                    note=ser.validated_data.get("note", ""),
                )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    # ------------------------------------------------------------------ #
    # Resposta agendada — escrita agora, disparada sozinha na hora marcada
    # (`ticket_service.schedule_reply`/`dispatch_scheduled_replies`).
    # ------------------------------------------------------------------ #

    @action(detail=True, methods=["post"], url_path="schedule-reply")
    def schedule_reply(self, request, pk=None):
        ticket = self.get_object()
        ser = TicketScheduleReplySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            agendada = ticket_service.schedule_reply(
                ticket=ticket, actor=request.user, **ser.validated_data,
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(
            ScheduledReplySerializer(agendada).data, status=http.HTTP_201_CREATED
        )

    @action(
        detail=True, methods=["post"],
        url_path=r"schedule-reply/(?P<schedule_id>\d+)/cancel",
    )
    def cancel_scheduled_reply(self, request, pk=None, schedule_id=None):
        ticket = self.get_object()
        agendada = ScheduledReply.objects.filter(pk=schedule_id, ticket=ticket).first()
        if agendada is None:
            raise NotFound("Agendamento não encontrado neste ticket.")
        try:
            agendada = ticket_service.cancel_scheduled_reply(
                scheduled=agendada, actor=request.user,
            )
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        return Response(ScheduledReplySerializer(agendada).data)

    # ------------------------------------------------------------------ #
    # Avaliação (CSAT) — sempre logado, sempre por aqui. Não existe mais
    # convite por e-mail nem página pública por token: esta é a única
    # porta (ver o cabeçalho de `services/satisfaction.py`).
    # ------------------------------------------------------------------ #

    @action(detail=False, methods=["get"], url_path="pending-ratings")
    def pending_ratings(self, request):
        """Chamados fechados do PRÓPRIO solicitante ainda sem nota — o
        front usa pra avisar na home e liberar o botão na tela do chamado."""
        pendentes = satisfaction.pending_for(request.user)
        out = TicketPendingRatingSerializer(pendentes, many=True)
        return Response(out.data)

    @action(detail=True, methods=["post"], url_path="rate")
    def rate(self, request, pk=None):
        ticket = self.get_object()
        if ticket.requester_id != request.user.id:
            raise PermissionDenied("Só quem abriu o ticket avalia o atendimento.")
        survey = getattr(ticket, "survey", None)
        if survey is None:
            raise NotFound("Este ticket não tem pesquisa de satisfação.")
        ser = TicketRatingAnswerSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            satisfaction.answer(
                survey,
                score=ser.validated_data["score"],
                comment=ser.validated_data.get("comment", ""),
            )
        except SurveyClosed as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        out = TicketDetailSerializer(ticket, context={"request": request})
        return Response(out.data)

    # ------------------------------------------------------------------ #
    # Abas persistentes (docs/01 §6)
    # ------------------------------------------------------------------ #

    @action(detail=False, methods=["get", "put"], url_path="tabs")
    def tabs(self, request):
        """Estado das abas de ticket do usuário.

        GET devolve as abas RECONCILIADAS: id que saiu do escopo de visibilidade
        é descartado em silêncio (e persiste descartado). PUT substitui o estado —
        aceita apenas tickets visíveis ao usuário.
        """
        state, _ = UserTicketTabs.objects.get_or_create(user=request.user)

        if request.method == "PUT":
            ser = TabsSerializer(data=request.data)
            ser.is_valid(raise_exception=True)
            ids = ser.validated_data["ticket_ids"]
            visible = set(
                self.get_queryset().filter(pk__in=ids).values_list("pk", flat=True)
            )
            now = timezone.now().isoformat()
            existing = {t["ticket_id"]: t for t in state.tabs}
            state.tabs = [
                existing.get(i, {"ticket_id": i, "opened_at": now})
                for i in ids
                if i in visible
            ]
            active = ser.validated_data.get("active_ticket_id")
            state.active_ticket_id = active if active in visible else None
            state.save(update_fields=["tabs", "active_ticket_id", "updated_at"])

        # reconciliação na leitura (GET e resposta do PUT)
        ids = [t["ticket_id"] for t in state.tabs]
        # `survey`: o serializer da lista devolve `satisfaction` (ver o
        # comentário em `list`), e são poucas abas mas uma consulta cada.
        visible_qs = self.get_queryset().filter(pk__in=ids).select_related("survey")
        visible_ids = set(visible_qs.values_list("pk", flat=True))
        if len(visible_ids) != len(ids):
            state.tabs = [t for t in state.tabs if t["ticket_id"] in visible_ids]
            if state.active_ticket_id not in visible_ids:
                state.active_ticket_id = None
            state.save(update_fields=["tabs", "active_ticket_id", "updated_at"])

        by_id = {t.pk: t for t in visible_qs}
        ordered = [by_id[t["ticket_id"]] for t in state.tabs]
        ser = TicketListSerializer(ordered, many=True, context={"request": request})
        return Response({"tabs": ser.data, "active_ticket_id": state.active_ticket_id})

    @action(detail=False, methods=["get"], url_path="facets")
    def facets(self, request):
        """Contagem por status/prioridade/empresa/responsável (GAPS.md,
        checklist da Fase 3: "nenhum endpoint de agregação/contagem por
        faceta"). Aceita os MESMOS parâmetros de `list()` — a pergunta é
        "com os filtros de hoje, quantos tickets teria CADA VALOR desta
        dimensão". Por isso cada faceta é contada com todos os filtros
        aplicados MENOS o dela mesma (`exceto`): senão trocar de
        prioridade nunca apareceria como opção depois de já ter escolhido
        uma — a faceta ficaria presa no valor atual.

        `status`/`priority` são enums pequenos e fixos: devolve as 4
        opções sempre, contagem 0 inclusive (a pessoa quer saber que não
        tem nenhum "Baixa" agora, não só as que têm). `company`/`assignee`
        são abertos — só entra quem tem count > 0, maior primeiro.
        """
        base = self.get_queryset()
        params = request.query_params

        def contar(exceto):
            return _aplicar_filtros(base, params, request.user, exceto=exceto).order_by()

        status_counts = dict(
            contar({"status"}).values_list("status").annotate(n=Count("id"))
        )
        priority_counts = dict(
            contar({"priority"}).values_list("priority").annotate(n=Count("id"))
        )
        company_rows = (
            contar({"company"})
            .values("company_id", "company__name")
            .annotate(n=Count("id"))
            .order_by("-n")
        )
        assignee_rows = (
            contar({"assignee"})
            .values("assignee_id", "assignee__full_name")
            .annotate(n=Count("id"))
            .order_by("-n")
        )
        # Plano fica ordenado por `rank` (maior = plano superior), não pela
        # contagem: a barra lateral lista Black, Platinum, Gold sempre na
        # mesma ordem, e uma lista que se reordena sozinha conforme o dia
        # obriga a reler o rótulo toda vez em vez de ir pela posição.
        plan_rows = (
            contar({"plan"})
            .values("company__plan__slug", "company__plan__name", "company__plan__rank")
            .annotate(n=Count("id"))
            .order_by("-company__plan__rank", "company__plan__name")
        )
        sem_dominio = contar({"sem_dominio"}).filter(company__domains__isnull=True).count()
        extras = _facetas_da_fila(contar)

        return Response({
            **extras,
            "status": [
                {"value": value, "label": label, "count": status_counts.get(value, 0)}
                for value, label in TicketStatus.choices
            ],
            "priority": [
                {"value": value, "label": label, "count": priority_counts.get(value, 0)}
                for value, label in TicketPriority.choices
            ],
            "company": [
                {"value": r["company_id"], "label": r["company__name"], "count": r["n"]}
                for r in company_rows
            ],
            "assignee": [
                {
                    "value": r["assignee_id"],
                    "label": r["assignee__full_name"] or "Não atribuído",
                    "count": r["n"],
                }
                for r in assignee_rows
            ],
            "plan": [
                {
                    # devolve exatamente o que o filtro `?plan=` aceita
                    "value": r["company__plan__slug"],
                    "label": r["company__plan__name"],
                    "count": r["n"],
                }
                for r in plan_rows
            ],
            "sem_dominio": sem_dominio,
        })

    # ------------------------------------------------------------------ #
    # Ações em lote (Fase 3 do prompt de integração, GAPS.md)
    # ------------------------------------------------------------------ #
    #
    # Nenhuma é atômica no lote inteiro: cada ticket é uma entidade
    # independente, e travar 30 porque 1 já está fechado seria pior do que
    # aplicar nos 29 e reportar o que não deu — `updated` traz quem mudou,
    # `failed` só cobre ids que ERAM visíveis mas o serviço rejeitou. Um id
    # fora do escopo do usuário nunca aparece em lugar nenhum da resposta —
    # mesmo cuidado de `retrieve()` ("404 fora do escopo: não vaza
    # existência"): reportar falha nele vazaria a mesma coisa.

    def _tickets_visiveis(self, ids):
        """Os tickets pedidos que o usuário PODE ver — mesmo filtro que
        `tabs()` já usa (`get_queryset().filter(pk__in=ids)`). Os que saem
        da lista somem em silêncio: não entram nem em `updated` nem em
        `failed`."""
        return list(self.get_queryset().filter(pk__in=ids))

    @action(detail=False, methods=["get"], url_path="atividade")
    def atividade(self, request):
        """O que aconteceu nos tickets que VOCÊ enxerga, do mais recente.

        Sai de duas tabelas que já são recortadas por visibilidade —
        `status_events` e `messages` sobre `visible_to(user)` — e não do log
        de auditoria. O log é de admin por desenho (é ele que registra login,
        exportação e anonimização), e abri-lo para todo agente para alimentar
        um feed de tela inicial trocaria uma tela por um vazamento.

        Cada item já vem com o VERBO montado no servidor. A alternativa era
        mandar o cru e deixar a tela decidir se `to_status=closed` vira
        "resolveu" ou "fechou" — e aí duas telas escreveriam duas frases
        diferentes para o mesmo fato.
        """
        limite = min(int(request.query_params.get("limit", 15)), 50)
        visiveis = Ticket.objects.visible_to(request.user)

        eventos = (
            TicketStatusEvent.objects.filter(ticket__in=visiveis)
            .select_related("ticket", "changed_by")
            .order_by("-created_at")[:limite]
        )
        mensagens = (
            # `is_deleted` é propriedade Python; quem filtra é o campo por trás dela
            TicketMessage.objects.filter(ticket__in=visiveis, deleted_at__isnull=True)
            .select_related("ticket", "author")
            .order_by("-created_at")[:limite]
        )

        itens = []
        for e in eventos:
            if e.note:
                # mudança de campo viaja como nota do evento ("urgência → Alta")
                verbo, detalhe = "alterou", e.note
            elif e.is_reopen:
                verbo, detalhe = "reabriu", ""
            elif e.to_status == TicketStatus.CLOSED:
                verbo, detalhe = "resolveu", ""
            elif e.from_status is None:
                verbo, detalhe = ("converteu um chat em", "") \
                    if e.ticket.source == TicketSource.CHAT else ("abriu", "")
            else:
                verbo, detalhe = "mudou o status de", TicketStatus(e.to_status).label
            itens.append({
                "kind": "status",
                "actor": (e.changed_by.full_name if e.changed_by else "Sistema"),
                "verb": verbo,
                "detail": detalhe,
                "ticket_id": e.ticket_id,
                "reference": e.ticket.reference,
                "at": e.created_at,
            })

        for m in mensagens:
            itens.append({
                "kind": "note" if not m.is_public else "reply",
                "actor": (m.author.full_name if m.author else "Sistema"),
                "verb": "deixou nota interna em" if not m.is_public else "respondeu",
                "detail": "",
                "ticket_id": m.ticket_id,
                "reference": m.ticket.reference,
                "at": m.created_at,
            })

        itens.sort(key=lambda i: i["at"], reverse=True)
        return Response({"results": itens[:limite]})

    @action(detail=False, methods=["get"], url_path="resumo")
    def resumo(self, request):
        """Tudo que a Visão geral precisa, numa chamada.

        Cada cartão de lá mostra um número E a frase que diz por que ele
        importa — "4 não atribuídos, o mais antigo há 38 min", "3 em risco,
        2 são plano Black". Montar isso no navegador seria uma dúzia de
        requisições com `limit=1` só para ler `count`, e o subtexto de cada
        cartão chegaria em momento diferente do número: a tela piscaria
        números soltos antes de fazer sentido. Aqui é uma consulta por
        pergunta, e a tela recebe o painel inteiro pronto ou nada.

        Tudo passa por `get_queryset()`, então um agente leve vê os números
        do que ele pode ver — o resumo nunca conta ticket que a pessoa não
        poderia abrir.
        """
        agora = timezone.now()
        base = self.get_queryset()
        nao_resolvidos = base.exclude(status=TicketStatus.CLOSED)

        # ── não atribuídos, e há quanto tempo o mais antigo espera ────────
        sem_dono = nao_resolvidos.filter(assignee__isnull=True)
        mais_antigo = sem_dono.order_by("created_at").values_list("created_at", flat=True).first()

        # ── SLA: em risco, e quantos estouram na próxima hora ─────────────
        pendente_1a = Q(first_response_at__isnull=True)
        limite_risco = agora + dt.timedelta(minutes=SLA_AT_RISK_MINUTES)
        em_risco = nao_resolvidos.filter(
            (pendente_1a & Q(sla_first_response_due_at__range=(agora, limite_risco)))
            | Q(sla_resolution_due_at__range=(agora, limite_risco)),
        ).distinct()
        uma_hora = agora + dt.timedelta(hours=1)
        estouram_em_1h = nao_resolvidos.filter(
            (pendente_1a & Q(sla_first_response_due_at__range=(agora, uma_hora)))
            | Q(sla_resolution_due_at__range=(agora, uma_hora)),
        ).distinct().count()
        risco_por_plano = list(
            em_risco.values("company__plan__slug", "company__plan__name")
            .annotate(n=Count("id", distinct=True))
            .order_by("-company__plan__rank")
        )

        # ── o dia: abertos e resolvidos hoje, contra ontem ────────────────
        hoje = timezone.localtime(agora).date()
        ontem = hoje - dt.timedelta(days=1)
        abertos_hoje = base.filter(created_at__date=hoje).count()
        abertos_ontem = base.filter(created_at__date=ontem).count()
        fechados_hoje = base.filter(status=TicketStatus.CLOSED, closed_at__date=hoje)

        # Média de resolução em minutos, só do que fechou hoje. `values_list`
        # e não `.only()`: o queryset base já traz `select_related`, e adiar
        # um campo que ele atravessa é erro de consulta — além de que aqui
        # nem precisa do modelo, só de duas datas.
        duracoes = [
            (fim - inicio).total_seconds() / 60
            for inicio, fim in fechados_hoje.values_list("created_at", "closed_at")
            if fim
        ]
        media_resolucao = round(sum(duracoes) / len(duracoes)) if duracoes else None

        meus = nao_resolvidos.filter(assignee=request.user)

        # Contagem de CADA visão salva. Fica aqui e não em cinco chamadas do
        # navegador porque é isso que a barra lateral desenha de uma vez: com
        # uma requisição por visão, os números apareceriam um a um e a lista
        # dançaria durante um segundo a cada troca de tela.
        visoes = {
            v: _apply_saved_view(base, v, request.user).count()
            for v in SAVED_VIEWS
        }

        return Response({
            "visoes": visoes,
            "abertos": {
                "total": nao_resolvidos.count(),
                "hoje": abertos_hoje,
                # positivo = abriram mais hoje que ontem
                "variacao_dia": abertos_hoje - abertos_ontem,
            },
            "nao_atribuidos": {
                "total": sem_dono.count(),
                "espera_mais_longa_min": (
                    round((agora - mais_antigo).total_seconds() / 60) if mais_antigo else None
                ),
            },
            "sla_em_risco": {
                "total": em_risco.count(),
                "estouram_em_1h": estouram_em_1h,
                "por_plano": [
                    {
                        "plan": r["company__plan__slug"],
                        "label": r["company__plan__name"],
                        "count": r["n"],
                    }
                    for r in risco_por_plano
                ],
            },
            "meus": {
                "total": meus.count(),
                # a bola está comigo: mesma definição da visão salva
                "aguardando_voce": meus.filter(
                    status__in=[TicketStatus.NEW, TicketStatus.OPEN]
                ).count(),
            },
            "resolvidos_hoje": {
                "total": fechados_hoje.count(),
                "media_resolucao_min": media_resolucao,
            },
        })

    @action(detail=False, methods=["post"], url_path="bulk-assign")
    def bulk_assign(self, request):
        _exige(request.user, Perm.TICKET_BULK_ACTIONS)
        ser = BulkAssignSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        assignee = None
        if assignee_id := ser.validated_data.get("assignee_id"):
            assignee = User.objects.filter(
                pk=assignee_id, is_active=True, kind=UserKind.INTERNAL,
            ).first()
            if assignee is None:
                raise ValidationError({"assignee_id": "Agente não encontrado."})
        updated, failed = [], []
        for ticket in self._tickets_visiveis(ser.validated_data["ticket_ids"]):
            try:
                ticket_service.assign(ticket=ticket, assignee=assignee, actor=request.user)
                updated.append(ticket.pk)
            except TicketRuleViolation as exc:
                failed.append({"id": ticket.pk, "detail": str(exc)})
        return Response({"updated": updated, "failed": failed})

    @action(detail=False, methods=["post"], url_path="bulk-priority")
    def bulk_priority(self, request):
        _exige(request.user, Perm.TICKET_BULK_ACTIONS)
        ser = BulkPrioritySerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        updated, failed = [], []
        for ticket in self._tickets_visiveis(ser.validated_data["ticket_ids"]):
            try:
                ticket_service.reclassify(
                    ticket=ticket, actor=request.user,
                    priority=ser.validated_data["priority"],
                )
                updated.append(ticket.pk)
            except TicketRuleViolation as exc:
                failed.append({"id": ticket.pk, "detail": str(exc)})
        return Response({"updated": updated, "failed": failed})

    @action(detail=False, methods=["post"], url_path="bulk-close")
    def bulk_close(self, request):
        _exige(request.user, Perm.TICKET_BULK_ACTIONS)
        _exige(request.user, Perm.TICKET_CLOSE)
        ser = BulkCloseSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        updated, failed = [], []
        for ticket in self._tickets_visiveis(ser.validated_data["ticket_ids"]):
            try:
                ticket_service.close_ticket(
                    ticket=ticket, actor=request.user,
                    resolution_started_at=ser.validated_data["resolution_started_at"],
                    resolution_ended_at=ser.validated_data["resolution_ended_at"],
                    note=ser.validated_data.get("note", ""),
                )
                updated.append(ticket.pk)
            except TicketRuleViolation as exc:
                failed.append({"id": ticket.pk, "detail": str(exc)})
        return Response({"updated": updated, "failed": failed})

    @action(detail=False, methods=["post"], url_path="bulk-status")
    def bulk_status(self, request):
        """Muda o status (coluna) de vários chamados — mesma porta e mesma
        forma de resposta das outras três ações em lote. O stage é o mesmo
        para o lote inteiro, então um stage inválido é 400 no pedido todo
        (não uma falha repetida em cada linha de `failed`)."""
        _exige(request.user, Perm.TICKET_BULK_ACTIONS)
        ser = BulkStatusSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        stage = TicketStage.objects.filter(
            pk=ser.validated_data["stage_id"], is_active=True,
        ).first()
        if stage is None:
            raise ValidationError({"stage_id": "Status não encontrado."})
        if stage.category == TicketStatus.CLOSED:
            raise ValidationError({
                "stage_id": "Para encerrar, use Encerrar: fechar pede as datas da solução.",
            })
        updated, failed = [], []
        for ticket in self._tickets_visiveis(ser.validated_data["ticket_ids"]):
            try:
                ticket_service.mudar_status(ticket=ticket, stage=stage, actor=request.user)
                updated.append(ticket.pk)
            except TicketRuleViolation as exc:
                failed.append({"id": ticket.pk, "detail": str(exc)})
        return Response({"updated": updated, "failed": failed})


def _facetas_da_fila(contar):
    """As facetas que a barra de filtros da fila (resolv/tickets) pede além
    das quatro de `facets()`: equipe, categoria, etiqueta e SLA.

    Mesma regra de faceta de lá (`contar(exceto)` conta com todos os filtros
    MENOS o da própria dimensão) e mesmo formato `{value, label, count}`,
    com `value` sendo exatamente o que o filtro correspondente aceita — slug
    para equipe e etiqueta, id para categoria. Dimensão aberta: só entra quem
    tem count > 0, maior primeiro; "sem categoria" não entra porque não
    existe filtro que o selecione.

    SLA são só duas perguntas fixas (em risco / estourado), então as duas
    voltam sempre, zero inclusive — mesmo raciocínio de status/prioridade.
    Contadas reaplicando o próprio `?sla=` sobre a base sem ele: a definição
    de "em risco" continua morando num lugar só (`_aplicar_filtros`).
    """
    equipes = (
        contar({"team"})
        .exclude(team__isnull=True)
        .values("team__slug", "team__name")
        .annotate(n=Count("id", distinct=True))
        .order_by("-n", "team__name")
    )
    categorias = (
        contar({"category"})
        .exclude(category__isnull=True)
        .values("category_id", "category__name")
        .annotate(n=Count("id", distinct=True))
        .order_by("-n", "category__name")
    )
    etiquetas = (
        contar({"tag"})
        .exclude(tags__isnull=True)
        .values("tags__slug", "tags__name")
        .annotate(n=Count("id", distinct=True))
        .order_by("-n", "tags__name")
    )
    sem_sla = contar({"sla"})
    return {
        "team": [
            {"value": r["team__slug"], "label": r["team__name"], "count": r["n"]}
            for r in equipes
        ],
        "category": [
            {"value": r["category_id"], "label": r["category__name"], "count": r["n"]}
            for r in categorias
        ],
        "tag": [
            {"value": r["tags__slug"], "label": r["tags__name"], "count": r["n"]}
            for r in etiquetas
        ],
        "sla": [
            {
                "value": valor,
                "label": rotulo,
                "count": _aplicar_filtros(sem_sla, {"sla": valor}, None).count(),
            }
            for valor, rotulo in (("at_risk", "Em risco"), ("breached", "Estourado"))
        ],
    }


def _busca_q(user, term: str) -> Q:
    """O `?q=` da fila e da busca global.

    A REFERÊNCIA sempre casa: ela não é conteúdo, é o número que o cliente cita
    ao telefone.

    O ASSUNTO, não. Num ticket de equipe restrita o assunto é mascarado
    para quem não é o solicitante — e casar a busca contra o texto mascarado
    transformaria o campo num oráculo: digitar "cobrança do CNPJ 12.345" e ver
    a linha aparecer confirma o conteúdo que a máscara existe para esconder.
    O filtro por assunto vale só onde o conteúdo é visível.

    Para usuário interno isso não muda nada — `is_content_visible_to` já lhe
    devolve True em tudo que ele enxerga (o acesso é permitido e registrado,
    não negado). A regra morde no PORTAL, onde um colega de empresa lista o
    ticket restrito de outro em forma mascarada.
    """
    por_referencia = Q(reference__icontains=term)
    # `unaccent` (extensão criada em tickets/0024): quem digita "acentuacao"
    # encontra "acentuação" — sem isso o resultado vazio lê como "não existe".
    # Só no assunto: referência é código, nunca tem acento.
    # O PEDIDO segue a regra do assunto, não a da referência. É tentador
    # tratá-lo como código público — o cliente cita o número do pedido como
    # cita a referência —, mas num ticket de equipe restrita ele é conteúdo:
    # digitar um número e ver a linha aparecer confirmaria que existe um
    # chamado sobre aquele pedido, que é o que a máscara esconde.
    por_pedido = Q(order_number__icontains=term)

    if user.is_internal:
        return por_referencia | por_pedido | Q(subject__unaccent__icontains=term)

    conteudo_visivel = ~Q(
        team__visibility=TeamVisibility.REQUESTER_ONLY
    ) | Q(requester=user)
    return por_referencia | (
        (Q(subject__unaccent__icontains=term) | por_pedido) & conteudo_visivel
    )


def _aplicar_filtros(qs, params, user, *, exceto=frozenset()):
    """Os filtros de `TicketViewSet.list()`, fatorados para dar pra pedir
    "todos menos um" — é exatamente o que uma FACETA precisa (`facets()`,
    GAPS.md: "contagem por status/prioridade/empresa/responsável"): para
    contar quantos tickets tem cada valor de PRIORIDADE, os outros filtros
    (status, equipe, busca...) continuam valendo — só a prioridade em si
    fica de fora, senão a faceta ficaria presa no valor já escolhido e
    toda opção que não fosse a atual sempre daria zero.

    Mesma ordem e mesmo comportamento de antes (só extraído do corpo de
    `list()`): nenhum teste de filtro devia notar a diferença.
    """
    # Aceita LISTA ("new,open"), não só um valor. O portal precisa de
    # "aguardando o suporte", que é `new` OU `open` — dois estados do modelo
    # para uma coisa só do ponto de vista de quem espera resposta. A
    # alternativa seria a tela somar dois `count` e filtrar duas listas, e aí
    # o contador e a lista teriam duas fontes para discordar.
    if "status" not in exceto and (status_filter := params.get("status")):
        valores = [s for s in status_filter.split(",") if s]
        qs = qs.filter(status__in=valores) if len(valores) > 1 else qs.filter(status=valores[0])
    if "team" not in exceto and (dept := params.get("team")):
        qs = qs.filter(team__slug=dept)
    # Achado na Fase 2, etapa 2 (Empresas): faltava um jeito de listar os
    # chamados de uma empresa — a tela de detalhe da empresa precisa disso
    # e não existia filtro nenhum (GAPS.md).
    if "company" not in exceto and (company_id := params.get("company")):
        qs = qs.filter(company_id=company_id)
    # LISTA também, pelo mesmo motivo do status: "Alta ou Urgente" é o
    # recorte que a fila mais pede ("o que pega fogo"), e são dois valores.
    if "priority" not in exceto and (priority := params.get("priority")):
        valores = [p for p in priority.split(",") if p]
        if len(valores) > 1:
            qs = qs.filter(priority__in=valores)
        elif valores:
            qs = qs.filter(priority=valores[0])
    # "Outros tickets desta pessoa" (painel do cliente no detalhe) e o link
    # "Ver todos" que leva para a fila recortada. Só número: o recorte é
    # SOBRE o escopo que `visible_tickets` já aplicou, então pedir o id de
    # alguém de outra empresa devolve vazio, não os chamados dela.
    if "requester" not in exceto and (solicitante := params.get("requester")):
        if solicitante.isdigit():
            qs = qs.filter(requester_id=int(solicitante))
    if "tag" not in exceto and (tag := params.get("tag")):
        qs = qs.filter(tags__slug=tag)

    # Plano é da EMPRESA, não do ticket — o filtro atravessa a relação. Serve
    # à barra lateral "por plano", que é como quem atende separa o que tem
    # SLA curto do que não tem. Não há ramo "sem plano" porque
    # `Company.plan` é NOT NULL: empresa sem plano não existe no banco (ver
    # test_visao_geral.test_toda_empresa_tem_plano, que quebra no dia em que
    # isso mudar).
    if "plan" not in exceto and (plan := params.get("plan")):
        qs = qs.filter(company__plan__slug=plan)

    # Empresa sem NENHUM domínio de e-mail cadastrado. É a fila do trabalho de
    # cadastro: sem domínio, e-mail que chega dessa empresa não se liga a ela
    # sozinho (ver customers.services.domain_linking) e alguém tem de casar na
    # mão. Aparece na barra lateral para não virar dívida invisível.
    if "sem_dominio" not in exceto and params.get("sem_dominio") in ("1", "true"):
        qs = qs.filter(company__domains__isnull=True)

    # atribuição: as duas visões que um agente realmente usa são "minha
    # fila" e "sem responsável" — o resto é filtro por pessoa
    if "assignee" not in exceto and (assignee := params.get("assignee")):
        if assignee == "me":
            qs = qs.filter(assignee=user)
        elif assignee == "unassigned":
            qs = qs.filter(assignee__isnull=True)
        elif assignee.isdigit():
            qs = qs.filter(assignee_id=int(assignee))

    if "q" not in exceto and (term := params.get("q")):
        qs = qs.filter(_busca_q(user, term))

    if "source" not in exceto and (source := params.get("source")):
        qs = qs.filter(source=source)

    # Agrupamento por pedido: filtro EXATO, diferente do `?q=` que é parcial.
    # É o que faz "ver os outros chamados deste pedido" devolver o pedido
    # 100 sem trazer 1001 e 2100 junto.
    if "order_number" not in exceto and (pedido := params.get("order_number")):
        qs = qs.filter(order_number__iexact=pedido)

    # RESOLVIDO vs FECHADO. Os dois são `status=closed` — a diferença é se
    # ainda dá para reabrir, e isso o dado já responde: fechamento
    # AUTOMÁTICO (por falta de resposta) não reabre; o `add_reply` recusa
    # com todas as letras. Fechamento normal reabre respondendo.
    #
    # Por isso não há stage novo aqui: inventar um "Resolvido" ao lado de
    # "Fechado" criaria uma coluna no quadro do agente e uma decisão a mais
    # em cada fechamento, para descrever algo que o sistema já sabe.
    if "resolucao" not in exceto and (resolucao := params.get("resolucao")):
        if resolucao == "resolvido":
            qs = qs.filter(status=TicketStatus.CLOSED, auto_closed=False)
        elif resolucao == "fechado":
            qs = qs.filter(status=TicketStatus.CLOSED, auto_closed=True)

    if "category" not in exceto and (categoria := params.get("category")):
        qs = qs.filter(category_id=categoria)

    # Avaliado ou não. A tela de Avaliações do portal precisa dos dois lados,
    # e nenhum dos dois pode ser feito filtrando a lista no cliente: ela vem
    # paginada, e o que ficou fora da página nunca apareceria.
    # `nao` implica fechado — chamado em andamento não está esperando nota.
    if "avaliacao" not in exceto and (avaliacao := params.get("avaliacao")):
        if avaliacao == "sim":
            qs = qs.filter(survey__score__isnull=False)
        elif avaliacao == "nao":
            qs = qs.filter(status=TicketStatus.CLOSED).exclude(survey__score__isnull=False)

    # Recorte por data de ABERTURA (não de atualização): é a data que a
    # pessoa lembra — "o chamado que abri em março".
    if "desde" not in exceto and (desde := params.get("desde")):
        qs = qs.filter(created_at__date__gte=desde)
    if "ate" not in exceto and (ate := params.get("ate")):
        qs = qs.filter(created_at__date__lte=ate)
    # Período RELATIVO ("últimos 7 dias"): `desde` guardado numa visão
    # pessoal congelaria a data do dia em que a visão foi salva — daqui a um
    # mês "últimos 7 dias" mostraria 37. Conta em dias de calendário, com
    # hoje incluso, igual a `desde`/`ate` (que também comparam a data).
    if "periodo" not in exceto and (periodo := params.get("periodo")):
        dias = PERIODOS_RELATIVOS.get(periodo)
        if dias is not None:
            inicio = timezone.localdate() - dt.timedelta(days=dias - 1)
            qs = qs.filter(created_at__date__gte=inicio)

    # As visões da barra lateral são recortes NOMEADOS, não filtros soltos: a
    # definição mora aqui, no servidor, para "Tickets sem atendimento" querer
    # dizer a mesma coisa na tela, no relatório e amanhã.
    if "view" not in exceto and (view := params.get("view")):
        qs = _apply_saved_view(qs, view, user)

    if "sla" not in exceto and (sla := params.get("sla")):
        now = timezone.now()
        pending_first = Q(first_response_at__isnull=True)
        unresolved = ~Q(status=TicketStatus.CLOSED)
        if sla == "breached":
            qs = qs.filter(
                (pending_first & Q(sla_first_response_due_at__lt=now))
                | (unresolved & Q(sla_resolution_due_at__lt=now)),
            )
        elif sla == "at_risk":
            soon = now + dt.timedelta(minutes=SLA_AT_RISK_MINUTES)
            qs = qs.filter(
                (pending_first & Q(sla_first_response_due_at__range=(now, soon)))
                | (unresolved & Q(sla_resolution_due_at__range=(now, soon))),
            )

    return qs


class AttachmentScanPending(APIException):
    """409: ainda em varredura. É estado transitório — cabe tentar de novo."""

    status_code = http.HTTP_409_CONFLICT
    default_code = "attachment_scan_pending"
    default_detail = (
        "Anexo em verificação antivírus. Tente novamente em alguns instantes."
    )


class AttachmentQuarantined(APIException):
    """403: a varredura não liberou. Não é falta de permissão do usuário — é o
    arquivo que está barrado —, mas o efeito prático é o mesmo: não sai daqui."""

    status_code = http.HTTP_403_FORBIDDEN
    default_code = "attachment_quarantined"
    default_detail = "Anexo bloqueado pela verificação antivírus."


class AttachmentPurged(APIException):
    """410: o arquivo foi expurgado (retenção D18 ou anonimização LGPD D11).

    Gone, não Not Found: o anexo existiu e a linha continua no histórico — o
    que sumiu foi o conteúdo, e isso é a resposta honesta.
    """

    status_code = http.HTTP_410_GONE
    default_code = "attachment_purged"
    default_detail = "Este anexo foi removido pela política de retenção de dados."


def _quarantine_error(attachment) -> APIException:
    if attachment.is_purged:
        return AttachmentPurged()
    if attachment.scan_status == ScanStatus.PENDING:
        return AttachmentScanPending()
    if attachment.scan_status == ScanStatus.INFECTED:
        return AttachmentQuarantined()
    return AttachmentQuarantined(
        "Não foi possível verificar este anexo; o download fica bloqueado até "
        "que a verificação conclua."
    )


@extend_schema(
    responses={(200, "application/octet-stream"): OpenApiTypes.BINARY},
    description="Download autenticado de anexo (D13), sujeito à quarentena (D19).",
)
class AttachmentDownloadView(APIView):
    """D13: o único caminho até o arquivo.

    Reavalia a permissão a cada download — um anexo de ticket restrito não é
    acessível por quem não pode ler o ticket, mesmo com o id em mãos — e grava
    TicketAccessLog quando a equipe é restrita, inclusive na negativa.
    """

    def get(self, request, pk):
        attachment = (
            TicketAttachment.objects
            .select_related("message__ticket__team", "message__ticket__company")
            .filter(pk=pk)
            .first()
        )
        if attachment is None:
            raise NotFound

        ticket = attachment.message.ticket
        # o escopo de listagem vem primeiro: fora dele, o ticket não existe
        if not selectors.visible_tickets(request.user).filter(pk=ticket.pk).exists():
            raise NotFound

        allowed = ticket.is_content_visible_to(request.user)
        # nota interna nunca vaza anexo para o cliente
        if not attachment.message.is_public and not request.user.is_internal:
            allowed = False

        if ticket.is_restricted():
            record_ticket_access(
                ticket=ticket, user=request.user, context="attachment",
                granted=allowed, request=request,
            )
        if not allowed:
            raise PermissionDenied("Sem acesso ao conteúdo deste ticket.")

        # D19 — quarentena. Vem DEPOIS da permissão de propósito: quem não pode
        # ver o ticket recebe 404 e não descobre nem que o anexo existe. Inverter
        # a ordem transformaria o status da varredura num oráculo de existência.
        if not attachment.is_downloadable:
            raise _quarantine_error(attachment)

        try:
            handle = attachment.file.open("rb")
        except FileNotFoundError as exc:
            raise Http404("Arquivo indisponível.") from exc

        response = FileResponse(handle, content_type=attachment.content_type)
        # nome do arquivo é dado do usuário: interpolá-lo cru deixa uma aspa no
        # nome quebrar o quoting do header. content_disposition_header escapa e
        # emite o filename*=UTF-8'' para nomes não-ASCII.
        response["Content-Disposition"] = content_disposition_header(
            as_attachment=True, filename=attachment.filename
        )
        response["X-Content-Type-Options"] = "nosniff"
        return response
