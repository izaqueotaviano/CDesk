"""Presença no detalhe do ticket (detecção de colisão).

O que está travado aqui:
- só interno registra/recebe presença, e só em ticket que enxerga — cliente
  leva 403 sem nem olhar o ticket; interno fora do escopo leva 404;
- a presença é efêmera: vence sozinha pelo TTL (aba que morreu sem avisar
  não fica presa na tela dos colegas), e o "digitando" vence antes dela;
- a lista nova chega pelo ws/me/ dos OUTROS presentes só quando o estado
  visível muda — e o consumer nunca repassa o evento a um cliente.
"""

from types import SimpleNamespace
from unittest import mock

import pytest
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache

from apps.chat.consumers import UserConsumer
from apps.tickets.services import presenca

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def cache_limpo():
    # LocMem é compartilhado pelo processo inteiro da suíte: sem limpar, a
    # presença de um teste vazaria para o próximo.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def ticket(make_ticket, ana, suporte):
    return make_ticket(ana, suporte, subject="Impressora não liga")


@pytest.fixture
def ticket_financeiro(make_ticket, ana, financeiro):
    return make_ticket(ana, financeiro, subject="Boleto em dobro")


def _url(ticket):
    return f"/api/v1/tickets/{ticket.pk}/presenca/"


class _Relogio:
    """`time.time()` do módulo de presença sob controle do teste — o TTL do
    cache é emulado apagando a chave, e o prazo do "digitando" é comparado
    com este relógio."""

    def __init__(self, inicio=1_000_000.0):
        self.agora = inicio

    def __call__(self):
        return self.agora


@pytest.fixture
def relogio():
    r = _Relogio()
    # troca o `time` DO MÓDULO, não o `time.time` global: o LocMem e o channel
    # layer também leem o relógio, e adiantá-lo para eles venceria o cache junto
    with mock.patch.object(presenca, "time", SimpleNamespace(time=r)):
        yield r


def _ouvir(user):
    """Canal de teste inscrito no grupo pessoal de `user` (o mesmo que o
    UserConsumer usa), no channel layer em memória da suíte."""
    layer = get_channel_layer()
    canal = async_to_sync(layer.new_channel)()
    async_to_sync(layer.group_add)(f"user_{user.pk}", canal)
    return layer, canal


def _mensagens(layer, canal):
    """Tudo o que chegou no canal até agora, sem bloquear."""
    recebidas = []
    fila = layer.channels.get(canal)
    while fila is not None and not fila.empty():
        recebidas.append(fila.get_nowait()[1])
    return recebidas


class TestQuemPode:
    def test_cliente_leva_403_mesmo_no_proprio_ticket(self, api, ana, ticket):
        resp = api(ana).post(_url(ticket), {}, format="json")
        assert resp.status_code == 403
        assert presenca.listar(ticket.pk) == []

    def test_cliente_leva_403_em_ticket_que_nao_existe(self, api, ana):
        # a mesma resposta existindo ou não: nada a sondar
        resp = api(ana).post("/api/v1/tickets/999999/presenca/", {}, format="json")
        assert resp.status_code == 403

    def test_interno_fora_do_escopo_leva_404(self, api, agente_suporte, ticket_financeiro):
        resp = api(agente_suporte).post(_url(ticket_financeiro), {}, format="json")
        assert resp.status_code == 404
        assert presenca.listar(ticket_financeiro.pk) == []

    def test_interno_com_visibilidade_registra_e_recebe_a_lista(
        self, api, agente_suporte, supervisor, ticket
    ):
        api(supervisor).post(_url(ticket), {}, format="json")
        resp = api(agente_suporte).post(_url(ticket), {}, format="json")

        assert resp.status_code == 200
        assert resp.data["batimento_segundos"] == presenca.BATIMENTO_S
        ids = [p["user_id"] for p in resp.data["presentes"]]
        # ordem de chegada, e quem pediu vem junto (a tela filtra a si mesma)
        assert ids == [supervisor.pk, agente_suporte.pk]
        assert resp.data["presentes"][0]["nome"] == supervisor.full_name
        assert resp.data["presentes"][0]["digitando"] is None

    def test_digitando_invalido_e_recusado(self, api, agente_suporte, ticket):
        resp = api(agente_suporte).post(_url(ticket), {"digitando": "fofoca"}, format="json")
        assert resp.status_code == 400


