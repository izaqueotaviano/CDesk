"""`POST /tickets/take-next/` — o "Pegar o próximo" do Início.

A regra que importa é a de corrida: escolher e atribuir acontecem na mesma
transação, com a linha escolhida travada. Dois agentes clicando juntos pegam
chamados DIFERENTES, nunca o mesmo (antes a tela escolhia pela listagem e
atribuía num segundo pedido, e o segundo clique passava por cima do primeiro).
"""

import datetime as dt
import threading

import pytest
from django.db import connection
from django.utils import timezone

from apps.tickets.models import Ticket, TicketPriority

pytestmark = pytest.mark.django_db

URL = "/api/v1/tickets/take-next/"


@pytest.fixture(autouse=True)
def sem_cota(plan_gold):
    """O plano do cenário tem cota de 3 chamados/mês (conftest) — estes
    testes abrem mais que isso e não são sobre cota."""
    plan_gold.default_ticket_limit = None
    plan_gold.save(update_fields=["default_ticket_limit"])


def _com(ticket, **campos):
    Ticket.objects.filter(pk=ticket.pk).update(**campos)
    ticket.refresh_from_db()
    return ticket


class TestOrdem:
    def test_prazo_de_sla_mais_proximo_vem_primeiro(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        agora = timezone.now()
        folgado = _com(
            make_ticket(requester=ana, team=suporte),
            sla_resolution_due_at=agora + dt.timedelta(days=3),
        )
        apertado = _com(
            make_ticket(requester=ana, team=suporte),
            sla_resolution_due_at=agora + dt.timedelta(hours=2),
        )
        _com(make_ticket(requester=ana, team=suporte), sla_resolution_due_at=None)

        resp = api(agente_suporte).post(URL)

        assert resp.status_code == 200
        assert resp.json()["id"] == apertado.pk
        apertado.refresh_from_db()
        folgado.refresh_from_db()
        assert apertado.assignee_id == agente_suporte.pk
        assert folgado.assignee_id is None

    def test_sem_prazo_desempata_por_prioridade_e_depois_idade(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        _com(make_ticket(requester=ana, team=suporte), sla_resolution_due_at=None)  # normal, antigo
        antigo_alta = _com(
            make_ticket(requester=ana, team=suporte),
            sla_resolution_due_at=None, priority=TicketPriority.HIGH,
        )
        _com(
            make_ticket(requester=ana, team=suporte),
            sla_resolution_due_at=None, priority=TicketPriority.HIGH,
        )  # alta, mais novo
        Ticket.objects.filter(pk=antigo_alta.pk).update(
            created_at=timezone.now() - dt.timedelta(days=2),
        )

        resp = api(agente_suporte).post(URL)

        assert resp.json()["id"] == antigo_alta.pk

    def test_ignora_quem_ja_tem_dono_e_quem_espera_o_cliente(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        com_dono = _com(make_ticket(requester=ana, team=suporte), assignee=agente_financeiro)
        esperando = _com(make_ticket(requester=ana, team=suporte), status="pending_customer")
        livre = make_ticket(requester=ana, team=suporte)

        resp = api(agente_suporte).post(URL)

        assert resp.json()["id"] == livre.pk
        assert resp.json()["id"] not in (com_dono.pk, esperando.pk)


class TestEscopoEPermissao:
    def test_nao_pega_chamado_de_equipe_que_nao_enxerga(
        self, api, agente_financeiro, ana, suporte, make_ticket,
    ):
        make_ticket(requester=ana, team=suporte)

        resp = api(agente_financeiro).post(URL)

        assert resp.status_code == 409
        assert resp.json()["code"] == "nada_para_pegar"

    def test_fila_vazia_responde_409_com_codigo(self, api, agente_suporte):
        resp = api(agente_suporte).post(URL)
        assert resp.status_code == 409
        assert resp.json()["code"] == "nada_para_pegar"

    def test_cliente_nao_pega(self, api, ana):
        assert api(ana).post(URL).status_code == 403

    def test_papel_que_nao_pode_ser_responsavel_nao_pega(
        self, api, agente_leve, ana, suporte, make_ticket,
    ):
        livre = make_ticket(requester=ana, team=suporte)

        assert api(agente_leve).post(URL).status_code == 403
        livre.refresh_from_db()
        assert livre.assignee_id is None


@pytest.mark.django_db(transaction=True)
def test_dois_cliques_ao_mesmo_tempo_pegam_chamados_diferentes(
    api, agente_suporte, supervisor, ana, suporte, make_ticket, plan_gold,
):
    """A corrida de verdade: duas conexões, cada uma com a sua transação.
    Sem a trava, as duas escolheriam o mesmo chamado (o do prazo mais
    apertado) e a segunda atribuição passaria por cima da primeira."""
    plan_gold.default_ticket_limit = None
    plan_gold.save(update_fields=["default_ticket_limit"])
    agora = timezone.now()
    primeiro = _com(
        make_ticket(requester=ana, team=suporte),
        sla_resolution_due_at=agora + dt.timedelta(hours=1),
    )
    segundo = _com(
        make_ticket(requester=ana, team=suporte),
        sla_resolution_due_at=agora + dt.timedelta(hours=2),
    )

    largada = threading.Barrier(2)
    respostas = {}

    def pegar(quem):
        try:
            largada.wait(timeout=5)
            respostas[quem.pk] = api(quem).post(URL)
        finally:
            connection.close()

    tarefas = [threading.Thread(target=pegar, args=(u,)) for u in (agente_suporte, supervisor)]
    for t in tarefas:
        t.start()
    for t in tarefas:
        t.join(timeout=30)

    ids = sorted(r.json()["id"] for r in respostas.values() if r.status_code == 200)
    assert ids == sorted([primeiro.pk, segundo.pk])
    primeiro.refresh_from_db()
    segundo.refresh_from_db()
    assert {primeiro.assignee_id, segundo.assignee_id} == {agente_suporte.pk, supervisor.pk}
