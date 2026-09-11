"""Fase 3: o que a conversa passou a saber sobre si mesma.

Quatro coisas, e todas existem pelo mesmo motivo: o navegador só conhece o
pedaço da conversa que já rolou até a tela.

- BUSCA (`?q=`) roda no servidor. Procurar no que está carregado responde
  "não achei" para algo que existe — o pior tipo de resposta errada.
- JANELA (`?around=`) traz o entorno de UMA mensagem, para poder pular num
  achado antigo sem baixar meses de conversa até chegar nele.
- MÍDIA (`/media/`) lista anexos e links deste atendimento, com os links
  extraídos no servidor pela mesma razão.
- ENTREGA (`delivered_at`) é carimbada pelo DESTINATÁRIO. O servidor sabe
  que gravou, não que alguém recebeu; carimbar no INSERT seria mentir sobre
  a única coisa que o indicador promete.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.chat.models import ChatMessage
from apps.chat.services import chat_service

#: o mesmo PNG mínimo de `test_antivirus.py` — a política de anexo olha o tipo
#: DETECTADO, não a extensão, então um .txt improvisado seria recusado antes de
#: chegar no que estes testes querem checar.
PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def png(nome="captura.png"):
    return SimpleUploadedFile(nome, PNG, content_type="image/png")


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


def falar(chat, autor, corpo, **extra):
    return ChatMessage.objects.create(chat=chat, author=autor, body=corpo, **extra)


class TestBuscaNaConversa:
    def test_acha_no_servidor_o_que_o_navegador_nao_carregou(
        self, em_atendimento, ana, agente, api
    ):
        for i in range(60):
            falar(em_atendimento, ana, f"mensagem de enchimento {i}")
        alvo = falar(em_atendimento, agente, "o número da nota fiscal é 4471")

        r = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q=nota fiscal")
        assert r.status_code == 200
        ids = [m["id"] for m in r.json()["results"]]
        assert ids == [alvo.pk]

    def test_busca_ignora_maiuscula(self, em_atendimento, ana, api):
        falar(em_atendimento, ana, "Meu Boleto venceu")
        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q=boleto")
        assert len(r.json()["results"]) == 1

    def test_apagada_nao_volta_na_busca(self, em_atendimento, ana, agente, api):
        """O corpo sumiu para quem lê; a busca não pode ressuscitá-lo."""
        msg = falar(em_atendimento, ana, "segredo que apaguei")
        chat_service.delete_message(message=msg, actor=ana)
        r = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q=segredo")
        assert r.json()["results"] == []

    def test_busca_nao_atravessa_para_outro_chat(self, em_atendimento, ana, beto, agente, api):
        outro, _ = chat_service.open_chat(client=beto)
        falar(outro, beto, "assunto confidencial do beto")
        r = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q=confidencial")
        assert r.json()["results"] == []


class TestJanelaAoRedor:
    def test_traz_o_entorno_da_mensagem(self, em_atendimento, ana, api):
        msgs = [falar(em_atendimento, ana, f"linha {i}") for i in range(80)]
        centro = msgs[40]
        r = api(ana).get(
            f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?around={centro.pk}&radius=5"
        )
        ids = [m["id"] for m in r.json()]
        assert centro.pk in ids
        assert ids == sorted(ids)  # a thread desenha em ordem crescente
        assert len(ids) == 11  # 5 antes + a própria + 5 depois

    def test_janela_no_comeco_nao_estoura(self, em_atendimento, ana, api):
        msgs = [falar(em_atendimento, ana, f"linha {i}") for i in range(10)]
        r = api(ana).get(
            f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?around={msgs[0].pk}&radius=5"
        )
        assert msgs[0].pk in [m["id"] for m in r.json()]

    def test_around_precisa_ser_id(self, em_atendimento, ana, api):
        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?around=abc")
        assert r.status_code == 400


class TestRespostaCitada:
    def test_a_citacao_vem_montada_do_servidor(self, em_atendimento, ana, agente, api):
        original = falar(em_atendimento, ana, "o pedido 998 não chegou")
        resposta = falar(em_atendimento, agente, "já verifiquei", reply_to=original)

        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/")
        dado = next(m for m in r.json() if m["id"] == resposta.pk)
        assert dado["reply_to"] == original.pk
        assert dado["reply_preview"]["excerpt"] == "o pedido 998 não chegou"
        assert dado["reply_preview"]["author_name"] == "Ana Almeida"

    def test_apagar_o_original_nao_leva_a_resposta_junto(self, em_atendimento, ana, agente, api):
        """SET_NULL e não CASCADE: uma mensagem apagada não pode levar embora
        os trechos de conversa que responderam a ela."""
        original = falar(em_atendimento, ana, "texto original")
        resposta = falar(em_atendimento, agente, "minha resposta", reply_to=original)
        chat_service.delete_message(message=original, actor=ana)

        resposta.refresh_from_db()
        assert resposta.pk and resposta.body == "minha resposta"
        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/")
        dado = next(m for m in r.json() if m["id"] == resposta.pk)
        assert dado["reply_preview"]["is_deleted"] is True
        assert dado["reply_preview"]["excerpt"] == ""  # o corpo apagado não volta pela citação

    def test_anexo_pode_responder(self, em_atendimento, ana, agente, api):
        original = falar(em_atendimento, ana, "manda o comprovante")
        r = api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {
                "files": png("nota.png"),
                "reply_to": original.pk,
            },
            format="multipart",
        )
        assert r.status_code == 201
        assert r.json()["reply_to"] == original.pk

    def test_nao_cita_mensagem_de_outro_chat(self, em_atendimento, ana, beto, agente, api):
        """Aceitar um id qualquer vazaria o trecho de outra conversa dentro
        do preview da citação."""
        outro, _ = chat_service.open_chat(client=beto)
        alheia = falar(outro, beto, "dado do beto")
        r = api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {
                "files": png("x.png"),
                "reply_to": alheia.pk,
            },
            format="multipart",
        )
        assert r.status_code == 201
        assert r.json()["reply_to"] is None


class TestEntregaELeitura:
    def test_o_destinatario_carimba_a_entrega(self, em_atendimento, ana, agente):
        msg = falar(em_atendimento, ana, "chegou?")
        marcados = chat_service.marcar_entregues(
            chat=em_atendimento, actor=agente, ids=[msg.pk]
        )
        msg.refresh_from_db()
        assert marcados == [msg.pk]
        assert msg.delivered_at is not None

    def test_ninguem_entrega_a_propria_mensagem(self, em_atendimento, ana):
        msg = falar(em_atendimento, ana, "eu mesma")
        assert chat_service.marcar_entregues(chat=em_atendimento, actor=ana, ids=[msg.pk]) == []
        msg.refresh_from_db()
        assert msg.delivered_at is None

    def test_reconectar_nao_empurra_o_horario_para_frente(self, em_atendimento, ana, agente):
        msg = falar(em_atendimento, ana, "oi")
        chat_service.marcar_entregues(chat=em_atendimento, actor=agente, ids=[msg.pk])
        msg.refresh_from_db()
        primeiro = msg.delivered_at
        # o mesmo id de novo (uma reconexão reenviando o ack)
        assert chat_service.marcar_entregues(
            chat=em_atendimento, actor=agente, ids=[msg.pk]
        ) == []
        msg.refresh_from_db()
        assert msg.delivered_at == primeiro

    def test_read_devolve_os_ids_para_o_remetente(self, em_atendimento, ana, agente, api):
        msg = falar(em_atendimento, ana, "leia isto")
        r = api(agente).post(f"/api/v1/chat/chats/{em_atendimento.pk}/read/")
        assert r.json()["marked_read"] == 1
        msg.refresh_from_db()
        assert msg.read_at is not None


class TestPainelDeMidia:
    def test_lista_anexo_e_link_deste_atendimento(self, em_atendimento, ana, agente, api):
        falar(em_atendimento, ana, "o rastreio está em https://correios.test/abc123")
        api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {"files": png("nf.png")},
            format="multipart",
        )

        corpo = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/media/").json()
        assert [f["filename"] for f in corpo["files"]] == ["nf.png"]
        assert [ligacao["url"] for ligacao in corpo["links"]] == ["https://correios.test/abc123"]

    def test_o_mesmo_link_repetido_nao_vira_duas_linhas(self, em_atendimento, ana, agente, api):
        falar(em_atendimento, ana, "veja https://x.test/a")
        falar(em_atendimento, ana, "de novo: https://x.test/a")
        corpo = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/media/").json()
        assert len(corpo["links"]) == 1

    def test_link_de_mensagem_apagada_sai_do_painel(self, em_atendimento, ana, agente, api):
        msg = falar(em_atendimento, ana, "link errado https://x.test/errado")
        chat_service.delete_message(message=msg, actor=ana)
        corpo = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/media/").json()
        assert corpo["links"] == []

    def test_painel_nao_mostra_midia_de_outro_chat(self, em_atendimento, beto, agente, api):
        outro, _ = chat_service.open_chat(client=beto)
        falar(outro, beto, "https://x.test/do-beto")
        corpo = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/media/").json()
        assert corpo["links"] == []
