"""API do kanban — área interna (docs/05 §3.5).

O quadro é uma VISTA sobre os tickets não resolvidos: `GET boards/{id}/cards/`
monta as colunas a partir do status de cada ticket visível, sem exigir que
alguém tenha "adicionado" nada. Ver `services/board_view.py`.

O que se manipula aqui é o TICKET dentro do quadro (`place/` o move de coluna,
`entry/` guarda prazo e proprietário) e as colunas de ORGANIZAÇÃO (`lanes`),
que são do quadro e só visuais. A coluna de STATUS se administra em
`settings/statuses/` (tickets/admin_api.py).
"""

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts.models import User
from apps.core.slugs import unique_slug
from apps.kanban import services as kanban_service
from apps.kanban.models import Board, BoardLane, Card
from apps.kanban.serializers import (
    BoardLaneSerializer,
    BoardSerializer,
    EntryUpdateSerializer,
    PlaceSerializer,
)
from apps.kanban.services import CloseDialogRequired, KanbanRuleViolation, board_view
from apps.tickets.models import TicketStage
from apps.tickets.services.ticket_service import TicketRuleViolation, set_owner


class InternalOnlyMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.user.is_authenticated and not request.user.is_internal:
            raise PermissionDenied("Kanban é área interna.")


class AdminWriteMixin(InternalOnlyMixin):
    """Configurar quadro é de admin; USAR o quadro é de qualquer interno.

    `place` e `entry` moram no BoardViewSet por serem operações sobre um
    quadro, mas são trabalho do dia a dia — arrastar um card e anotar um prazo.
    Exigir admin ali travaria a tela para o agente, que é quem mais a usa.
    """

    ACOES_DE_USO = {"cards", "place", "entry"}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if getattr(self, "action", None) in self.ACOES_DE_USO:
            return
        if self.request.method not in ("GET", "HEAD", "OPTIONS") and not (
            request.user.is_authenticated and request.user.is_admin
        ):
            raise PermissionDenied("Apenas administradores configuram quadros.")


class BoardViewSet(AdminWriteMixin, viewsets.ModelViewSet):
    queryset = Board.objects.filter(is_active=True)
    serializer_class = BoardSerializer

    def perform_create(self, serializer):
        # admin cria quadro só com o nome; o slug (identidade de URL) é derivado
        slug = serializer.validated_data.get("slug") or unique_slug(
            Board, serializer.validated_data["name"], fallback="quadro"
        )
        serializer.save(created_by=self.request.user, slug=slug)
        # não há colunas para criar: as de status são do sistema, e as de
        # organização nascem no próprio quadro, quando alguém precisar

    def perform_destroy(self, instance):
        # quadro é visão descartável: leva as próprias anotações e lanes,
        # nunca os tickets
        instance.cards.all().delete()
        instance.delete()

    def _board(self):
        return self.get_object()

    @action(detail=True, methods=["get"])
    def cards(self, request, pk=None):
        """O quadro montado: um request carrega colunas e cartões."""
        agrupar = request.query_params.get("agrupar", "status")
        return Response(board_view.entries(self._board(), request.user, agrupar))

    @action(detail=True, methods=["post"])
    def place(self, request, pk=None):
        """Põe um ticket numa coluna — arrastar ou "mover para" do menu."""
        board = self._board()
        ser = PlaceSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        stage = lane = None
        if data.get("stage_id"):
            stage = TicketStage.objects.filter(
                pk=data["stage_id"], is_active=True
            ).first()
            if stage is None:
                raise ValidationError({"stage_id": "Status não encontrado."})
        elif data.get("lane_id"):
            lane = BoardLane.objects.filter(pk=data["lane_id"], board=board).first()
            if lane is None:
                raise ValidationError({"lane_id": "Coluna não encontrada neste quadro."})
        else:
            raise ValidationError({"detail": "Informe stage_id ou lane_id."})

        ticket = board_view.visible_ticket(board, request.user, data["ticket_id"])
        if ticket is None:
            raise NotFound  # fora do escopo: não existe para este usuário

        try:
            kanban_service.place(
                board=board, ticket=ticket, actor=request.user,
                stage=stage, lane=lane,
            )
        except CloseDialogRequired as exc:
            return Response(
                {"detail": str(exc), "code": "close_dialog_required"}, status=409
            )
        except KanbanRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc
        except TicketRuleViolation as exc:
            raise ValidationError({"detail": str(exc)}) from exc

        agrupar = request.query_params.get("agrupar", "status")
        return Response(board_view.entries(board, request.user, agrupar))

    @action(detail=True, methods=["patch"],
            url_path=r"entry/(?P<ticket_id>\d+)")
    def entry(self, request, pk=None, ticket_id=None):
        """PATCH: prazo e proprietário."""
        board = self._board()
        ticket = board_view.visible_ticket(board, request.user, ticket_id)
        if ticket is None:
            raise NotFound

        ser = EntryUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        if "due_at" in data:
            kanban_service.set_due(
                board=board, ticket=ticket, due_at=data["due_at"], actor=request.user
            )
        if "owner_id" in data:
            # owner mora no TICKET; o quadro é só a superfície de edição —
            # mesmo service que a tela do Chamado usa (set-owner/), pra
            # sempre gravar o histórico (TicketStatusEvent) e notificar o
            # novo dono, nunca um save() cru que pula os dois
            owner = None
            if data["owner_id"] is not None:
                owner = User.objects.filter(
                    pk=data["owner_id"], is_active=True, kind="internal"
                ).first()
                if owner is None:
                    raise ValidationError({"owner_id": "Usuário interno não encontrado."})
            try:
                set_owner(ticket=ticket, owner=owner, actor=request.user)
            except TicketRuleViolation as exc:
                raise ValidationError({"detail": str(exc)}) from exc

        agrupar = request.query_params.get("agrupar", "status")
        return Response(board_view.entries(board, request.user, agrupar))


class BoardLaneViewSet(InternalOnlyMixin, viewsets.ModelViewSet):
    """Colunas de ORGANIZAÇÃO — qualquer interno cria e mexe.

    Sem trava de admin de propósito: a lane não toca em ticket nenhum (é
    fixação visual), então o custo de errar é zero e o ganho é a equipe se
    organizar sem pedir permissão. Configuração que muda semântica — status —
    continua atrás de admin, em `settings/statuses/`.
    """

    queryset = BoardLane.objects.select_related("board")
    serializer_class = BoardLaneSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        if board_id := self.request.query_params.get("board"):
            qs = qs.filter(board_id=board_id)
        return qs

    def perform_create(self, serializer):
        board = serializer.validated_data["board"]
        ultimo = board.lanes.order_by("-order").first()
        serializer.save(order=(ultimo.order + 1) if ultimo else 0)

    def perform_destroy(self, instance):
        # Card.lane é SET_NULL — apagar a lane solta os chamados de volta às
        # colunas de status, nenhum some. Mas um Card só existe enquanto
        # guarda prazo OU fixação (ver o docstring do model): um que só
        # tinha a fixação (sem due_at) fica órfão depois do SET_NULL, com os
        # dois campos vazios — mesma faxina que _soltar() já faz quando o
        # solto é pelo place() (services/__init__.py), só que ali passando
        # por um card de cada vez; aqui é a lane inteira de uma vez.
        Card.objects.filter(lane=instance, due_at__isnull=True).delete()
        instance.delete()
