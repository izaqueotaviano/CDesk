"""Correção 1: a conversa do agente é POR CLIENTE, a do cliente por abertura.

A máquina de costura já existia — era a "conversa contínua" do portal. O que
mudou é quem a recebe: agora o console também, apontando para um cliente, e
é quem LÊ que decide o conteúdo (o agente enxerga nota interna, o cliente
não).

O que se protege aqui é sobretudo o que NÃO mudou: cada abertura continua
uma linha no banco, com o próprio ciclo, e a visão do cliente continua
separada por atendimento. O agrupamento é de apresentação.
"""

import pytest

from apps.chat.models import Chat, ChatCloseReason, ChatMessage, ChatRating, ChatStatus
from apps.chat.services import chat_service
from apps.tickets.services import ticket_service


def encerrar_com_nota(chat, cliente):
    """Fecha e avalia — o cliente só pode abrir outro chat depois de avaliar."""
    chat_service.close_chat(chat=chat, actor=cliente)
    ChatRating.objects.create(
        chat=chat, service_score=9, resolution_score=9, justification=""
    )


@pytest.fixture
def duas_aberturas(ana, agente, agente2):
    """O cenário do pedido: duas aberturas do MESMO cliente, agentes
    diferentes — uma encerrada, uma em andamento."""
    primeiro, _ = chat_service.open_chat(client=ana)
    chat_service.take_chat(chat=primeiro, agent=agente)
    ChatMessage.objects.create(chat=primeiro, author=ana, body="primeira conversa")
    encerrar_com_nota(primeiro, ana)

    segundo, _ = chat_service.open_chat(client=ana)
    chat_service.take_chat(chat=segundo, agent=agente2)
    ChatMessage.objects.create(chat=segundo, author=ana, body="segunda conversa")
    return primeiro, segundo


class TestOAgenteVeUmaThreadSo:
    def test_as_duas_aberturas_vem_numa_rolagem(self, duas_aberturas, ana, agente, api):
        r = api(agente).get(f"/api/v1/chat/timeline/?client={ana.pk}")
        assert r.status_code == 200
        corpos = [m["body"] for m in r.json()["messages"]]
        assert "primeira conversa" in corpos
        assert "segunda conversa" in corpos

    def test_os_marcadores_trazem_quem_atendeu_cada_uma(self, duas_aberturas, ana, agente, api):
        """O responsável muda entre aberturas — sem isso no marcador, duas
        conversas com agentes diferentes viram uma massa só."""
        primeiro, segundo = duas_aberturas
        sessoes = api(agente).get(f"/api/v1/chat/timeline/?client={ana.pk}").json()["sessions"]
        por_id = {s["id"]: s for s in sessoes}
        assert por_id[primeiro.pk]["agent_name"] == "Samuel Suporte"
        assert por_id[segundo.pk]["agent_name"] == "Fátima Financeiro"
        assert por_id[primeiro.pk]["closed_at"] is not None
        assert por_id[segundo.pk]["status"] == ChatStatus.ACTIVE

    def test_o_agente_ve_a_nota_interna_na_thread(self, duas_aberturas, ana, agente, api):
        primeiro, _ = duas_aberturas
        ChatMessage.objects.create(
            chat=primeiro, author=agente, body="SEGREDO da equipe", is_internal_note=True
        )
        corpo = api(agente).get(f"/api/v1/chat/timeline/?client={ana.pk}").json()
        assert "SEGREDO" in str(corpo["messages"])

    def test_cliente_nao_le_a_conversa_de_outra_pessoa(self, duas_aberturas, ana, beto, api):
        assert api(beto).get(f"/api/v1/chat/timeline/?client={ana.pk}").status_code == 403

    def test_interno_sem_cliente_continua_recusado(self, agente, api):
        """"Todas as minhas sessões" não quer dizer nada para quem atende
        várias pessoas — devolveria a conversa de todo mundo."""
        assert api(agente).get("/api/v1/chat/timeline/").status_code == 403

    def test_cliente_inexistente_e_404(self, agente, api):
        assert api(agente).get("/api/v1/chat/timeline/?client=999999").status_code == 404

    def test_pedir_um_interno_como_cliente_e_404(self, agente, agente2, api):
        assert api(agente).get(f"/api/v1/chat/timeline/?client={agente2.pk}").status_code == 404

    def test_o_marcador_diz_o_motivo_do_encerramento(self, duas_aberturas, ana, agente, api):
        primeiro, _ = duas_aberturas
        motivo = ChatCloseReason.objects.create(name="Resolvido", slug="resolvido")
        Chat.objects.filter(pk=primeiro.pk).update(close_reason=motivo)

        sessoes = api(agente).get(f"/api/v1/chat/timeline/?client={ana.pk}").json()["sessions"]
        por_id = {s["id"]: s for s in sessoes}
        assert por_id[primeiro.pk]["close_reason_name"] == "Resolvido"

    def test_quando_virou_chamado_o_marcador_leva_o_protocolo(
        self, duas_aberturas, ana, agente, suporte, api
    ):
        """É o protocolo do chamado que a pessoa procura depois, não o número
        do chat."""
        primeiro, _ = duas_aberturas
        chamado = ticket_service.create_from_chat(
            chat=primeiro, team=suporte, actor=agente
        )

        sessoes = api(agente).get(f"/api/v1/chat/timeline/?client={ana.pk}").json()["sessions"]
        por_id = {s["id"]: s for s in sessoes}
        assert por_id[primeiro.pk]["ticket_reference"] == chamado.reference


