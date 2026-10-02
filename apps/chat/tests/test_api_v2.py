"""API REST do chat v2: escopo, bloqueio por pendência na resposta, macros,
config e relatórios."""

import pytest

from apps.chat.models import ChatMessage, ClientQuickReply
from apps.chat.services import chat_service
from apps.tickets.models import TicketMacro

pytestmark = pytest.mark.django_db(transaction=True)


class TestEscopo:
    def test_cliente_so_ve_os_proprios_chats(self, api, ana, carla, chat_da_ana):
        resp = api(carla).get("/api/v1/chat/chats/")
        assert resp.json()["count"] == 0
        assert api(ana).get("/api/v1/chat/chats/").json()["count"] == 1

    def test_agente_ve_a_fila_inteira_sem_recorte_de_equipe(
        self, api, agente, chat_da_ana,
    ):
        resp = api(agente).get("/api/v1/chat/chats/?status=queued")
        assert resp.json()["count"] == 1

    def test_chat_de_outro_cliente_da_404(self, api, carla, chat_da_ana):
        resp = api(carla).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/")
        assert resp.status_code == 404  # não vaza existência

    def test_nome_interno_nao_sai_pro_cliente(self, api, ana, agente, chat_da_ana):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_da_ana.name = "Cliente confuso de novo"
        chat_da_ana.save(update_fields=["name"])

        do_agente = api(agente).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/").json()
        do_cliente = api(ana).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/").json()
        assert do_agente["name"] == "Cliente confuso de novo"
        assert do_cliente["name"] == ""

    def test_nota_do_agente_nunca_sai_pro_cliente(self, api, ana, agente, chat_da_ana):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente, agent_score=2)
        do_cliente = api(ana).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/").json()
        assert "agent_score" not in do_cliente


