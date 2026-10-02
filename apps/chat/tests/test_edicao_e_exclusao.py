"""Editar e apagar mensagem do chat — mesma forma da rota de ticket, com o
avizo extra de ir pela sala do WebSocket (o chat é tempo real; o ticket não).
"""

import pytest

from apps.chat.models import ChatMessage
from apps.chat.services import chat_service

pytestmark = pytest.mark.django_db


class TestEditar:
    def test_autor_edita_a_propria_mensagem(self, ana, chat_da_ana):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        from rest_framework.test import APIClient
        api = APIClient()
        api.force_authenticate(user=ana)
        resp = api.patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/",
                          {"body": "oi, tudo bem?"}, format="json")
        assert resp.status_code == 200
        msg.refresh_from_db()
        assert msg.body == "oi, tudo bem?"
        assert msg.edited_at is not None
        assert msg.edited_by_id == ana.pk

    def test_outra_pessoa_nao_edita(self, ana, beto, chat_da_ana, api):
        """`beto` é colega de empresa da Ana, mas o chat é por LOGIN — o chat
        dela nem aparece pra ele (404), antes de qualquer regra de autoria."""
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        resp = api(beto).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/",
                                {"body": "hackeado"}, format="json")
        assert resp.status_code == 404
        msg.refresh_from_db()
        assert msg.body == "oi"

    def test_agente_nao_edita_mensagem_do_cliente(self, ana, agente, chat_da_ana, api):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        resp = api(agente).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/",
                                  {"body": "reescrito"}, format="json")
        assert resp.status_code == 400

    def test_mensagem_de_sistema_nao_edita(self, ana, chat_da_ana, api):
        sistema = chat_da_ana.messages.filter(is_system=True).first()
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{sistema.pk}/",
                               {"body": "x"}, format="json")
        assert resp.status_code == 400

    def test_corpo_vazio_e_recusado(self, ana, chat_da_ana, api):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/",
                               {"body": "   "}, format="json")
        assert resp.status_code == 400
        msg.refresh_from_db()
        assert msg.body == "oi"

    def test_ja_apagada_nao_edita_mais(self, ana, chat_da_ana, api):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        chat_service.delete_message(message=msg, actor=ana)
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/",
                               {"body": "de volta"}, format="json")
        assert resp.status_code == 400

    def test_nao_edita_mensagem_antiga_depois_de_mandar_outra(self, ana, chat_da_ana, api):
        """Ainda é dela, ainda não foi apagada — mas já não é a última."""
        antiga = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="ainda aqui?")
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{antiga.pk}/",
                               {"body": "reescrito"}, format="json")
        assert resp.status_code == 400
        antiga.refresh_from_db()
        assert antiga.body == "oi"

    def test_nao_edita_depois_que_o_outro_lado_respondeu(self, ana, agente, chat_da_ana, api):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        minha = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        ChatMessage.objects.create(chat=chat_da_ana, author=agente, body="oi, em que posso ajudar?")
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{minha.pk}/",
                               {"body": "reescrito"}, format="json")
        assert resp.status_code == 400

    def test_edita_a_ultima_mesmo_com_mensagens_anteriores(self, ana, chat_da_ana, api):
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="primeira")
        ultima = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segunda")
        resp = api(ana).patch(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{ultima.pk}/",
                               {"body": "segunda, corrigida"}, format="json")
        assert resp.status_code == 200
        ultima.refresh_from_db()
        assert ultima.body == "segunda, corrigida"


