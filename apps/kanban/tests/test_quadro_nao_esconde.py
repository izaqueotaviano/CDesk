"""O quadro não pode esconder chamado EM ABERTO.

O quadro é a fila de não resolvidos vista por coluna — o mesmo recorte de
`?view=nao-resolvidos`. Chamado fechado sai; chamado aberto NUNCA some, e essa
é a regra que já se quebrou duas vezes aqui, das duas por o quadro ter uma
lista de colunas própria discordando do status.

Cobre também as colunas de ORGANIZAÇÃO (lanes): fixação é visual, nunca mexe
no status — e apagar a lane devolve os chamados às colunas de status, sem
sumir com ninguém.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.kanban.models import Board, BoardLane
from apps.kanban.services import board_view
from apps.kanban.services import place as colocar
from apps.tickets.models import Ticket, TicketStage, TicketStatus

pytestmark = pytest.mark.django_db

ABERTOS = [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.PENDING_CUSTOMER]


@pytest.fixture
def cena(db):
    plano = Plan.objects.create(slug="g", name="G", default_ticket_limit=99)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plano)
    eq = Team.objects.create(name="Suporte", slug="suporte")
    ana = User.objects.create_user(email="ana@acme.test", full_name="Ana",
                                   kind=UserKind.CLIENT, company=acme, client_role="owner")
    agente = User.objects.create_user(email="ag@x.test", full_name="Ag",
                                      kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN)
    AgentTeam.objects.create(user=agente, team=eq)
    quadro = Board.objects.create(name="Q", slug="q", team=eq)

    stages = {s.category: s for s in TicketStage.objects.filter(is_system=True)}
    for i, st in enumerate([*ABERTOS, TicketStatus.CLOSED]):
        Ticket.objects.create(reference=f"T-{i}", company=acme, requester=ana,
                              team=eq, subject=f"t{i}", status=st, stage=stages[st])
    return dict(quadro=quadro, agente=agente, acme=acme, ana=ana, equipe=eq)


def test_o_recorte_e_o_dos_nao_resolvidos(cena):
    """O mesmo conjunto de `?view=nao-resolvidos`: os 3 abertos entram e o
    fechado não.

    A coluna de conclusão existe (é para onde se arrasta para fechar), mas
    fica vazia — o que importa aqui é o recorte das ENTRADAS.
    """
    saida = board_view.entries(cena["quadro"], cena["agente"])
    assert len(saida["entries"]) == 3
    abertas = [c["category"] for c in saida["columns"] if not c["concludes"]]
    assert abertas == [s.value for s in ABERTOS]
    assert any(c["concludes"] for c in saida["columns"])


def test_cada_chamado_cai_na_coluna_do_proprio_status(cena):
    saida = board_view.entries(cena["quadro"], cena["agente"])
    por_coluna = {c["key"]: c["category"] for c in saida["columns"]}
    for e in saida["entries"]:
        assert por_coluna[e["column"]] == e["ticket_status"]


def test_um_status_criado_vira_coluna_sem_ninguem_configurar(cena):
    """Criar status é criar coluna: o quadro não tem uma lista própria para
    manter em dia, então não há como as duas discordarem."""
    TicketStage.objects.create(
        slug="em-analise", name="Em análise", category=TicketStatus.OPEN, order=9
    )
    saida = board_view.entries(cena["quadro"], cena["agente"])
    assert "Em análise" in [c["name"] for c in saida["columns"]]


def test_chamado_em_status_desativado_nao_some(cena):
    """Desativar o status esconde a COLUNA, nunca o chamado: ele é resgatado
    para a primeira coluna da mesma categoria."""
    analise = TicketStage.objects.create(
        slug="em-analise", name="Em análise", category=TicketStatus.OPEN, order=9
    )
    aberto = Ticket.objects.get(status=TicketStatus.OPEN)
    aberto.stage = analise
    aberto.save(update_fields=["stage"])

    analise.is_active = False
    analise.save(update_fields=["is_active"])

    saida = board_view.entries(cena["quadro"], cena["agente"])
    assert len(saida["entries"]) == 3  # ninguém sumiu
    entrada = next(e for e in saida["entries"] if e["ticket"] == aberto.pk)
    coluna = next(c for c in saida["columns"] if c["key"] == entrada["column"])
    assert coluna["category"] == TicketStatus.OPEN  # e caiu no lugar certo


# --------------------------------------------------------------------------- #
# Colunas de organização — visuais por contrato
# --------------------------------------------------------------------------- #

def test_fixar_numa_lane_nao_toca_no_status(cena):
    """O pedido do negócio, literal: a coluna personalizada não é para mudar
    o status — é visualização. Fixar move o cartão na TELA e em nada mais."""
    lane = BoardLane.objects.create(board=cena["quadro"], name="Depende do gestor")
    aberto = Ticket.objects.get(status=TicketStatus.OPEN)
    stage_antes, status_antes = aberto.stage_id, aberto.status

    colocar(board=cena["quadro"], ticket=aberto, actor=cena["agente"], lane=lane)

    aberto.refresh_from_db()
    assert (aberto.status, aberto.stage_id) == (status_antes, stage_antes)  # intocado
    saida = board_view.entries(cena["quadro"], cena["agente"])
    entrada = next(e for e in saida["entries"] if e["ticket"] == aberto.pk)
    assert entrada["column"] == f"lane-{lane.pk}"     # mas a tela mostra na lane
    assert entrada["ticket_status"] == status_antes   # com o status verdadeiro


def test_arrastar_para_coluna_de_status_solta_a_fixacao(cena):
    """Voltar para o fluxo desfaz a organização: o status manda de novo."""
    lane = BoardLane.objects.create(board=cena["quadro"], name="Depende do gestor")
    aberto = Ticket.objects.get(status=TicketStatus.OPEN)
    colocar(board=cena["quadro"], ticket=aberto, actor=cena["agente"], lane=lane)

    aguardando = TicketStage.objects.get(slug="pending_customer")
    colocar(board=cena["quadro"], ticket=aberto, actor=cena["agente"], stage=aguardando)

    aberto.refresh_from_db()
    assert aberto.status == TicketStatus.PENDING_CUSTOMER
    saida = board_view.entries(cena["quadro"], cena["agente"])
    entrada = next(e for e in saida["entries"] if e["ticket"] == aberto.pk)
    assert entrada["column"] == str(aguardando.pk)  # na coluna do status, não na lane


def test_apagar_a_lane_devolve_os_chamados_ao_status(cena):
    lane = BoardLane.objects.create(board=cena["quadro"], name="Sprint")
    aberto = Ticket.objects.get(status=TicketStatus.OPEN)
    colocar(board=cena["quadro"], ticket=aberto, actor=cena["agente"], lane=lane)

    lane.delete()

    saida = board_view.entries(cena["quadro"], cena["agente"])
    assert len(saida["entries"]) == 3  # ninguém sumiu
    entrada = next(e for e in saida["entries"] if e["ticket"] == aberto.pk)
    assert entrada["column"] == str(aberto.stage_id)


def test_lane_e_do_quadro_nao_vaza_para_outro(cena):
    outro = Board.objects.create(name="Outro", slug="outro", team=cena["equipe"])
    BoardLane.objects.create(board=cena["quadro"], name="Só daqui")

    saida = board_view.entries(outro, cena["agente"])
    assert "Só daqui" not in [c["name"] for c in saida["columns"]]


def test_chamado_fixado_que_fecha_sai_do_quadro(cena):
    """A fixação não segura chamado encerrado: fechado saiu da fila, e o
    quadro É a fila."""
    lane = BoardLane.objects.create(board=cena["quadro"], name="Sprint")
    aberto = Ticket.objects.get(status=TicketStatus.OPEN)
    colocar(board=cena["quadro"], ticket=aberto, actor=cena["agente"], lane=lane)

    fechado = TicketStage.objects.get(slug="closed")
    Ticket.objects.filter(pk=aberto.pk).update(
        status=TicketStatus.CLOSED, stage=fechado
    )

    saida = board_view.entries(cena["quadro"], cena["agente"])
    assert aberto.pk not in [e["ticket"] for e in saida["entries"]]


# --------------------------------------------------------------------------- #
# Agrupamentos
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("agrupar", ["status", "priority", "assignee"])
def test_trocar_o_agrupamento_nao_perde_chamado(cena, agrupar):
    """Outro eixo é outra lente sobre a MESMA fila."""
    saida = board_view.entries(cena["quadro"], cena["agente"], agrupar)
    assert len(saida["entries"]) == 3
    chaves = {c["key"] for c in saida["columns"]}
    assert all(e["column"] in chaves for e in saida["entries"])


def test_agrupado_por_responsavel_quem_nao_tem_dono_ainda_aparece(cena):
    """O campo vazio precisa de coluna própria — senão o chamado sem
    responsável, que é justamente o que ninguém pegou, seria o que some."""
    saida = board_view.entries(cena["quadro"], cena["agente"], "assignee")
    sem_dono = next(c for c in saida["columns"] if c["key"] == "none")
    nesta = [e for e in saida["entries"] if e["column"] == sem_dono["key"]]
    assert len(nesta) == 3  # nenhum dos três tem responsável


def test_a_tela_recebe_coluna_e_cartao_na_MESMA_resposta(cena):
    """Duas respostas para desenhar um quadro é a chance de discordarem — e
    quando discordavam, a entrada apontava para uma coluna que a tela não
    tinha e o chamado sumia de novo, agora calado."""
    cliente = APIClient()
    cliente.force_authenticate(user=cena["agente"])
    quadro = cena["quadro"]
    BoardLane.objects.create(board=quadro, name="Sprint")

    payload = cliente.get(f"/api/v1/kanban/boards/{quadro.pk}/cards/").json()

    da_tela = {c["key"] for c in payload["columns"]}
    orfas = [e["ticket_reference"] for e in payload["entries"] if e["column"] not in da_tela]
    assert orfas == [], f"a tela não tem onde pôr {orfas}"
    assert len(payload["entries"]) == 3
    assert "Sprint" in [c["name"] for c in payload["columns"]]
