"""Monta o quadro a partir dos TICKETS, não de uma lista de cards.

**O escopo é a fila de não resolvidos** — o MESMO recorte de
`/app/tickets?view=nao-resolvidos`, pelo mesmo `visible_tickets(user)`. Foi o
pedido: o quadro é a fila em andamento vista por coluna. Chamado fechado sai
do quadro como sai daquela fila.

As colunas de conclusão EXISTEM mesmo assim, e ficam sempre vazias: elas são
o destino do arraste que fecha o chamado (a tela pede a janela de solução do
D4 e o chamado então deixa o quadro). Sem elas, concluir pelo quadro era
impossível — não havia onde soltar — e o gesto mais natural do kanban não
tinha resposta.

Duas espécies de coluna, dois contratos:

- **Status** (`TicketStage`): arrastar para cá muda o status do chamado.
- **Organização** (`BoardLane`, criada pelo "+" do quadro): arrastar para cá
  FIXA o chamado ali sem tocar no status — é visual, para a equipe se
  organizar. O chamado fixado carrega o status verdadeiro consigo; SLA, fila
  e cliente não percebem a fixação.

**Agrupamento.** Status é o padrão. Prioridade e responsável são a MESMA fila
vista por outro eixo — nenhum chamado entra ou sai, só troca de coluna. As
lanes só aparecem no eixo de status (fixação não faz sentido nos derivados), e
todo agrupamento fabrica um grupo para o "sem valor" (sem responsável) para
que nada suma por não ter o campo preenchido.
"""

from django.db.models import Count, Q

from apps.accounts.models import User, UserKind
from apps.tickets import selectors
from apps.tickets.models import TicketPriority, TicketStage, TicketStatus
from apps.tickets.serializers import MASKED_REQUESTER, _sla_clock

# os eixos que o menu "Agrupar" oferece
AGRUPAMENTOS = ("status", "priority", "assignee")

# prefixo das chaves de lane: a chave de coluna é string e convive com pks de
# stage no mesmo espaço — sem o prefixo, lane 3 e stage 3 colidiriam
LANE = "lane-"


def _entry(ticket, column_key, card, user) -> dict:
    visible = ticket.is_content_visible_to(user)
    masked = not visible and ticket.team.mask_subject_for_others
    return {
        "ticket": ticket.pk,
        "ticket_reference": ticket.reference,
        "ticket_status": ticket.status,
        "stage": ticket.stage_id,
        "priority": ticket.priority,
        "subject": (
            f"Ticket de {ticket.team.name} (acesso restrito)"
            if masked else ticket.subject
        ),
        "requester_display": (
            ticket.requester.full_name if visible else MASKED_REQUESTER
        ),
        "company_name": ticket.company.name,
        "team_name": ticket.team.name,
        "owner_id": ticket.owner_id,
        "owner_name": ticket.owner.full_name if ticket.owner else None,
        "assignee_id": ticket.assignee_id,
        "assignee_name": ticket.assignee.full_name if ticket.assignee else None,
        "assignee_avatar": (
            (ticket.assignee.avatar_url or None) if ticket.assignee else None
        ),
        # O quadro é onde se escolhe o próximo chamado, e até aqui ele não
        # mostrava o dado que decide essa escolha: o relógio do SLA morava só
        # na fila, na tela ao lado. Vem do MESMO `_sla_clock` do serializer da
        # listagem — dois cálculos de prazo seriam duas verdades.
        "sla": {
            "first_response": _sla_clock(
                due_at=ticket.sla_first_response_due_at,
                breached=ticket.sla_first_response_breached,
                met=ticket.first_response_at is not None,
            ),
            "resolution": _sla_clock(
                due_at=ticket.sla_resolution_due_at,
                breached=ticket.sla_resolution_breached,
                met=ticket.status == TicketStatus.CLOSED,
            ),
        },
        "column": column_key,
        "message_count": ticket.message_count,
        "attachment_count": ticket.attachment_count,
        "due_at": card.due_at if card else None,
        "is_overdue": bool(card and card.is_overdue),
        "created_at": ticket.created_at,
    }


def _colunas_por_status(board):
    """Colunas de status e, ao fim, as colunas de organização deste quadro.

    As de CONCLUSÃO entram — mas só como destino. O quadro continua sendo a
    fila do que não está resolvido (`entries` exclui os fechados), então elas
    ficam vazias por definição; o que elas ganham é poder receber um arraste.
    Sem elas o quadro não tinha para onde concluir um chamado: arrastar era o
    gesto natural e simplesmente não havia coluna, o que lia como "mudar de
    coluna não funciona". `concludes` avisa a tela para explicar a coluna vazia
    em vez de deixá-la parecendo quebrada.
    """
    stages = TicketStage.objects.filter(is_active=True).order_by("order", "id")
    # limite de WIP: o do status é deste quadro (BoardStageLimit), o da lane
    # mora nela. A tela só lê `wip_limit`, sem saber de onde veio.
    limites = dict(board.stage_limits.values_list("stage_id", "wip_limit"))
    colunas = [
        {
            "key": str(s.pk), "name": s.name, "color": s.color,
            "category": s.category, "kind": "stage",
            "stage": s.pk, "lane": None,
            "concludes": s.category == TicketStatus.CLOSED,
            "wip_limit": limites.get(s.pk),
        }
        for s in stages
    ]
    colunas += [
        {
            "key": f"{LANE}{lane.pk}", "name": lane.name, "color": "#8A8A85",
            "category": None, "kind": "lane",
            "stage": None, "lane": lane.pk, "concludes": False,
            "wip_limit": lane.wip_limit,
        }
        for lane in board.lanes.all()
    ]
    return colunas


