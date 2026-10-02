"""Visualizações pessoais da fila (`/api/v1/ticket-views/`).

Módulo próprio, e não mais uma seção de views.py/serializers.py, por causa
da dependência: a validação dos filtros precisa das allowlists que moram em
views.py (`SAVED_VIEWS`, `ALLOWED_ORDERING`, `PERIODOS_RELATIVOS`) e a
contagem precisa de `_aplicar_filtros` — e views.py já importa de
serializers.py. Aqui as duas coisas se encontram sem import circular.

Escopo: TUDO parte de `SavedTicketView.objects.filter(owner=request.user)`.
Visão de outra pessoa não existe para você — nem para ler, nem para editar,
nem para apagar (404, não 403: um 403 confirmaria que o id existe).
"""

import datetime as dt
import re

from django.db import transaction
from django.db.models import Max
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.permissions import IsInternal
from apps.tickets import selectors
from apps.tickets.models import SavedTicketView, TicketPriority, TicketStatus
from apps.tickets.views import (
    ALLOWED_ORDERING,
    PERIODOS_RELATIVOS,
    SAVED_VIEWS,
    _aplicar_filtros,
)

# Teto por pessoa. Não é regra de negócio, é o limite em que a barra
# lateral deixa de ser uma lista e vira um lugar onde as coisas se perdem —
# e cada visão custa uma contagem a cada abertura da fila.
MAX_VISOES_POR_PESSOA = 30

_SLUG = re.compile(r"^[-a-zA-Z0-9_]{1,80}$")
_INTEIRO = re.compile(r"^\d{1,12}$")


def _lista_de(valor: str, permitidos, rotulo: str) -> str:
    itens = [v for v in valor.split(",") if v]
    invalidos = [v for v in itens if v not in permitidos]
    if not itens or invalidos:
        raise ValidationError(f"{rotulo} inválido: {', '.join(invalidos) or valor!r}.")
    return ",".join(dict.fromkeys(itens))  # sem repetidos, na ordem dada


def _data(valor: str, rotulo: str) -> str:
    try:
        dt.date.fromisoformat(valor)
    except ValueError as exc:
        raise ValidationError(f"{rotulo}: use AAAA-MM-DD.") from exc
    return valor


def _ordenacao(valor: str) -> str:
    if valor.lstrip("-") not in ALLOWED_ORDERING:
        raise ValidationError(f"Ordenação desconhecida: {valor!r}.")
    return valor


def _responsavel(valor: str) -> str:
    if valor in ("me", "unassigned") or _INTEIRO.match(valor):
        return valor
    raise ValidationError("Responsável: 'me', 'unassigned' ou o id do agente.")


def _slug(rotulo):
    def validar(valor: str) -> str:
        if not _SLUG.match(valor):
            raise ValidationError(f"{rotulo} inválida: {valor!r}.")
        return valor
    return validar


def _inteiro(rotulo):
    def validar(valor: str) -> str:
        if not _INTEIRO.match(valor):
            raise ValidationError(f"{rotulo}: informe o id.")
        return valor
    return validar


def _um_de(permitidos, rotulo):
    def validar(valor: str) -> str:
        if valor not in permitidos:
            raise ValidationError(f"{rotulo} inválido: {valor!r}.")
        return valor
    return validar


def _texto(valor: str) -> str:
    if len(valor) > 200:
        raise ValidationError("Busca: no máximo 200 caracteres.")
    return valor


# A allowlist: cada chave é um parâmetro que `GET /tickets/` entende, com a
# checagem do domínio dela. É a mesma lista que a barra de filtros da fila
# escreve na URL (resolv/tickets/filtros.ts) — chave nova lá precisa entrar
# aqui, senão "Salvar como visão" recusa com 400 em vez de guardar um filtro
# que o servidor não saberia reaplicar.
VALIDADORES = {
    "view": _um_de(SAVED_VIEWS, "Visão"),
    "status": lambda v: _lista_de(v, TicketStatus.values, "Status"),
    "priority": lambda v: _lista_de(v, TicketPriority.values, "Prioridade"),
    "assignee": _responsavel,
    "team": _slug("Equipe"),
    "company": _inteiro("Empresa"),
    "category": _inteiro("Categoria"),
    "tag": _slug("Etiqueta"),
    "sla": _um_de(("at_risk", "breached"), "SLA"),
    "periodo": _um_de(tuple(PERIODOS_RELATIVOS), "Período"),
    "desde": lambda v: _data(v, "Desde"),
    "ate": lambda v: _data(v, "Até"),
    "q": _texto,
    "ordering": _ordenacao,
    # `?requester=` da listagem (o filtro é do backend de tickets; aqui só se
    # valida que a visão guarda um id). Na URL da fila ele é `?solicitante=`.
    "requester": _inteiro("Solicitante"),
}


