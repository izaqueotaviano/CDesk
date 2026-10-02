"""Visualizações pessoais da fila (`/api/v1/ticket-views/`).

Dois eixos que não podem regredir:

- isolamento: a visão é de quem criou. Outra pessoa não lista, não lê, não
  edita, não apaga, não reordena — e recebe 404 (não 403), para o id nem
  confirmar que existe;
- validação: o JSON de filtros passa por uma allowlist. Chave que a listagem
  não entende, ou valor fora do domínio, é 400 na gravação — nunca uma visão
  que "filtra por nada" e mostra a fila inteira sem explicar.
"""

import pytest

from apps.tickets.models import SavedTicketView

pytestmark = pytest.mark.django_db

URL = "/api/v1/ticket-views/"


def _criar(cliente, nome="Acme urgentes", filtros=None):
    return cliente.post(
        URL, {"name": nome, "filters": filtros or {"priority": "urgent"}}, format="json",
    )


class TestCrud:
    def test_cria_lista_renomeia_e_apaga(self, api, agente_suporte):
        c = api(agente_suporte)
        resp = _criar(c, filtros={"view": "nao-resolvidos", "priority": "high,urgent"})
        assert resp.status_code == 201, resp.content
        visao = resp.json()
        assert visao["name"] == "Acme urgentes"
        assert visao["filters"] == {"view": "nao-resolvidos", "priority": "high,urgent"}
        assert visao["position"] == 0

        lista = c.get(URL).json()
        assert [v["id"] for v in lista] == [visao["id"]]

        resp = c.patch(f"{URL}{visao['id']}/", {"name": "  Só urgentes  "}, format="json")
        assert resp.status_code == 200
        assert resp.json()["name"] == "Só urgentes"  # espaços das pontas saem

        assert c.delete(f"{URL}{visao['id']}/").status_code == 204
        assert c.get(URL).json() == []

    def test_nova_visao_entra_no_fim(self, api, agente_suporte):
        c = api(agente_suporte)
        _criar(c, "A")
        _criar(c, "B")
        assert [v["position"] for v in c.get(URL).json()] == [0, 1]

    def test_lista_traz_a_contagem_no_escopo_de_quem_pergunta(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        urgente = make_ticket(requester=ana, team=suporte)
        urgente.priority = "urgent"
        urgente.save(update_fields=["priority"])
        make_ticket(requester=ana, team=suporte)  # normal: fora da visão

        c = api(agente_suporte)
        _criar(c, filtros={"priority": "urgent"})
        assert c.get(URL).json()[0]["count"] == 1

    def test_contagem_nao_conta_o_que_a_pessoa_nao_ve(
        self, api, agente_suporte, ana, financeiro, make_ticket,
    ):
        """Chamado de equipe que o agente não atende não entra no número —
        a contagem parte de `visible_tickets`, como a listagem."""
        make_ticket(requester=ana, team=financeiro)
        c = api(agente_suporte)
        _criar(c, filtros={"view": "todos"})
        assert c.get(URL).json()[0]["count"] == 0

    def test_nome_repetido_ignora_maiusculas(self, api, agente_suporte):
        c = api(agente_suporte)
        assert _criar(c, "Acme").status_code == 201
        resp = _criar(c, "ACME")
        assert resp.status_code == 400
        assert "nome" in str(resp.json()).lower()

    def test_nome_em_branco_400(self, api, agente_suporte):
        assert _criar(api(agente_suporte), "   ").status_code == 400

    def test_teto_de_visoes(self, api, agente_suporte, monkeypatch):
        from apps.tickets import visoes_pessoais

        monkeypatch.setattr(visoes_pessoais, "MAX_VISOES_POR_PESSOA", 2)
        c = api(agente_suporte)
        _criar(c, "A")
        _criar(c, "B")
        resp = _criar(c, "C")
        assert resp.status_code == 400
        assert "Limite" in resp.json()["detail"]


class TestIsolamento:
    def test_outra_pessoa_nao_ve_nem_mexe(self, api, agente_suporte, supervisor):
        minha = _criar(api(agente_suporte)).json()
        outro = api(supervisor)

        assert outro.get(URL).json() == []
        assert outro.get(f"{URL}{minha['id']}/").status_code == 404
        assert outro.patch(
            f"{URL}{minha['id']}/", {"name": "roubada"}, format="json",
        ).status_code == 404
        assert outro.delete(f"{URL}{minha['id']}/").status_code == 404
        assert SavedTicketView.objects.get(pk=minha["id"]).name == "Acme urgentes"

    def test_mesmo_nome_em_pessoas_diferentes_pode(self, api, agente_suporte, supervisor):
        assert _criar(api(agente_suporte), "Minha fila").status_code == 201
        assert _criar(api(supervisor), "Minha fila").status_code == 201

    def test_reordenar_nao_aceita_id_de_outra_pessoa(self, api, agente_suporte, supervisor):
        minha = _criar(api(agente_suporte)).json()
        dele = _criar(api(supervisor)).json()
        resp = api(agente_suporte).post(
            f"{URL}reorder/", {"ids": [dele["id"], minha["id"]]}, format="json",
        )
        assert resp.status_code == 400
        assert SavedTicketView.objects.get(pk=dele["id"]).position == 0

    def test_cliente_nao_alcanca(self, api, ana):
        assert api(ana).get(URL).status_code == 403
        assert _criar(api(ana)).status_code == 403


class TestReordenar:
    def test_reescreve_as_posicoes_na_ordem_dada(self, api, agente_suporte):
        c = api(agente_suporte)
        a = _criar(c, "A").json()
        b = _criar(c, "B").json()
        d = _criar(c, "C").json()
        resp = c.post(f"{URL}reorder/", {"ids": [d["id"], a["id"], b["id"]]}, format="json")
        assert resp.status_code == 200
        assert [v["name"] for v in resp.json()] == ["C", "A", "B"]
        assert [v["name"] for v in c.get(URL).json()] == ["C", "A", "B"]

    def test_lista_parcial_ou_repetida_400(self, api, agente_suporte):
        c = api(agente_suporte)
        a = _criar(c, "A").json()
        _criar(c, "B")
        assert c.post(f"{URL}reorder/", {"ids": [a["id"]]}, format="json").status_code == 400
        assert c.post(
            f"{URL}reorder/", {"ids": [a["id"], a["id"]]}, format="json",
        ).status_code == 400


class TestValidacaoDosFiltros:
    @pytest.mark.parametrize("filtros", [
        {"campo_inventado": "x"},
        {"status": "aberto"},                  # tem de ser o valor da API, não o rótulo
        {"priority": "urgent,muito-alta"},
        {"view": "nao-existe"},
        {"assignee": "fulano"},
        {"company": "acme"},                    # empresa é por id
        {"requester": "ana@acme.test"},         # solicitante também
        {"team": "com espaço"},
        {"sla": "quase"},
        {"periodo": "ontem"},
        {"desde": "31/12/2026"},
        {"desde": "2026-09-10", "ate": "2026-09-01"},
        {"ordering": "senha"},
        {"q": "x" * 201},
        {"priority": 3},                        # valor precisa ser texto
    ])
    def test_recusa(self, api, agente_suporte, filtros):
        resp = _criar(api(agente_suporte), filtros=filtros)
        assert resp.status_code == 400, filtros

    def test_filtros_precisam_ser_objeto(self, api, agente_suporte):
        resp = api(agente_suporte).post(
            URL, {"name": "x", "filters": ["priority", "urgent"]}, format="json",
        )
        assert resp.status_code == 400

    def test_aceita_todas_as_chaves_da_barra_de_filtros(self, api, agente_suporte):
        filtros = {
            "view": "mencionam-voce",
            "status": "new,open",
            "priority": "high,urgent",
            "assignee": "unassigned",
            "team": "suporte",
            "company": "12",
            "category": "3",
            "tag": "boleto",
            "sla": "at_risk",
            "periodo": "7d",
            "desde": "2026-09-01",
            "ate": "2026-09-30",
            "q": "cobrança",
            "ordering": "-sla",
            "requester": "41",
        }
        resp = _criar(api(agente_suporte), filtros=filtros)
        assert resp.status_code == 201, resp.content
        assert resp.json()["filters"] == filtros

    def test_valor_vazio_sai_e_repetido_na_lista_some(self, api, agente_suporte):
        resp = _criar(api(agente_suporte), filtros={
            "status": "new,new,open", "team": "", "tag": None,
        })
        assert resp.status_code == 201
        assert resp.json()["filters"] == {"status": "new,open"}

    def test_patch_de_filtros_tambem_valida(self, api, agente_suporte):
        c = api(agente_suporte)
        visao = _criar(c).json()
        resp = c.patch(f"{URL}{visao['id']}/", {"filters": {"hack": "1"}}, format="json")
        assert resp.status_code == 400
        resp = c.patch(f"{URL}{visao['id']}/", {"filters": {"sla": "breached"}}, format="json")
        assert resp.status_code == 200
        assert resp.json()["filters"] == {"sla": "breached"}
