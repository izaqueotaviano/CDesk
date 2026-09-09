"""Fase 2: encerrar avaliando, numa transação só.

A regra do brief é literal — "somente finalizar o atendimento depois que a
avaliação for salva com sucesso". Encerrar primeiro e avaliar depois, em duas
chamadas, deixa a janela onde o chat fecha e a nota se perde. Aqui as duas
coisas são uma transação: se a avaliação for recusada, o encerramento desfaz
junto e o cliente continua na conversa com o que digitou.

Quando quem encerra é o AGENTE (ou o sistema), não há avaliação no ato — o
cliente pode nem estar na tela. A nota fica pendente e o portal a cobra na
próxima entrada, que é o comportamento que `rating_pending` já sustentava.
"""

import pytest

from apps.chat.models import ChatRating, ChatStatus
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation


@pytest.fixture
def em_atendimento(chat_da_ana, agente):
    return chat_service.take_chat(chat=chat_da_ana, agent=agente)


class TestClienteEncerraAvaliando:
    def test_encerra_e_avalia_na_mesma_operacao(self, em_atendimento, ana):
        chat = chat_service.close_chat(
            chat=em_atendimento, actor=ana,
            rating={"service_score": 9, "resolution_score": 8, "justification": ""},
        )
        chat.refresh_from_db()
        assert chat.status == ChatStatus.CLOSED
        assert chat.rating.service_score == 9
        assert chat.rating_pending is False  # nada pendente: já avaliou

    def test_avaliacao_recusada_nao_encerra_o_chat(self, em_atendimento, ana, config):
        """Nota baixa sem justificativa é recusada pelo `rate`. Como tudo roda
        na mesma transação, o encerramento tem de desfazer junto — senão o
        cliente ficaria com o chat fechado E a nota perdida."""
        config(low_score_threshold=5)
        with pytest.raises(ChatRuleViolation, match="justificativa"):
            chat_service.close_chat(
                chat=em_atendimento, actor=ana,
                rating={"service_score": 2, "resolution_score": 2, "justification": ""},
            )
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE
        assert not ChatRating.objects.filter(chat=em_atendimento).exists()

    def test_nota_baixa_com_justificativa_encerra(self, em_atendimento, ana, config):
        config(low_score_threshold=5)
        chat = chat_service.close_chat(
            chat=em_atendimento, actor=ana,
            rating={"service_score": 2, "resolution_score": 3,
                    "justification": "ninguém resolveu meu problema"},
        )
        assert chat.status == ChatStatus.CLOSED
        assert chat.rating.justification == "ninguém resolveu meu problema"

    def test_agente_nao_avalia_pelo_cliente(self, em_atendimento, agente):
        with pytest.raises(ChatRuleViolation, match="Só o cliente avalia"):
            chat_service.close_chat(
                chat=em_atendimento, actor=agente,
                rating={"service_score": 10, "resolution_score": 10, "justification": ""},
            )
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE


class TestPelaApi:
    def test_cliente_encerra_avaliando_pela_api(self, em_atendimento, ana, api):
        r = api(ana).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/close/",
            {"service_score": 10, "resolution_score": 9, "justification": "ótimo"},
            format="json",
        )
        assert r.status_code == 200
        assert r.json()["status"] == "closed"
        assert r.json()["rating"]["service_score"] == 10

    def test_meia_avaliacao_e_recusada(self, em_atendimento, ana, api):
        """Uma nota só é erro de quem chama, não meio caminho: as duas vêm
        juntas ou nenhuma vem."""
        r = api(ana).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/close/",
            {"service_score": 10}, format="json",
        )
        assert r.status_code == 400
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.ACTIVE

    def test_encerrar_sem_avaliacao_continua_valendo(self, em_atendimento, agente, api):
        """O agente encerra sem nota: a pendência é do cliente, para depois."""
        r = api(agente).post(f"/api/v1/chat/chats/{em_atendimento.pk}/close/",
                             {}, format="json")
        assert r.status_code == 200
        em_atendimento.refresh_from_db()
        assert em_atendimento.status == ChatStatus.CLOSED
        assert em_atendimento.rating_pending is True

    def test_avaliacao_pendente_do_encerramento_pelo_agente_aparece_ao_cliente(
        self, em_atendimento, agente, ana, api
    ):
        chat_service.close_chat(chat=em_atendimento, actor=agente)
        corpo = api(ana).get("/api/v1/chat/chats/pending-ratings/").json()
        ids = [c["id"] for c in (corpo if isinstance(corpo, list) else corpo["results"])]
        assert em_atendimento.pk in ids

    def test_nao_avalia_duas_vezes_nem_pelo_encerramento(self, em_atendimento, ana, api):
        api(ana).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/close/",
            {"service_score": 8, "resolution_score": 8}, format="json",
        )
        # segunda tentativa: o chat já está encerrado E já foi avaliado
        r = api(ana).post(
            f"/api/v1/chat/chats/{em_atendimento.pk}/rate/",
            {"service_score": 1, "resolution_score": 1, "justification": "mudei de ideia"},
            format="json",
        )
        assert r.status_code == 400
        assert ChatRating.objects.filter(chat=em_atendimento).count() == 1


class TestTagsTemHistorico:
    def test_mudanca_de_etiqueta_entra_na_auditoria(self, em_atendimento, agente, api):
        """Item 12: etiqueta tem histórico. "Quem tirou a de urgente?" é a
        pergunta que aparece justamente quando alguém tirou."""
        from django.contrib.contenttypes.models import ContentType

        from apps.audit.models import AuditLog
        from apps.chat.models import Chat
        from apps.tickets.models import TicketTag

        urgente = TicketTag.objects.create(name="Urgente", slug="urgente")
        api(agente).patch(
            f"/api/v1/chat/chats/{em_atendimento.pk}/",
            {"tags": [urgente.pk]}, format="json",
        )
        logs = AuditLog.objects.filter(
            content_type=ContentType.objects.get_for_model(Chat),
            object_id=str(em_atendimento.pk),
            action="update",
        )
        assert logs.exists()
        assert logs.last().changes["tags"] == [[], ["Urgente"]]