class TestAVisaoDoClienteNaoMuda:
    def test_o_cliente_continua_vendo_por_abertura(self, duas_aberturas, ana, api):
        """Cada abertura tem seu próprio ciclo de avaliação — para o cliente
        elas são atendimentos diferentes, e continuam separadas."""
        primeiro, segundo = duas_aberturas
        corpo = api(ana).get("/api/v1/chat/chats/").json()
        chats = corpo if isinstance(corpo, list) else corpo["results"]
        ids = {c["id"] for c in chats}
        assert {primeiro.pk, segundo.pk} <= ids

    def test_a_conversa_continua_do_cliente_segue_sendo_dele(self, duas_aberturas, ana, api):
        r = api(ana).get("/api/v1/chat/timeline/")
        assert r.status_code == 200
        assert len(r.json()["messages"]) > 0

    def test_cada_abertura_continua_uma_linha_no_banco(self, duas_aberturas, ana):
        """A modelagem não mudou: agrupar é da apresentação."""
        assert Chat.objects.filter(client=ana).count() == 2


class TestCaixaDeEntradaAgrupada:
    def test_uma_linha_por_cliente_e_nao_por_abertura(self, duas_aberturas, ana, agente, api):
        linhas = api(agente).get("/api/v1/chat/chats/clients/").json()
        das_ana = [ligacao for ligacao in linhas if ligacao["client_id"] == ana.pk]
        assert len(das_ana) == 1
        assert das_ana[0]["sessions"] == 2

    def test_traz_previa_e_com_quem_falar_agora(self, duas_aberturas, ana, agente, api):
        _, segundo = duas_aberturas
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        assert linha["last_message_preview"] == "segunda conversa"
        # é no chat ABERTO que a mensagem nova entra
        assert linha["open_chat_id"] == segundo.pk
        assert linha["client_name"] == "Ana Almeida"

    def test_ordena_pela_atividade_mais_recente(self, duas_aberturas, ana, beto, agente, api):
        outro, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=outro, agent=agente)
        ChatMessage.objects.create(chat=outro, author=beto, body="cheguei depois")

        linhas = api(agente).get("/api/v1/chat/chats/clients/").json()
        assert linhas[0]["client_id"] == beto.pk

    def test_a_fila_nao_entra_na_caixa(self, ana, agente, api):
        """Fila é trabalho a fazer, não conversa em andamento — e some assim
        que alguém pega. Continua na seção dela."""
        chat_service.open_chat(client=ana)  # fica em QUEUED
        linhas = api(agente).get("/api/v1/chat/chats/clients/").json()
        assert [ligacao for ligacao in linhas if ligacao["client_id"] == ana.pk] == []

    def test_sem_chat_aberto_a_linha_continua_com_o_historico(
        self, duas_aberturas, ana, agente, api
    ):
        _, segundo = duas_aberturas
        encerrar_com_nota(segundo, ana)
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        assert linha["open_chat_id"] is None
        assert linha["sessions"] == 2

    def test_nao_lidas_somam_todas_as_aberturas(self, duas_aberturas, ana, agente, api):
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        # as duas mensagens da Ana, das duas aberturas
        assert linha["unread"] == 2

    def test_nota_interna_nao_entra_na_previa_nem_na_contagem(
        self, duas_aberturas, ana, agente, api
    ):
        _, segundo = duas_aberturas
        ChatMessage.objects.create(
            chat=segundo, author=agente, body="SEGREDO", is_internal_note=True
        )
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        # a nota é do próprio agente: nunca conta como "não lida" para ele
        assert linha["unread"] == 2

    def test_traz_a_abertura_mais_recente_mesmo_sem_nenhuma_viva(
        self, duas_aberturas, ana, agente, api
    ):
        """Sem chat aberto a thread ainda tem de abrir em algum lugar — na
        última, em leitura. Sem isto a conversa sumiria da tela."""
        _, segundo = duas_aberturas
        encerrar_com_nota(segundo, ana)
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        assert linha["open_chat_id"] is None
        assert linha["last_chat_id"] == segundo.pk

    def test_cliente_nao_acessa_a_caixa_do_console(self, ana, api):
        assert api(ana).get("/api/v1/chat/chats/clients/").status_code == 403


class TestPresencaDeQuemAtende:
    def test_o_cliente_ve_a_disponibilidade_do_agente(self, duas_aberturas, ana, api):
        """"O Samuel ainda está aí?" é a pergunta que decide entre esperar a
        resposta e voltar depois."""
        _, segundo = duas_aberturas
        r = api(ana).get(f"/api/v1/chat/chats/{segundo.pk}/")
        assert "agent_presence" in r.json()

    def test_a_caixa_traz_a_presenca_do_cliente(self, duas_aberturas, ana, agente, api):
        linha = next(
            ligacao
            for ligacao in api(agente).get("/api/v1/chat/chats/clients/").json()
            if ligacao["client_id"] == ana.pk
        )
        assert linha["client_presence"] in {"available", "away", "offline"}