class TestAberturaBloqueada:
    def test_resposta_do_bloqueio_lista_os_pendentes(self, api, ana, chat_da_ana, agente):
        # só chat ATENDIDO cobra nota — pega antes de fechar
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=ana)  # sem nota

        resp = api(ana).post("/api/v1/chat/chats/", {}, format="json")
        assert resp.status_code == 400
        corpo = resp.json()
        assert "avali" in corpo["detail"].lower()
        assert [c["id"] for c in corpo["pending_ratings"]] == [chat_da_ana.pk]

    def test_avaliar_pelo_endpoint_destrava(self, api, ana, chat_da_ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        resp = api(ana).post(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/rate/",
            {"service_score": 9, "resolution_score": 9},
            format="json",
        )
        assert resp.status_code == 200
        assert api(ana).post("/api/v1/chat/chats/", {}, format="json").status_code == 201

    def test_nota_baixa_pelo_endpoint_exige_justificativa(self, api, ana, chat_da_ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        resp = api(ana).post(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/rate/",
            {"service_score": 2, "resolution_score": 9},
            format="json",
        )
        assert resp.status_code == 400


class TestMacro:
    def test_macro_preenche_sem_apagar_o_que_ja_existe(
        self, api, agente, chat_da_ana, admin,
    ):
        # cadastro ÚNICO desde a unificação — a mesma macro serve chat e chamado
        macro = TicketMacro.objects.create(
            name="Loja fora do ar", chat_name="Loja fora do ar", priority="urgent",
        )
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_da_ana.name = "Nome que o agente já deu"
        chat_da_ana.save(update_fields=["name"])

        resp = api(agente).post(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/apply-macro/",
            {"macro_id": macro.pk}, format="json",
        )
        assert resp.status_code == 200
        corpo = resp.json()
        assert corpo["priority"] == "urgent"                 # preencheu
        assert corpo["name"] == "Nome que o agente já deu"   # não zerou

    def test_solicitante_vem_preenchido_dos_dados_do_login(
        self, api, agente, chat_da_ana,
    ):
        """O campo Solicitante não se digita: nome/email/telefone/empresa
        vêm do cliente logado, direto no payload do chat."""
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        corpo = api(agente).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/").json()
        assert corpo["client_name"] == "Ana Almeida"
        assert corpo["client_email"] == "ana@acme.test"
        assert corpo["company_name"] == "Acme"


class TestConfigEModeração:
    def test_config_edita_sem_deploy(self, api, admin):
        resp = api(admin).put("/api/v1/chat/config/", {
            "queue_timeout_minutes": 7, "max_chats_per_agent": 5,
        }, format="json")
        assert resp.status_code == 200
        assert resp.json()["queue_timeout_minutes"] == 7

    def test_gatilho_fora_da_escala_e_recusado(self, api, admin):
        resp = api(admin).put("/api/v1/chat/config/", {
            "score_min": 0, "score_max": 10, "low_score_threshold": 11,
        }, format="json")
        assert resp.status_code == 400

    def test_agente_le_mas_nao_escreve_config(self, api, agente):
        assert api(agente).get("/api/v1/chat/config/").status_code == 200
        resp = api(agente).put("/api/v1/chat/config/", {
            "queue_timeout_minutes": 1,
        }, format="json")
        assert resp.status_code == 403

    def test_cliente_ve_so_a_fatia_publica_da_config(self, api, ana):
        """A config deixou de ser 403 para o cliente DE PROPÓSITO: o modal de
        avaliação dele desenha a régua com score_min/max. O que continua
        interno é a operação — e as palavras banidas."""
        resp = api(ana).get("/api/v1/chat/config/")
        assert resp.status_code == 200
        assert "default_team" not in resp.data
        assert api(ana).get("/api/v1/chat/banned-words/").status_code == 403

    def test_crud_de_palavras_banidas(self, api, admin):
        resp = api(admin).post("/api/v1/chat/banned-words/",
                               {"word": "  Droga  "}, format="json")
        assert resp.status_code == 201
        assert resp.json()["word"] == "droga"  # normalizada


class TestRelatorios:
    def test_por_empresa_e_por_agente(self, api, ana, agente, admin, chat_da_ana):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente, agent_score=7)
        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=9, resolution_score=6)

        por_empresa = api(admin).get("/api/v1/chat/reports/?by=company").json()
        assert por_empresa[0]["rotulo"] == "Acme"
        assert por_empresa[0]["fechados"] == 1
        assert por_empresa[0]["nota_atendimento"] == 9.0

        por_agente = api(admin).get("/api/v1/chat/reports/?by=agent").json()
        assert por_agente[0]["rotulo"] == "Samuel Suporte"
        assert por_agente[0]["nota_do_agente"] == 7.0

    def test_cliente_nao_acessa_relatorio(self, api, ana):
        assert api(ana).get("/api/v1/chat/reports/").status_code == 403


class TestMensagensREST:
    def test_historico_incremental(self, api, ana, chat_da_ana):
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="primeira")
        ultima = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segunda")
        resp = api(ana).get(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/?after={ultima.pk - 1}"
        )
        corpos = [m["body"] for m in resp.json()]
        assert corpos == ["segunda"]

    def test_sem_parametro_devolve_a_conversa_inteira(self, api, ana, chat_da_ana):
        for i in range(12):
            ChatMessage.objects.create(chat=chat_da_ana, author=ana, body=f"m{i}")
        corpos = [m["body"] for m in api(ana).get(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/"
        ).json()]
        # a de boas-vindas do serviço vem junto; o que importa é que nenhuma
        # das 12 sumiu — histórico não é podado no servidor
        assert [c for c in corpos if c.startswith("m")] == [f"m{i}" for i in range(12)]

    def test_limit_devolve_o_rabo_em_ordem_crescente(self, api, ana, chat_da_ana):
        for i in range(10):
            ChatMessage.objects.create(chat=chat_da_ana, author=ana, body=f"m{i}")
        corpos = [m["body"] for m in api(ana).get(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/?limit=3"
        ).json()]
        assert corpos == ["m7", "m8", "m9"]

    def test_before_pagina_para_tras(self, api, ana, chat_da_ana):
        criadas = [
            ChatMessage.objects.create(chat=chat_da_ana, author=ana, body=f"m{i}")
            for i in range(10)
        ]
        corpos = [m["body"] for m in api(ana).get(
            f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/"
            f"?before={criadas[5].pk}&limit=2"
        ).json()]
        # as duas IMEDIATAMENTE anteriores à âncora, ainda em ordem de leitura
        assert corpos == ["m3", "m4"]

    def test_parametro_invalido_e_400_e_nao_500(self, api, ana, chat_da_ana):
        url = f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/"
        assert api(ana).get(f"{url}?before=abc").status_code == 400
        assert api(ana).get(f"{url}?limit=0").status_code == 400
        assert api(ana).get(f"{url}?limit=x").status_code == 400