class TestDigitando:
    def test_resposta_e_nota_aparecem_como_tal(self, api, agente_suporte, supervisor, ticket):
        api(supervisor).post(_url(ticket), {"digitando": "resposta"}, format="json")
        resp = api(agente_suporte).post(_url(ticket), {"digitando": "nota"}, format="json")

        estado = {p["user_id"]: p["digitando"] for p in resp.data["presentes"]}
        assert estado == {supervisor.pk: "resposta", agente_suporte.pk: "nota"}

    def test_parar_de_digitar_volta_a_so_vendo(self, api, agente_suporte, ticket):
        api(agente_suporte).post(_url(ticket), {"digitando": "resposta"}, format="json")
        resp = api(agente_suporte).post(_url(ticket), {"digitando": None}, format="json")
        assert resp.data["presentes"][0]["digitando"] is None

    def test_digitando_vence_antes_da_presenca(self, agente_suporte, ticket, relogio):
        """O "parei de digitar" pode se perder; o aviso não pode ficar aceso
        até a presença inteira vencer."""
        presenca.registrar(ticket=ticket, user=agente_suporte, digitando="resposta")

        relogio.agora += presenca.TTL_DIGITANDO_S + 1
        [quem] = presenca.listar(ticket.pk)
        assert quem["user_id"] == agente_suporte.pk
        assert quem["digitando"] is None


class TestTtl:
    def test_aba_que_morre_some_sozinha(self, agente_suporte, supervisor, ticket):
        presenca.registrar(ticket=ticket, user=supervisor)
        presenca.registrar(ticket=ticket, user=agente_suporte)

        # TTL vencido = a chave some do cache (é o que o Redis faz sozinho)
        cache.delete(presenca._chave_pessoa(ticket.pk, supervisor.pk))

        assert [p["user_id"] for p in presenca.listar(ticket.pk)] == [agente_suporte.pk]
        # e o índice foi podado junto
        assert cache.get(presenca._chave_indice(ticket.pk)) == [agente_suporte.pk]

    def test_toda_chave_nasce_com_ttl(self, agente_suporte, ticket):
        with mock.patch.object(presenca.cache, "set", wraps=presenca.cache.set) as espiao:
            presenca.registrar(ticket=ticket, user=agente_suporte)
        assert espiao.call_count >= 2
        for chamada in espiao.call_args_list:
            assert chamada.kwargs["timeout"] == presenca.TTL_PRESENCA_S

    def test_sair_remove_na_hora(self, api, agente_suporte, supervisor, ticket):
        api(supervisor).post(_url(ticket), {}, format="json")
        api(agente_suporte).post(_url(ticket), {}, format="json")

        resp = api(supervisor).delete(_url(ticket))

        assert resp.status_code == 200
        assert [p["user_id"] for p in resp.data["presentes"]] == [agente_suporte.pk]

    def test_batimento_nao_embaralha_a_ordem(self, agente_suporte, supervisor, ticket, relogio):
        presenca.registrar(ticket=ticket, user=supervisor)
        relogio.agora += 5
        presenca.registrar(ticket=ticket, user=agente_suporte)
        relogio.agora += 5
        presenca.registrar(ticket=ticket, user=supervisor)  # batimento de rotina
        assert [p["user_id"] for p in presenca.listar(ticket.pk)] == [
            supervisor.pk, agente_suporte.pk,
        ]