def validar_filtros(filtros) -> dict:
    """Normaliza e valida o JSON de filtros de uma visão pessoal.

    Chave vazia sai (é "sem esse filtro", não um filtro por texto vazio);
    chave desconhecida ou valor fora do domínio é 400 com o motivo — nunca
    ignorado em silêncio, pelo motivo do docstring de `SavedTicketView`.
    """
    if not isinstance(filtros, dict):
        raise ValidationError("Os filtros precisam ser um objeto {chave: valor}.")
    desconhecidas = sorted(set(filtros) - set(VALIDADORES))
    if desconhecidas:
        raise ValidationError(f"Filtro desconhecido: {', '.join(desconhecidas)}.")
    limpo = {}
    for chave, valor in filtros.items():
        if valor is None:
            continue
        if not isinstance(valor, str):
            raise ValidationError(f"{chave}: o valor precisa ser texto.")
        if not valor.strip():
            continue
        limpo[chave] = VALIDADORES[chave](valor.strip())
    if "desde" in limpo and "ate" in limpo and limpo["desde"] > limpo["ate"]:
        raise ValidationError("O período começa depois de terminar.")
    return limpo


class SavedTicketViewSerializer(serializers.ModelSerializer):
    # Quantos chamados a visão tem AGORA, no escopo de quem pergunta. Só na
    # leitura (a view anota); na escrita é ignorado.
    count = serializers.IntegerField(read_only=True, required=False)

    class Meta:
        model = SavedTicketView
        fields = ["id", "name", "filters", "position", "count", "created_at", "updated_at"]
        read_only_fields = ["id", "position", "count", "created_at", "updated_at"]

    def validate_name(self, valor):
        nome = " ".join(valor.split())
        if not nome:
            raise ValidationError("Dê um nome à visão.")
        dono = self.context["request"].user
        repetida = SavedTicketView.objects.filter(owner=dono, name__iexact=nome)
        if self.instance is not None:
            repetida = repetida.exclude(pk=self.instance.pk)
        if repetida.exists():
            raise ValidationError("Você já tem uma visão com esse nome.")
        return nome

    def validate_filters(self, valor):
        return validar_filtros(valor)


class ReordenarVisoesSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=True)


@extend_schema(tags=["tickets"])
class SavedTicketViewViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    """CRUD das visualizações pessoais de quem está logado.

    Só interno: a fila é do agente; o cliente tem as telas dele no portal.
    Sem paginação — a lista inteira é o contrato (a barra lateral desenha
    todas) e ela tem teto (`MAX_VISOES_POR_PESSOA`).
    """

    serializer_class = SavedTicketViewSerializer
    permission_classes = [IsInternal]
    pagination_class = None

    def get_queryset(self):
        return SavedTicketView.objects.filter(owner=self.request.user)

    def list(self, request):
        visoes = list(self.get_queryset())
        # Uma contagem por visão, no MESMO escopo e com os MESMOS filtros da
        # listagem — é a pergunta "se eu clicar, quantos vêm". Mesmo custo
        # que o `resumo` já paga para as visões do sistema, e com teto.
        base = selectors.visible_tickets(request.user)
        for visao in visoes:
            visao.count = _aplicar_filtros(base, visao.filters, request.user).order_by().count()
        return Response(self.get_serializer(visoes, many=True).data)

    def perform_create(self, serializer):
        dono = self.request.user
        if self.get_queryset().count() >= MAX_VISOES_POR_PESSOA:
            raise ValidationError({
                "detail": (
                    f"Limite de {MAX_VISOES_POR_PESSOA} visões. "
                    "Apague uma antes de criar outra."
                ),
            })
        ultima = self.get_queryset().aggregate(m=Max("position"))["m"]
        serializer.save(owner=dono, position=0 if ultima is None else ultima + 1)

    @extend_schema(
        request=ReordenarVisoesSerializer, responses=SavedTicketViewSerializer(many=True),
    )
    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """Nova ordem da barra lateral: a lista COMPLETA de ids, na ordem
        desejada. Parcial é recusado — reordenar metade deixaria duas visões
        disputando a mesma posição sem ninguém ter pedido."""
        ser = ReordenarVisoesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ids = ser.validated_data["ids"]
        minhas = {v.pk: v for v in self.get_queryset()}
        if len(ids) != len(set(ids)) or set(ids) != set(minhas):
            raise ValidationError({"ids": "Envie todas as suas visões, cada uma uma vez."})
        with transaction.atomic():
            for posicao, pk in enumerate(ids):
                visao = minhas[pk]
                if visao.position != posicao:
                    visao.position = posicao
                    visao.save(update_fields=["position", "updated_at"])
        return Response(self.get_serializer(self.get_queryset(), many=True).data)