class TestHistoricoDeConversas:
    """Todas as conversas de uma pessoa — o "histórico do WhatsApp"."""

    def test_agente_lista_as_conversas_do_cliente(self, api, agente, ana, chat_da_ana):
        from apps.chat.services import chat_service

        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        # avaliar destrava a abertura da segunda conversa (regra do serviço)
        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=10, resolution_score=10)
        segundo, _ = chat_service.open_chat(client=ana)

        resp = api(agente).get(f"/api/v1/chat/chats/?client={ana.pk}")
        ids = [c["id"] for c in resp.json()["results"]]
        assert set(ids) == {chat_da_ana.pk, segundo.pk}

    def test_cliente_nao_enxerga_a_conversa_de_outro_por_esse_filtro(
        self, api, ana, beto,
    ):
        from apps.chat.services import chat_service

        chat_service.open_chat(client=ana)
        do_beto, _ = chat_service.open_chat(client=beto)
        resp = api(ana).get(f"/api/v1/chat/chats/?client={beto.pk}")
        assert resp.json()["results"] == []

    def test_client_invalido_e_400(self, api, agente):
        assert api(agente).get("/api/v1/chat/chats/?client=abc").status_code == 400


class TestMacroUnificada:
    """A macro é UM cadastro só, servindo chamado e chat.

    Eram dois modelos quase idênticos e o do chat ficou sem tela nenhuma —
    o seletor "Aplicar macro" do chat nascia sempre vazio. Estes testes
    prendem a unificação: se alguém recriar um catálogo separado, quebram.
    """

    def test_mesma_macro_aparece_nas_duas_rotas(self, api, agente):
        from apps.tickets.models import TicketMacro

        macro = TicketMacro.objects.create(
            name="Pedir print do erro",
            body="Olá {{solicitante}}, pode mandar um print?",
            chat_name="Erro sem print",
        )

        do_chat = api(agente).get("/api/v1/chat/macros/").json()
        do_chamado = api(agente).get("/api/v1/settings/ticket-macros/").json()

        ids_chat = {m["id"] for m in do_chat["results"]}
        ids_chamado = {m["id"] for m in do_chamado["results"]}
        assert macro.pk in ids_chat
        assert ids_chat == ids_chamado, "as duas rotas precisam servir o mesmo cadastro"

    def test_as_duas_rotas_expoem_body_e_chat_name(self, api, agente):
        from apps.tickets.models import TicketMacro

        TicketMacro.objects.create(
            name="Token renovado", body="Texto pronto", chat_name="Token",
        )
        for rota in ("/api/v1/chat/macros/", "/api/v1/settings/ticket-macros/"):
            item = api(agente).get(rota).json()["results"][0]
            # `body` era só do chamado e `chat_name` só do chat; depois da
            # unificação os dois campos existem nos dois lados
            assert "body" in item, rota
            assert "chat_name" in item, rota