class TestDifusao:
    def test_quem_ja_estava_recebe_a_entrada_do_colega(
        self, api, agente_suporte, supervisor, ticket
    ):
        api(supervisor).post(_url(ticket), {}, format="json")
        layer, canal = _ouvir(supervisor)

        api(agente_suporte).post(_url(ticket), {"digitando": "resposta"}, format="json")

        [evento] = _mensagens(layer, canal)
        assert evento["type"] == "ticket_presence"
        assert evento["ticket_id"] == ticket.pk
        estado = {p["user_id"]: p["digitando"] for p in evento["presentes"]}
        assert estado[agente_suporte.pk] == "resposta"

    def test_batimento_sem_mudanca_nao_empurra_nada(
        self, api, agente_suporte, supervisor, ticket
    ):
        api(supervisor).post(_url(ticket), {}, format="json")
        api(agente_suporte).post(_url(ticket), {}, format="json")
        layer, canal = _ouvir(supervisor)

        api(agente_suporte).post(_url(ticket), {}, format="json")

        assert _mensagens(layer, canal) == []

    def test_quem_agiu_nao_recebe_o_proprio_evento(self, api, agente_suporte, ticket):
        layer, canal = _ouvir(agente_suporte)
        api(agente_suporte).post(_url(ticket), {"digitando": "nota"}, format="json")
        assert _mensagens(layer, canal) == []

    def test_quem_nao_esta_no_ticket_nao_recebe(
        self, api, agente_suporte, supervisor, admin, ticket
    ):
        api(supervisor).post(_url(ticket), {}, format="json")
        layer, canal = _ouvir(admin)  # conectado ao ws/me/, mas em outra tela

        api(agente_suporte).post(_url(ticket), {"digitando": "resposta"}, format="json")

        assert _mensagens(layer, canal) == []

    def test_sair_avisa_quem_ficou(self, api, agente_suporte, supervisor, ticket):
        api(supervisor).post(_url(ticket), {}, format="json")
        api(agente_suporte).post(_url(ticket), {}, format="json")
        layer, canal = _ouvir(agente_suporte)

        api(supervisor).delete(_url(ticket))

        [evento] = _mensagens(layer, canal)
        assert [p["user_id"] for p in evento["presentes"]] == [agente_suporte.pk]


class TestConsumer:
    def _consumer(self, user):
        c = UserConsumer()
        c.user = user
        c.send_json = mock.AsyncMock()
        return c

    def test_interno_recebe_o_evento(self, agente_suporte):
        c = self._consumer(agente_suporte)
        presentes = [{"user_id": 1, "nome": "Samuel", "avatar_url": None, "digitando": None}]
        async_to_sync(c.ticket_presence)(
            {"type": "ticket_presence", "ticket_id": 7, "presentes": presentes}
        )
        c.send_json.assert_awaited_once_with(
            {"type": "ticket_presence", "ticket_id": 7, "presentes": presentes}
        )

    def test_cliente_nunca_recebe(self, ana):
        c = self._consumer(ana)
        async_to_sync(c.ticket_presence)(
            {"type": "ticket_presence", "ticket_id": 7, "presentes": []}
        )
        c.send_json.assert_not_awaited()


class TestOutrosTicketsDoSolicitante:
    """`?requester=<id>` na listagem — o painel "Outros tickets de <nome>"."""

    def test_recorta_pelo_solicitante(self, api, agente_suporte, make_ticket, ana, beto, suporte):
        t1 = make_ticket(ana, suporte, subject="Primeiro")
        t2 = make_ticket(ana, suporte, subject="Segundo")
        make_ticket(beto, suporte, subject="Do Beto")

        resp = api(agente_suporte).get(f"/api/v1/tickets/?requester={ana.pk}")

        assert resp.status_code == 200
        assert {r["id"] for r in resp.data["results"]} == {t1.pk, t2.pk}

    def test_respeita_o_escopo_de_quem_pede(self, api, carla, make_ticket, ana, suporte):
        make_ticket(ana, suporte, subject="Da Acme")
        # cliente de OUTRA empresa pedindo os chamados da Ana: vazio, não vaza
        resp = api(carla).get(f"/api/v1/tickets/?requester={ana.pk}")
        assert resp.status_code == 200
        assert resp.data["results"] == []

    def test_valor_nao_numerico_e_ignorado(self, api, agente_suporte, make_ticket, ana, suporte):
        make_ticket(ana, suporte)
        resp = api(agente_suporte).get("/api/v1/tickets/?requester=ana")
        assert resp.status_code == 200
        assert resp.data["count"] == 1

    def test_detalhe_expoe_o_id_do_solicitante(self, api, agente_suporte, ticket, ana):
        resp = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/")
        assert resp.data["requester"]["id"] == ana.pk