def _colunas_por_prioridade():
    # da mais urgente para a menos: no quadro, a coluna da esquerda é a que se
    # olha primeiro
    cores = {"urgent": "#C0392B", "high": "#E74C3C",
             "normal": "#5A87B8", "low": "#8A8A85"}
    return [
        {"key": valor, "name": rotulo, "color": cores.get(valor, "#8A8A85"),
         "category": None, "kind": "priority", "stage": None, "lane": None,
         "concludes": False, "wip_limit": None}
        for valor, rotulo in TicketPriority.choices
    ]


def _colunas_por_responsavel(scope):
    """Uma coluna por agente COM chamado no recorte, mais "Sem responsável".

    Só quem tem chamado aqui: listar a agência inteira encheria o quadro de
    colunas vazias e faria a rolagem horizontal perder o sentido.
    """
    ids = [i for i in scope.values_list("assignee_id", flat=True).distinct() if i]
    agentes = User.objects.filter(pk__in=ids, kind=UserKind.INTERNAL).order_by("full_name")
    colunas = [
        {"key": str(a.pk), "name": a.full_name, "color": "#5A87B8",
         "category": None, "kind": "assignee", "stage": None, "lane": None,
         "concludes": False, "wip_limit": None}
        for a in agentes
    ]
    colunas.append({
        "key": "none", "name": "Sem responsável", "color": "#8A8A85",
        "category": None, "kind": "assignee", "stage": None, "lane": None,
        "concludes": False, "wip_limit": None,
    })
    return colunas


def _chave_do_ticket(ticket, card, agrupar):
    if agrupar == "priority":
        return ticket.priority
    if agrupar == "assignee":
        return str(ticket.assignee_id) if ticket.assignee_id else "none"
    # eixo de status: a fixação numa lane vence — é para isso que ela existe.
    # Sem fixação, a coluna é o status do chamado.
    if card is not None and card.lane_id:
        return f"{LANE}{card.lane_id}"
    return str(ticket.stage_id) if ticket.stage_id else None


def entries(board, user, agrupar: str = "status") -> dict:
    """`{"columns": [...], "entries": [...]}`.

    As COLUNAS voltam junto de propósito. A tela desenhava as colunas com o que
    vinha da LISTA de quadros e os cards com o que vinha daqui: duas respostas,
    dois instantes, e a chance de discordarem. Quando discordavam, a entrada
    apontava para uma coluna que a tela não tinha e o chamado sumia calado.

    Uma resposta só, uma verdade só.
    """
    if agrupar not in AGRUPAMENTOS:
        agrupar = "status"

    # os contadores do rodapé do cartão saem por annotate: um GROUP BY, e não
    # duas queries por chamado desenhado. O exclude(CLOSED) é o que faz este
    # quadro ser a fila de não resolvidos.
    scope = (
        selectors.visible_tickets(user)
        .exclude(status=TicketStatus.CLOSED)
        .select_related("team", "requester", "owner", "assignee", "company", "stage")
        .annotate(
            message_count=Count("messages", distinct=True),
            attachment_count=Count("messages__attachments", distinct=True),
        )
    )
    if board.team_id:
        # o quadro é da equipe: o recorte é o mesmo da fila daquela equipe
        scope = scope.filter(team_id=board.team_id)

    if agrupar == "priority":
        columns = _colunas_por_prioridade()
    elif agrupar == "assignee":
        columns = _colunas_por_responsavel(scope)
    else:
        columns = _colunas_por_status(board)
    chaves = {c["key"] for c in columns}

    cards = {card.ticket_id: card for card in board.cards.all()}

    saida = []
    for ticket in scope.order_by("-created_at"):
        card = cards.get(ticket.pk)
        chave = _chave_do_ticket(ticket, card, agrupar)
        # Chamado cuja coluna não existe (stage desativado, lane apagada) não
        # pode sumir: ele cai na primeira coluna da categoria dele. Silenciar
        # aqui era exatamente como o quadro escondia trabalho antes.
        if chave not in chaves:
            chave = _resgate(ticket, columns, agrupar)
            if chave is None:
                continue
        saida.append(_entry(ticket, chave, card, user))

    return {"columns": columns, "entries": saida}


def _resgate(ticket, columns, agrupar):
    """A coluna de socorro de um chamado órfão. `None` só se não houver
    nenhuma coluna — quadro vazio, e aí não há onde desenhar mesmo."""
    if agrupar == "status":
        mesma_categoria = [c for c in columns if c["category"] == ticket.status]
        if mesma_categoria:
            return mesma_categoria[0]["key"]
        # sem coluna da categoria (ex.: todas desativadas): a primeira de
        # status ainda é melhor do que sumir
        de_status = [c for c in columns if c["kind"] == "stage"]
        if de_status:
            return de_status[0]["key"]
    return columns[0]["key"] if columns else None


def visible_ticket(board, user, ticket_id):
    """Ticket dentro do escopo do quadro; fora dele, não existe."""
    scope = selectors.visible_tickets(user)
    if board.team_id:
        scope = scope.filter(Q(team_id=board.team_id) | Q(cards__board=board))
    return scope.filter(pk=ticket_id).first()
