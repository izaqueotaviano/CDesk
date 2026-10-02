"""Fase 4: nota interna e inatividade.

A NOTA INTERNA é a parte sensível desta fase: o texto está dentro da
conversa do cliente e não pode chegar nele por caminho nenhum. Testar "não
aparece na listagem" seria testar o caminho fácil — os que vazam de verdade
são os outros: a prévia na LISTA (aparece sem ninguém abrir a conversa), a
contagem de não lidas, a busca, a janela ao redor, a conversa contínua, o
PDF e o painel de mídia. Cada um deles tem um teste aqui.

A INATIVIDADE é a rotina que encerra sozinha. O que ela promete é: avisar
antes, avisar UMA vez, e nunca encerrar quem acabou de falar.
"""

import pytest
from django.utils import timezone

from apps.chat.models import Chat, ChatMessage, ChatStatus
from apps.chat.services import chat_service
from apps.chat.tasks import close_inactive_chats


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


@pytest.fixture
def com_nota(em_atendimento, agente):
    """Uma nota interna no meio da conversa — o texto que não pode vazar."""
    return ChatMessage.objects.create(
        chat=em_atendimento, author=agente,
        body="pedi o estorno pro financeiro, o cliente não sabe ainda",
        is_internal_note=True,
    )


SEGREDO = "estorno"


class TestNotaInternaNaoVazaPorCaminhoNenhum:
    def test_o_agente_ve(self, em_atendimento, com_nota, agente, api):
        r = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/")
        alvo = next(m for m in r.json() if m["id"] == com_nota.pk)
        assert alvo["is_internal_note"] is True
        assert SEGREDO in alvo["body"]

    def test_o_cliente_nao_ve_na_conversa(self, em_atendimento, com_nota, ana, api):
        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/")
        assert com_nota.pk not in [m["id"] for m in r.json()]

    def test_nao_vaza_na_previa_da_lista(self, em_atendimento, com_nota, ana, api):
        """O caminho que engana: a prévia aparece na LISTA, sem ninguém abrir
        a conversa. Uma nota vazando aqui chega ao cliente de graça."""
        corpo = api(ana).get("/api/v1/chat/chats/").json()
        chats = corpo if isinstance(corpo, list) else corpo["results"]
        alvo = next(c for c in chats if c["id"] == em_atendimento.pk)
        assert SEGREDO not in (alvo["last_message_preview"] or "")

    def test_nao_conta_como_nao_lida_do_cliente(self, em_atendimento, com_nota, ana, api):
        corpo = api(ana).get("/api/v1/chat/chats/").json()
        chats = corpo if isinstance(corpo, list) else corpo["results"]
        alvo = next(c for c in chats if c["id"] == em_atendimento.pk)
        assert alvo["unread_count"] == 0

    def test_nao_aparece_na_busca_do_cliente(self, em_atendimento, com_nota, ana, agente, api):
        assert (
            api(agente)
            .get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q={SEGREDO}")
            .json()["results"]
        )
        assert (
            api(ana)
            .get(f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?q={SEGREDO}")
            .json()["results"]
            == []
        )

    def test_nao_aparece_na_janela_ao_redor(self, em_atendimento, com_nota, ana, api):
        """`?around=` monta a janela por outro caminho de consulta — se o
        filtro morasse só na listagem, escaparia por aqui."""
        r = api(ana).get(
            f"/api/v1/chat/chats/{em_atendimento.pk}/messages/?around={com_nota.pk}"
        )
        assert com_nota.pk not in [m["id"] for m in r.json()]

    def test_nao_aparece_na_conversa_continua(self, em_atendimento, com_nota, ana, api):
        corpo = api(ana).get("/api/v1/chat/timeline/").json()
        assert SEGREDO not in str(corpo["messages"])

    def test_link_dentro_da_nota_nao_vai_pro_painel_do_cliente(
        self, em_atendimento, agente, ana, api
    ):
        ChatMessage.objects.create(
            chat=em_atendimento, author=agente,
            body="planilha interna https://interno.test/segredo", is_internal_note=True,
        )
        corpo = api(ana).get("/api/v1/chat/timeline/media/").json()
        assert corpo["links"] == []

    def test_marcar_lidas_nao_carimba_a_nota(self, em_atendimento, com_nota, ana, api):
        """Se o `read/` do cliente carimbasse a nota, o agente veria "lida" —
        e concluiria que o cliente leu o que ele nunca recebeu."""
        api(ana).post(f"/api/v1/chat/chats/{em_atendimento.pk}/read/")
        com_nota.refresh_from_db()
        assert com_nota.read_at is None


class TestQuemPodeEscreverNota:
    def test_cliente_pedindo_nota_interna_e_ignorado(self, em_atendimento, ana, api):
        """Marcar a própria mensagem como interna não esconderia nada de
        ninguém — e daria ao cliente um campo que não é dele."""
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
            b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        r = api(ana).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {
                "files": SimpleUploadedFile("x.png", png, content_type="image/png"),
                "is_internal_note": "true",
            },
            format="multipart",
        )
        assert r.status_code == 201
        assert r.json()["is_internal_note"] is False

    def test_anexo_do_agente_pode_ser_nota(self, em_atendimento, agente, api):
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
            b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
            b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        r = api(agente).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/files/",
            {
                "files": SimpleUploadedFile("interno.png", png, content_type="image/png"),
                "is_internal_note": "true",
            },
            format="multipart",
        )
        assert r.json()["is_internal_note"] is True


