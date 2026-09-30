"""Kanban — visão de gestão sobre tickets.

O quadro NÃO é uma lista de cards que alguém montou: ele mostra os mesmos
tickets da fila de NÃO RESOLVIDOS, cada um na coluna do seu STATUS
(`tickets.TicketStage`). Quem abre o quadro vê a operação em andamento, sem
precisar "adicionar" nada — e chamado fechado sai do quadro como sai da fila.

Existem DUAS espécies de coluna, e a diferença é o contrato com o ticket:

- **Coluna de status** — é um `TicketStage`. Arrastar para cá MUDA o status
  do chamado. Não é configurável aqui: status se administra em Configurações.
- **Coluna de organização** (`BoardLane`) — é do quadro, criada pelo "+", e é
  SÓ visual: arrastar para cá fixa o chamado ali para a equipe se organizar
  ("Depende do gestor", "Sprint desta semana"), sem tocar no status. O SLA, a
  fila e o cliente continuam vendo o status verdadeiro.

O pedido do negócio foi explícito: a coluna personalizada não é para mudar o
status — é visualização. Por isso a lane vive aqui no kanban e o status vive
em tickets: são coisas de natureza diferente, e já quebramos este quadro duas
vezes por tratá-las como uma só.

Daí o papel do `Card`: ele guarda o que o status não sabe responder — o prazo
interno e a fixação numa lane. Sem nenhum dos dois, a linha nem existe.

Card referencia ticket (FK), nunca é o mesmo registro (docs/05 §3.1): apagar
card, lane ou quadro não toca no ticket.
"""

from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.tickets.models import TicketStatus


class Board(TimeStampedModel):
    name = models.CharField(max_length=80)
    slug = models.SlugField(unique=True)
    # O quadro pode ser de uma equipe (recorta os tickets dela) ou geral.
    # Antes da fusão havia `team` E `team` aqui: só o primeiro recortava
    # o quadro, o segundo era rótulo sem efeito. Restou um.
    team = models.ForeignKey(
        "accounts.Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="boards",
    )
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_boards",
    )

    class Meta:
        verbose_name = "quadro"

    def __str__(self):
        return self.name


class BoardLane(models.Model):
    """Coluna de ORGANIZAÇÃO do quadro — visual, nunca de status.

    Fica depois das colunas de status, e o chamado fixado nela permanece com o
    status que tem. É deliberadamente rasa: nome, ordem e limite de WIP. Cor,
    contrato com o SLA e visibilidade para o cliente são assuntos de STATUS, e
    status mora em `tickets.TicketStage`.
    """

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="lanes")
    name = models.CharField(max_length=60)
    order = models.PositiveSmallIntegerField(default=0)
    # Limite de trabalho em andamento. É AVISO, não trava: passar do limite
    # pinta o cabeçalho da coluna, mas o arraste continua aceito — travar
    # o move no meio de um atendimento só empurraria o chamado para a coluna
    # errada. Nulo = sem limite.
    wip_limit = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1)],
        help_text="Limite de tickets na coluna (aviso, não bloqueia).",
    )

    class Meta:
        verbose_name = "coluna de organização"
        verbose_name_plural = "colunas de organização"
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["board", "name"], name="uniq_lane_name_per_board"),
            models.CheckConstraint(
                condition=models.Q(wip_limit__isnull=True) | models.Q(wip_limit__gte=1),
                name="lane_wip_limit_positivo",
            ),
        ]

    def __str__(self):
        return f"{self.board.name} / {self.name}"


class BoardStageLimit(models.Model):
    """Limite de WIP de uma coluna de STATUS, neste quadro.

    A coluna de status não é do quadro — é `tickets.TicketStage`, global e
    administrada em Configurações —, então o limite não pode morar nela: o
    mesmo "Aberto" aparece no quadro do Suporte e no do Financeiro, e a
    capacidade de cada equipe é outra. O limite é um acordo de trabalho de
    QUEM OLHA o quadro, e por isso é do quadro. A lane, que já é do quadro,
    guarda o dela direto (`BoardLane.wip_limit`).

    Sem linha = sem limite: tirar o limite apaga o registro.
    """

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="stage_limits")
    # CASCADE: status apagado leva o limite junto — não há coluna para limitar
    stage = models.ForeignKey(
        "tickets.TicketStage", on_delete=models.CASCADE, related_name="board_limits"
    )
    wip_limit = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])

    class Meta:
        verbose_name = "limite de coluna de status"
        verbose_name_plural = "limites de coluna de status"
        constraints = [
            models.UniqueConstraint(fields=["board", "stage"], name="uniq_stage_limit_per_board"),
            models.CheckConstraint(
                condition=models.Q(wip_limit__gte=1), name="stage_wip_limit_positivo"
            ),
        ]

    def __str__(self):
        return f"{self.board.name} / {self.stage.name}: {self.wip_limit}"


class Card(TimeStampedModel):
    """O que o quadro sabe sobre um ticket além do status. Ver o topo do módulo."""

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="cards")
    ticket = models.ForeignKey(
        "tickets.Ticket", on_delete=models.CASCADE, related_name="cards"
    )
    # fixação numa coluna de organização; nula = o chamado segue o status.
    # SET_NULL: apagar a lane solta os chamados de volta às colunas de status,
    # nunca some com eles.
    lane = models.ForeignKey(
        BoardLane, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="cards",
    )
    due_at = models.DateTimeField(
        null=True, blank=True, help_text="Data de resposta prevista (prazo interno, não SLA)."
    )
    added_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="added_cards"
    )

    class Meta:
        verbose_name = "card"
        constraints = [
            models.UniqueConstraint(fields=["board", "ticket"], name="uniq_ticket_per_board")
        ]
        indexes = [models.Index(fields=["board", "ticket"])]

    def __str__(self):
        return f"{self.ticket_id} em {self.board.name}"

    @property
    def is_overdue(self) -> bool:
        """Prazo interno vencido — e ainda importando.

        Quem diz se ainda importa é o STATUS do ticket, não a coluna: ticket
        fechado não está atrasado, esteja o quadro como estiver."""
        if not self.due_at or self.due_at >= timezone.now():
            return False
        return self.ticket.status != TicketStatus.CLOSED