class TestApagar:
    def test_autor_apaga_a_propria_mensagem(self, ana, chat_da_ana, api):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segredo")
        resp = api(ana).delete(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/")
        assert resp.status_code == 200
        msg.refresh_from_db()
        assert msg.body == chat_service.CORPO_APAGADO
        assert msg.deleted_at is not None
        assert msg.deleted_by_id == ana.pk
        # a LINHA continua existindo — não é um delete de verdade
        assert ChatMessage.objects.filter(pk=msg.pk).exists()

    def test_outra_pessoa_nao_apaga(self, ana, beto, chat_da_ana, api):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segredo")
        resp = api(beto).delete(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{msg.pk}/")
        assert resp.status_code == 404
        msg.refresh_from_db()
        assert msg.body == "segredo"

    def test_apaga_mensagem_antiga_mesmo_nao_sendo_a_ultima(self, ana, chat_da_ana, api):
        """Diferente de editar: apagar uma mensagem de trás não reescreve o
        que já foi lido, só some com ela — continua liberado."""
        antiga = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="mais uma")
        resp = api(ana).delete(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/{antiga.pk}/")
        assert resp.status_code == 200
        antiga.refresh_from_db()
        assert antiga.deleted_at is not None

    def test_apaga_os_anexos_junto(self, ana, chat_da_ana):
        from django.core.files.base import ContentFile

        from apps.chat.models import ChatFile, ChatScanStatus

        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segue o print")
        f = ChatFile(message=msg, filename="a.png", content_type="image/png",
                     size_bytes=10, uploaded_by=ana, scan_status=ChatScanStatus.CLEAN)
        f.file.save("a.png", ContentFile(b"x" * 10), save=True)

        chat_service.delete_message(message=msg, actor=ana)
        assert ChatFile.objects.filter(message=msg).count() == 0


class TestContextoDoSerializer:
    """`can_edit` funciona nos DOIS jeitos de contexto que o módulo usa: uma
    view REST manda `request` (padrão do DRF); o ChatConsumer, que não tem
    um `request` de verdade, manda `user` direto. Existe porque um `.data`
    chamado sem NENHUM dos dois (esquecimento comum: `Serializer(obj).data`
    sem `context=`) passa despercebido — `can_edit` só some, não estoura —
    e foi exatamente isso que aconteceu duas vezes no código real antes
    deste teste: na listagem `messages/` e na criação de anexo (`files/`)."""

    def test_context_request(self, ana, chat_da_ana):
        from rest_framework.test import APIRequestFactory

        from apps.chat.serializers import ChatMessageSerializer

        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        req = APIRequestFactory().get("/")
        req.user = ana
        assert ChatMessageSerializer(msg, context={"request": req}).data["can_edit"] is True

    def test_context_user_direto(self, ana, chat_da_ana):
        """O caminho que o ChatConsumer usa de verdade (sem `request`)."""
        from apps.chat.serializers import ChatMessageSerializer

        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        assert ChatMessageSerializer(msg, context={"user": ana}).data["can_edit"] is True

    def test_sem_contexto_nenhum_nao_quebra_so_nega(self, ana, chat_da_ana):
        """Documenta o comportamento seguro do esquecimento: `can_edit` cai
        para False (nega o botão) em vez de estourar — mas os dois lugares
        reais que produziam mensagem (texto pelo socket, anexo pelo REST)
        precisam estar entre os que MANDAM contexto, não entre os que confiam
        neste fallback."""
        from apps.chat.serializers import ChatMessageSerializer

        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        assert ChatMessageSerializer(msg).data["can_edit"] is False


class TestSerializer:
    def test_can_edit_so_para_o_autor(self, ana, agente, chat_da_ana, api):
        """O agente TEM visibilidade sobre o chat (fila única, sem recorte de
        equipe) — vê a mensagem da Ana, mas não pode editá-la."""
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        corpo_ana = api(ana).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/").json()
        corpo_agente = api(agente).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/").json()
        minha = [m for m in corpo_ana if m["body"] == "oi"][0]
        vista_pelo_agente = [m for m in corpo_agente if m["body"] == "oi"][0]
        assert minha["can_edit"] is True
        assert vista_pelo_agente["can_edit"] is False

    def test_can_edit_falso_depois_de_apagada(self, ana, chat_da_ana, api):
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        chat_service.delete_message(message=msg, actor=ana)
        corpo = api(ana).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/").json()
        linha = [m for m in corpo if m["id"] == msg.pk][0]
        assert linha["can_edit"] is False
        assert linha["is_deleted"] is True

    def test_can_edit_falso_quando_nao_e_a_ultima(self, ana, chat_da_ana, api):
        antiga = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi")
        ultima = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="oi de novo")
        corpo = api(ana).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/").json()
        linha_antiga = [m for m in corpo if m["id"] == antiga.pk][0]
        linha_ultima = [m for m in corpo if m["id"] == ultima.pk][0]
        assert linha_antiga["can_edit"] is False
        assert linha_ultima["can_edit"] is True