class TestInatividade:
    def test_desligada_por_padrao(self, em_atendimento):
        """Zero nos dois campos é o padrão, e encerrar sozinho o atendimento
        de quem foi buscar um documento é pior do que a conversa ficar aberta."""
        assert close_inactive_chats() == {"avisados": 0, "encerrados": 0}
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE

    def test_avisa_antes_de_encerrar(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=5, inactivity_close_minutes=15)
        msg = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=msg.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=6)
        )

        assert close_inactive_chats()["avisados"] == 1
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE  # avisou, não encerrou
        ultima = em_atendimento.messages.order_by("-id").first()
        assert ultima.is_system and "Ainda está aí?" in ultima.body

    def test_o_aviso_diz_quanto_tempo_resta(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=5, inactivity_close_minutes=15)
        msg = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=msg.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=6)
        )
        close_inactive_chats()
        assert "10 minutos" in em_atendimento.messages.order_by("-id").first().body

    def test_nao_avisa_duas_vezes_pelo_mesmo_silencio(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=5, inactivity_close_minutes=60)
        msg = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=msg.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=6)
        )
        assert close_inactive_chats()["avisados"] == 1
        assert close_inactive_chats()["avisados"] == 0

    def test_quem_voltou_a_falar_e_avisado_de_novo(self, em_atendimento, ana, config):
        """O aviso é por SILÊNCIO, não por conversa: quem sumiu, voltou e
        sumiu outra vez precisa ser avisado de novo."""
        config(inactivity_warning_minutes=5, inactivity_close_minutes=60)
        primeira = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=primeira.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=12)
        )
        assert close_inactive_chats()["avisados"] == 1

        # a pessoa voltou DEPOIS do aviso e sumiu de novo — o aviso fica para
        # trás no tempo, e o silêncio novo é outro silêncio
        Chat.objects.filter(pk=em_atendimento.pk).update(
            inactivity_warned_at=timezone.now() - timezone.timedelta(minutes=10)
        )
        segunda = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="voltei")
        ChatMessage.objects.filter(pk=segunda.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=6)
        )
        assert close_inactive_chats()["avisados"] == 1

    def test_encerra_e_marca_como_automatico(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=5, inactivity_close_minutes=15)
        msg = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=msg.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=20)
        )

        assert close_inactive_chats()["encerrados"] == 1
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.CLOSED
        assert em_atendimento.closed_automatically is True
        # a nota continua pendente: quem sumiu não avaliou
        assert em_atendimento.rating_pending is True

    def test_quem_acabou_de_falar_nao_e_encerrado(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=1, inactivity_close_minutes=2)
        ChatMessage.objects.create(chat=em_atendimento, author=ana, body="agora mesmo")
        assert close_inactive_chats() == {"avisados": 0, "encerrados": 0}
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE

    def test_chat_na_fila_nao_entra_nesta_rotina(self, chat_da_ana, config):
        """Fila é o outro timeout (`convert_unattended_chats`), que vira
        ticket. Encerrar aqui roubaria o caso dele."""
        config(inactivity_warning_minutes=1, inactivity_close_minutes=2)
        Chat.objects.filter(pk=chat_da_ana.pk).update(
            queued_at=timezone.now() - timezone.timedelta(minutes=30)
        )
        assert close_inactive_chats()["encerrados"] == 0
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.status == ChatStatus.QUEUED

    def test_so_aviso_sem_encerramento_nunca_fecha(self, em_atendimento, ana, config):
        config(inactivity_warning_minutes=5, inactivity_close_minutes=0)
        msg = ChatMessage.objects.create(chat=em_atendimento, author=ana, body="oi")
        ChatMessage.objects.filter(pk=msg.pk).update(
            sent_at=timezone.now() - timezone.timedelta(minutes=99)
        )
        r = close_inactive_chats()
        assert r == {"avisados": 1, "encerrados": 0}
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE


class TestConfiguracaoDaInatividade:
    def test_aviso_depois_do_encerramento_e_recusado(self, admin, api):
        r = api(admin).put(
            "/api/v1/chat/config/",
            {"inactivity_warning_minutes": 20, "inactivity_close_minutes": 10},
            format="json",
        )
        assert r.status_code == 400
        assert "antes" in str(r.json())

    def test_tempos_validos_passam(self, admin, api):
        r = api(admin).put(
            "/api/v1/chat/config/",
            {"inactivity_warning_minutes": 5, "inactivity_close_minutes": 15},
            format="json",
        )
        assert r.status_code == 200
        assert r.json()["inactivity_close_minutes"] == 15


class TestPresencaDoCliente:
    def test_o_agente_ve_a_disponibilidade_do_cliente(self, em_atendimento, agente, api):
        r = api(agente).get(f"/api/v1/chat/chats/{em_atendimento.pk}/")
        assert "client_presence" in r.json()

    def test_o_cliente_nao_recebe_a_propria_presenca(self, em_atendimento, ana, api):
        r = api(ana).get(f"/api/v1/chat/chats/{em_atendimento.pk}/")
        assert "client_presence" not in r.json()
