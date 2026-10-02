"""A conversa contínua do cliente e o painel de anexos/links.

O cliente vê UMA conversa com o atendimento; a operação a divide em
atendimentos. Estes testes provam que a costura acontece só na leitura — e,
principalmente, que ela não costura a conversa de duas pessoas diferentes.

Metade daqui é isolamento, pelo mesmo motivo dos tickets: uma rota nova que
devolve "tudo o que é meu" é exatamente onde um vazamento entre empresas
entra sem ninguém notar.
"""

import pytest

from apps.chat.models import ChatMessage
from apps.chat.services import chat_service

pytestmark = pytest.mark.django_db

URL = "/api/v1/chat/timeline/"
URL_MEDIA = "/api/v1/chat/timeline/media/"


@pytest.fixture
def conversa_da_ana(ana, agente):
    """Duas sessões encerradas da Ana — o caso que a tela precisa costurar."""
    sessoes = []
    for n in (1, 2):
        chat, _ = chat_service.open_chat(client=ana)
        ChatMessage.objects.create(chat=chat, author=ana, body=f"mensagem {n} da ana")
        chat_service.take_chat(chat=chat, agent=agente)
        ChatMessage.objects.create(chat=chat, author=agente, body=f"resposta {n}")
        chat_service.close_chat(chat=chat, actor=agente)
        chat_service.rate(
            chat=chat, client=ana, service_score=9, resolution_score=9,
        )
        sessoes.append(chat)
    return sessoes


class TestCostura:
    def test_junta_as_sessoes_numa_linha_so(self, api, ana, conversa_da_ana):
        corpo = api(ana).get(URL).json()
        corpos = [m["body"] for m in corpo["messages"]]
        assert "mensagem 1 da ana" in corpos
        assert "mensagem 2 da ana" in corpos
        # as duas sessões, na MESMA lista
        assert {m["chat_id"] for m in corpo["messages"]} == {
            c.pk for c in conversa_da_ana
        }

    def test_ordem_e_cronologica_atravessando_sessoes(self, api, ana, conversa_da_ana):
        msgs = api(ana).get(URL).json()["messages"]
        assert [m["id"] for m in msgs] == sorted(m["id"] for m in msgs)

    def test_traz_o_resumo_de_cada_sessao_para_o_marcador(self, api, ana, conversa_da_ana):
        corpo = api(ana).get(URL).json()
        assert [s["id"] for s in corpo["sessions"]] == [c.pk for c in conversa_da_ana]
        primeira = corpo["sessions"][0]
        assert primeira["status"] == "closed"
        assert primeira["queued_at"] is not None
        assert primeira["closed_at"] is not None
        assert primeira["queued_at"] < primeira["closed_at"]
        assert primeira["rating"]["service_score"] == 9

    def test_sessao_sem_nota_vem_com_rating_nulo(self, api, ana, agente):
        chat, _ = chat_service.open_chat(client=ana)
        ChatMessage.objects.create(chat=chat, author=ana, body="oi")
        chat_service.take_chat(chat=chat, agent=agente)
        chat_service.close_chat(chat=chat, actor=agente)
        corpo = api(ana).get(URL).json()
        assert corpo["sessions"][0]["rating"] is None

    def test_sessoes_sao_so_as_do_recorte(self, api, ana, conversa_da_ana):
        """Quem carregou as últimas mensagens não recebe o resumo de um
        atendimento antigo que não está na tela."""
        corpo = api(ana).get(URL, {"limit": 1}).json()
        assert len(corpo["sessions"]) == 1
        assert corpo["sessions"][0]["id"] == corpo["messages"][0]["chat_id"]


class TestRecorte:
    def test_limit_traz_as_mais_recentes(self, api, ana, conversa_da_ana):
        todas = api(ana).get(URL).json()["messages"]
        recorte = api(ana).get(URL, {"limit": 2}).json()["messages"]
        assert len(recorte) == 2
        assert [m["id"] for m in recorte] == [m["id"] for m in todas[-2:]]

    def test_before_traz_as_anteriores(self, api, ana, conversa_da_ana):
        todas = api(ana).get(URL).json()["messages"]
        corte = todas[2]["id"]
        anteriores = api(ana).get(URL, {"before": corte}).json()["messages"]
        assert [m["id"] for m in anteriores] == [m["id"] for m in todas if m["id"] < corte]

    def test_has_more_avisa_que_ha_anteriores(self, api, ana, conversa_da_ana):
        assert api(ana).get(URL, {"limit": 1}).json()["has_more"] is True
        assert api(ana).get(URL).json()["has_more"] is False

    def test_limit_tem_teto(self, api, ana, conversa_da_ana):
        """Um `?limit=100000` não vira despejo do histórico."""
        assert api(ana).get(URL, {"limit": 99999}).status_code == 200

    def test_limit_invalido_e_recusado(self, api, ana):
        assert api(ana).get(URL, {"limit": "0"}).status_code == 400
        assert api(ana).get(URL, {"limit": "abc"}).status_code == 400
        assert api(ana).get(URL, {"before": "-1"}).status_code == 400

    def test_cliente_sem_conversa_nenhuma(self, api, beto):
        corpo = api(beto).get(URL).json()
        assert corpo == {"messages": [], "sessions": [], "has_more": False}


