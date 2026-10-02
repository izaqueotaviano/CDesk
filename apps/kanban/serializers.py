"""Serializers do kanban.

O quadro em si não tem serializer de saída: `services/board_view.py` monta os
dicionários direto dos tickets. Coluna de STATUS também não tem serializer
aqui — ela é `tickets.TicketStage`, administrada em `settings/statuses/`.

O que se serializa aqui é o que é DO quadro: o quadro e as colunas de
organização (lanes).
"""

from rest_framework import serializers

from apps.kanban.models import Board, BoardLane


class BoardSerializer(serializers.ModelSerializer):
    team_slug = serializers.SlugField(
        source="team.slug", read_only=True, default=None
    )
    # o slug é identidade de URL: gerado do nome na criação (view) e estável
    # depois — renomear o quadro não muda o link de quem o guardou.
    slug = serializers.SlugField(required=False)

    class Meta:
        model = Board
        fields = ["id", "name", "slug", "team", "team_slug", "is_active"]


class BoardLaneSerializer(serializers.ModelSerializer):
    class Meta:
        model = BoardLane
        fields = ["id", "board", "name", "order", "wip_limit"]


class PlaceSerializer(serializers.Serializer):
    """Arrastar ou "mover para": este ticket, nesta coluna.

    `stage_id` muda o status; `lane_id` só fixa (organização visual).
    Exatamente um dos dois — a view valida.
    """

    ticket_id = serializers.IntegerField()
    stage_id = serializers.IntegerField(required=False, allow_null=True)
    lane_id = serializers.IntegerField(required=False, allow_null=True)


class EntryUpdateSerializer(serializers.Serializer):
    """O que o quadro guarda por ticket: prazo interno e proprietário."""

    due_at = serializers.DateTimeField(required=False, allow_null=True)
    owner_id = serializers.IntegerField(required=False, allow_null=True)


class ColumnLimitSerializer(serializers.Serializer):
    """Limite de WIP de uma coluna. `null` tira o limite.

    Obrigatório (não `required=False`): um PATCH vazio não pode ser lido como
    "tirar o limite" por omissão. O teto de 999 é só sanidade: um limite que
    nenhuma coluna alcança é o mesmo que não ter limite.
    """

    wip_limit = serializers.IntegerField(min_value=1, max_value=999, allow_null=True)