class TestAtalhosDeMensagem:
    """`/chat/quick-replies/` — o CLIENTE lê (é quem usa), o admin gerencia.

    A permissão é a parte que importa: o irmão desta view
    (`BannedWordViewSet`) exige `PANEL_ACCESS` para ler, e copiar aquela
    permissão por reflexo daria 403 no portal — justamente na função que o
    recurso existe para servir.
    """

    def test_cliente_le_os_atalhos(self, api, ana):
        ClientQuickReply.objects.create(rotulo="Pedido", texto="Meu pedido nº ")
        resp = api(ana).get("/api/v1/chat/quick-replies/")
        assert resp.status_code == 200
        assert [r["rotulo"] for r in resp.json()["results"]] == ["Pedido"]

    def test_cliente_nao_ve_atalho_desligado(self, api, ana):
        """Atalho inativo é decisão de operação, não algo para o cliente
        descobrir que existe."""
        ClientQuickReply.objects.create(rotulo="Ativo", texto="a", is_active=True)
        ClientQuickReply.objects.create(rotulo="Desligado", texto="b", is_active=False)
        corpo = api(ana).get("/api/v1/chat/quick-replies/").json()["results"]
        assert [r["rotulo"] for r in corpo] == ["Ativo"]

    def test_interno_ve_tambem_os_desligados(self, api, agente):
        """Quem administra precisa enxergar o que desligou para religar."""
        ClientQuickReply.objects.create(rotulo="Desligado", texto="b", is_active=False)
        corpo = api(agente).get("/api/v1/chat/quick-replies/").json()["results"]
        assert [r["rotulo"] for r in corpo] == ["Desligado"]

    def test_cliente_nao_escreve(self, api, ana):
        resp = api(ana).post(
            "/api/v1/chat/quick-replies/", {"rotulo": "X", "texto": "y"}, format="json",
        )
        assert resp.status_code == 403

    def test_agente_nao_escreve(self, api, agente):
        """A leitura foi aberta; a escrita continua atrás do admin."""
        resp = api(agente).post(
            "/api/v1/chat/quick-replies/", {"rotulo": "X", "texto": "y"}, format="json",
        )
        assert resp.status_code == 403

    def test_contexto_separa_os_dois_catalogos(self, api, ana):
        """O compositor do CHAMADO não pode oferecer a frase que ABRE uma
        conversa: respondida a uma pergunta do atendimento, ela é um
        não-sequitur, e o admin não teria como impedir."""
        ClientQuickReply.objects.create(
            contexto=ClientQuickReply.Contexto.CHAT,
            rotulo="Problema com um pedido", texto="Estou com um problema no pedido nº ",
        )
        ClientQuickReply.objects.create(
            contexto=ClientQuickReply.Contexto.TICKET,
            rotulo="Ainda estou com o problema", texto="O problema continua acontecendo. ",
        )
        cliente = api(ana)
        chat = cliente.get("/api/v1/chat/quick-replies/?contexto=chat").json()["results"]
        chamado = cliente.get("/api/v1/chat/quick-replies/?contexto=ticket").json()["results"]
        assert [r["rotulo"] for r in chat] == ["Problema com um pedido"]
        assert [r["rotulo"] for r in chamado] == ["Ainda estou com o problema"]
        # sem o parâmetro continua devolvendo tudo — é o que a tela de
        # cadastro do admin precisa ver
        assert cliente.get("/api/v1/chat/quick-replies/").json()["count"] == 2

    def test_mesmo_rotulo_cabe_nos_dois_contextos(self, api, ana):
        """A unicidade é por contexto: um catálogo não pode bloquear o
        cadastro do outro."""
        for contexto in ("chat", "ticket"):
            ClientQuickReply.objects.create(contexto=contexto, rotulo="Segue o print", texto="x")
        assert api(ana).get("/api/v1/chat/quick-replies/").json()["count"] == 2

    def test_admin_cadastra(self, api, admin):
        resp = api(admin).post(
            "/api/v1/chat/quick-replies/",
            {"rotulo": "Cobrança", "texto": "Dúvida sobre "}, format="json",
        )
        assert resp.status_code == 201