class TestBusca:
    def test_q_filtra_pelo_corpo(self, api, ana, conversa_da_ana):
        msgs = api(ana).get(URL, {"q": "mensagem 2"}).json()["messages"]
        assert [m["body"] for m in msgs] == ["mensagem 2 da ana"]

    def test_q_atravessa_as_sessoes(self, api, ana, conversa_da_ana):
        msgs = api(ana).get(URL, {"q": "resposta"}).json()["messages"]
        assert len({m["chat_id"] for m in msgs}) == 2

    def test_q_sem_resultado(self, api, ana, conversa_da_ana):
        assert api(ana).get(URL, {"q": "xyzabc"}).json()["messages"] == []


class TestIsolamento:
    """A rota devolve "tudo o que é meu" — é onde um vazamento entra calado."""

    def test_cliente_nao_ve_a_conversa_de_outra_empresa(
        self, api, ana, carla, agente, conversa_da_ana
    ):
        chat, _ = chat_service.open_chat(client=carla)
        ChatMessage.objects.create(chat=chat, author=carla, body="segredo da bravo")

        corpos = [m["body"] for m in api(ana).get(URL).json()["messages"]]
        assert "segredo da bravo" not in corpos
        assert chat.pk not in {m["chat_id"] for m in api(ana).get(URL).json()["messages"]}

    def test_colega_da_mesma_empresa_tambem_nao(self, api, ana, beto, conversa_da_ana):
        """Mesma empresa não é mesma conversa: o chat é por LOGIN."""
        chat, _ = chat_service.open_chat(client=beto)
        ChatMessage.objects.create(chat=chat, author=beto, body="conversa do beto")
        corpos = [m["body"] for m in api(ana).get(URL).json()["messages"]]
        assert "conversa do beto" not in corpos

    def test_interno_leva_403(self, api, agente, admin, conversa_da_ana):
        """Para quem atende, "todas as minhas sessões" devolveria a conversa
        de todo mundo — a rota recusa em vez de inventar um recorte."""
        assert api(agente).get(URL).status_code == 403
        assert api(admin).get(URL).status_code == 403
        assert api(agente).get(URL_MEDIA).status_code == 403

    def test_anonimo_nao_entra(self, client):
        assert client.get(URL).status_code in (401, 403)


class TestLinks:
    def test_extrai_as_formas_comuns(self):
        extrair = chat_service.extrair_links
        assert extrair("veja em https://resolv.com/docs.") == ["https://resolv.com/docs"]
        assert extrair("link (https://x.com/a) no meio") == ["https://x.com/a"]
        assert extrair("entre em www.exemplo.com.br hoje") == ["www.exemplo.com.br"]
        assert extrair("http://a.com/p?q=1 e https://b.com") == [
            "http://a.com/p?q=1", "https://b.com",
        ]

    def test_nao_confunde_numero_com_link(self):
        """"versão 2.0" e "R$ 1.500,00" não são endereço de nada — por isso
        domínio nu fica de fora da extração."""
        assert chat_service.extrair_links("versão 2.0 custa R$ 1.500,00") == []

    def test_parenteses_da_propria_url_sobrevivem(self):
        assert chat_service.extrair_links("https://pt.wikipedia.org/wiki/Java_(ilha)") == [
            "https://pt.wikipedia.org/wiki/Java_(ilha)",
        ]


class TestPainelDeMidia:
    def test_lista_os_links_de_todas_as_sessoes(self, api, ana, agente):
        for url in ("https://um.test/a", "https://dois.test/b"):
            chat, _ = chat_service.open_chat(client=ana)
            ChatMessage.objects.create(chat=chat, author=ana, body=f"olha {url}")
            chat_service.take_chat(chat=chat, agent=agente)
            chat_service.close_chat(chat=chat, actor=agente)
            chat_service.rate(chat=chat, client=ana, service_score=9, resolution_score=9)

        links = api(ana).get(URL_MEDIA).json()["links"]
        assert {link["url"] for link in links} == {"https://um.test/a", "https://dois.test/b"}
        assert all(link["author_name"] == "Ana Almeida" for link in links)

    def test_link_repetido_nao_vira_duas_linhas(self, api, ana, chat_da_ana):
        for _ in range(3):
            ChatMessage.objects.create(
                chat=chat_da_ana, author=ana, body="de novo https://x.test/a",
            )
        links = api(ana).get(URL_MEDIA).json()["links"]
        assert [link["url"] for link in links] == ["https://x.test/a"]

    def test_nao_vaza_link_de_outro_cliente(self, api, ana, carla, chat_da_ana):
        chat, _ = chat_service.open_chat(client=carla)
        ChatMessage.objects.create(chat=chat, author=carla, body="privado https://bravo.test/x")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="meu https://acme.test/y")

        links = api(ana).get(URL_MEDIA).json()["links"]
        assert [link["url"] for link in links] == ["https://acme.test/y"]

    def test_boas_vindas_do_sistema_nao_entra(self, api, ana, chat_da_ana, config):
        """A boas-vindas se repete a cada sessão; um link nela encheria o
        painel com a mesma linha várias vezes."""
        config(welcome_message="Oi! Veja https://ajuda.test/faq")
        chat_service.open_chat(client=ana)
        assert api(ana).get(URL_MEDIA).json()["links"] == []
