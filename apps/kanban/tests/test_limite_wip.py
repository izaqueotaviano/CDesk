"""Limite de WIP por coluna: um AVISO que a equipe combina, nunca uma trava.

O que estes testes protegem:

- a coluna de status guarda o limite POR QUADRO (o status é global, a
  capacidade é de quem olha o quadro), e a lane guarda o dela;
- a tela usa uma chave só (`columns[].key`) para as duas espécies;
- passar do limite não bloqueia arraste nenhum;
- qualquer interno configura (como a lane), cliente não.
"""

import pytest

from apps.kanban.models import Board, BoardLane, BoardStageLimit
from apps.tickets.services import ticket_service

from .test_kanban import (  # noqa: F401 — fixtures do cenário compartilhado
    admin,
    agente,
    ana,
    api,
    board,
    cols,
    suporte,
    ticket,
)

pytestmark = pytest.mark.django_db


def _limite(api_client, board, key, valor):
    return api_client.patch(
        f"/api/v1/kanban/boards/{board.pk}/columns/{key}/",
        {"wip_limit": valor}, format="json",
    )


def _coluna(payload, key):
    return next(c for c in payload["columns"] if c["key"] == key)


class TestLimiteDeColunaDeStatus:
    def test_quadro_montado_traz_wip_limit_nulo_por_padrao(self, api, agente, board):
        payload = api(agente).get(f"/api/v1/kanban/boards/{board.pk}/cards/").json()
        assert payload["columns"], "o quadro precisa ter colunas"
        assert all(c["wip_limit"] is None for c in payload["columns"])

    def test_definir_limite_devolve_o_quadro_com_o_limite(self, api, agente, board, cols):
        key = str(cols["Aberto"].pk)
        resp = _limite(api(agente), board, key, 5)
        assert resp.status_code == 200, resp.data
        assert _coluna(resp.json(), key)["wip_limit"] == 5
        assert BoardStageLimit.objects.get(board=board, stage=cols["Aberto"]).wip_limit == 5

    def test_trocar_o_limite_atualiza_sem_duplicar(self, api, agente, board, cols):
        key = str(cols["Aberto"].pk)
        _limite(api(agente), board, key, 5)
        resp = _limite(api(agente), board, key, 2)
        assert _coluna(resp.json(), key)["wip_limit"] == 2
        assert BoardStageLimit.objects.filter(board=board).count() == 1

    def test_null_tira_o_limite(self, api, agente, board, cols):
        key = str(cols["Aberto"].pk)
        _limite(api(agente), board, key, 5)
        resp = _limite(api(agente), board, key, None)
        assert resp.status_code == 200, resp.data
        assert _coluna(resp.json(), key)["wip_limit"] is None
        assert not BoardStageLimit.objects.filter(board=board).exists()

    def test_limite_e_do_quadro_nao_do_status(self, api, agente, admin, board, cols):
        """O mesmo "Aberto" em dois quadros: cada equipe tem a sua capacidade."""
        outro = Board.objects.create(name="Outro", slug="outro", created_by=admin)
        key = str(cols["Aberto"].pk)
        _limite(api(agente), board, key, 3)

        payload = api(agente).get(f"/api/v1/kanban/boards/{outro.pk}/cards/").json()
        assert _coluna(payload, key)["wip_limit"] is None

    def test_coluna_de_conclusao_nao_aceita_limite(self, api, agente, board):
        payload = api(agente).get(f"/api/v1/kanban/boards/{board.pk}/cards/").json()
        conclusao = next(c for c in payload["columns"] if c["concludes"])
        resp = _limite(api(agente), board, conclusao["key"], 3)
        assert resp.status_code == 400
        assert not BoardStageLimit.objects.exists()


class TestLimiteDeLane:
    def test_lane_guarda_o_proprio_limite(self, api, agente, board):
        lane = BoardLane.objects.create(board=board, name="Depende do gestor")
        resp = _limite(api(agente), board, f"lane-{lane.pk}", 4)
        assert resp.status_code == 200, resp.data
        assert _coluna(resp.json(), f"lane-{lane.pk}")["wip_limit"] == 4
        lane.refresh_from_db()
        assert lane.wip_limit == 4

        resp = _limite(api(agente), board, f"lane-{lane.pk}", None)
        lane.refresh_from_db()
        assert lane.wip_limit is None

    def test_lane_de_outro_quadro_nao_existe_aqui(self, api, agente, admin, board):
        outro = Board.objects.create(name="Outro", slug="outro", created_by=admin)
        lane = BoardLane.objects.create(board=outro, name="Alheia")
        resp = _limite(api(agente), board, f"lane-{lane.pk}", 4)
        assert resp.status_code == 404
        lane.refresh_from_db()
        assert lane.wip_limit is None

    def test_serializer_de_lane_expoe_o_limite(self, api, agente, board):
        lane = BoardLane.objects.create(board=board, name="Sprint", wip_limit=2)
        resp = api(agente).get(f"/api/v1/kanban/lanes/?board={board.pk}")
        dados = resp.json()
        linhas = dados["results"] if isinstance(dados, dict) else dados
        assert next(item for item in linhas if item["id"] == lane.pk)["wip_limit"] == 2


class TestValidacao:
    @pytest.mark.parametrize("valor", [0, -1, 1000, "cinco"])
    def test_rejeita_limite_invalido(self, api, agente, board, cols, valor):
        resp = _limite(api(agente), board, str(cols["Aberto"].pk), valor)
        assert resp.status_code == 400
        assert not BoardStageLimit.objects.exists()

    def test_corpo_vazio_nao_tira_o_limite_por_omissao(self, api, agente, board, cols):
        key = str(cols["Aberto"].pk)
        _limite(api(agente), board, key, 5)
        resp = api(agente).patch(
            f"/api/v1/kanban/boards/{board.pk}/columns/{key}/", {}, format="json"
        )
        assert resp.status_code == 400
        assert BoardStageLimit.objects.get(board=board).wip_limit == 5

    @pytest.mark.parametrize("key", ["999999", "lane-999999", "lane-x", "abc"])
    def test_chave_inexistente_da_404(self, api, agente, board, key):
        assert _limite(api(agente), board, key, 3).status_code == 404


class TestAvisoNaoTrava:
    def test_passar_do_limite_nao_bloqueia_o_arraste(
        self, api, agente, ana, suporte, board, cols, ticket
    ):
        """O limite é aviso: o move que passa dele continua aceito."""
        destino = cols["Aberto"]
        key = str(destino.pk)
        _limite(api(agente), board, key, 1)
        primeiro = ticket_service.create_ticket(
            requester=ana, team=suporte, subject="Primeiro", body="corpo"
        )
        for t in (primeiro, ticket):
            resp = api(agente).post(
                f"/api/v1/kanban/boards/{board.pk}/place/",
                {"ticket_id": t.pk, "stage_id": destino.pk}, format="json",
            )
            assert resp.status_code == 200, resp.data

        payload = resp.json()
        na_coluna = [e for e in payload["entries"] if e["column"] == key]
        assert len(na_coluna) == 2
        assert _coluna(payload, key)["wip_limit"] == 1


class TestPermissao:
    def test_cliente_nao_configura(self, api, ana, board, cols):
        resp = _limite(api(ana), board, str(cols["Aberto"].pk), 3)
        assert resp.status_code in (403, 404)
        assert not BoardStageLimit.objects.exists()

    def test_agente_configura_sem_ser_admin(self, api, agente, board, cols):
        assert _limite(api(agente), board, str(cols["Aberto"].pk), 3).status_code == 200
