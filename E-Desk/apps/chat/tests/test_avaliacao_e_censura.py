"""Avaliação (duas notas, justificativa, bloqueio por pendência) e o filtro
de palavrões — os dois mecanismos que moldam o comportamento do módulo."""

import pytest

from apps.chat.models import BannedWord, ChatMessage
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation

pytestmark = pytest.mark.django_db(transaction=True)


class TestAvaliacao:
    def test_duas_notas_separadas(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        rating = chat_service.rate(
            chat=chat_da_ana, client=ana, service_score=10, resolution_score=3,
            justification="atendeu super bem mas o problema continua",
        )
        assert rating.service_score == 10
        assert rating.resolution_score == 3

    def test_nota_baixa_sem_justificativa_e_recusada(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        with pytest.raises(ChatRuleViolation, match="justificativa"):
            chat_service.rate(
                chat=chat_da_ana, client=ana, service_score=3, resolution_score=8,
            )

    def test_gatilho_da_justificativa_e_configuravel(self, chat_da_ana, ana, config):
        config(low_score_threshold=3)
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        # 4 está ABAIXO do gatilho padrão (5), mas acima do novo (3): passa
        rating = chat_service.rate(
            chat=chat_da_ana, client=ana, service_score=4, resolution_score=8,
        )
        assert rating.service_score == 4

    def test_nota_fora_da_escala_e_recusada(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        with pytest.raises(ChatRuleViolation, match="escala"):
            chat_service.rate(
                chat=chat_da_ana, client=ana, service_score=11, resolution_score=5,
            )

    def test_pendencia_bloqueia_chat_novo_ate_avaliar(self, chat_da_ana, ana, agente):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=ana)  # fechou SEM nota

        with pytest.raises(ChatRuleViolation, match="[Aa]valie"):
            chat_service.open_chat(client=ana)

        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=8, resolution_score=8)
        novo, created = chat_service.open_chat(client=ana)
        assert created  # avaliou → destravou

    def test_avaliar_duas_vezes_nao_da(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=8, resolution_score=8)
        with pytest.raises(ChatRuleViolation, match="já foi avaliado"):
            chat_service.rate(chat=chat_da_ana, client=ana,
                              service_score=9, resolution_score=9)

    def test_so_o_proprio_cliente_avalia(self, chat_da_ana, ana, beto):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        with pytest.raises(ChatRuleViolation):
            chat_service.rate(chat=chat_da_ana, client=beto,
                              service_score=8, resolution_score=8)

    def test_chat_convertido_nao_cobra_avaliacao(self, chat_da_ana, agente, suporte):
        from apps.tickets.services import ticket_service

        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.rating_pending is False


class TestCensura:
    def test_palavra_banida_vira_asteriscos_na_exibicao(self, chat_da_ana, ana):
        BannedWord.objects.create(word="droga")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana,
                                   body="que DROGA de sistema")
        assert chat_service.censor("que DROGA de sistema") == "que **** de sistema"

    def test_censura_e_por_palavra_inteira(self, db):
        BannedWord.objects.create(word="pato")
        assert chat_service.censor("meu sapato sumiu") == "meu sapato sumiu"
        assert chat_service.censor("o pato fugiu") == "o **** fugiu"

    def test_o_banco_guarda_o_original(self, chat_da_ana, ana):
        """Censura é EXIBIÇÃO: remover a palavra da lista devolve o texto."""
        from django.core.cache import cache

        palavra = BannedWord.objects.create(word="bosta")
        msg = ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="bosta")
        assert msg.body == "bosta"  # intacto no banco
        assert chat_service.censor(msg.body) == "****"

        palavra.delete()
        cache.delete("chat:banned-words")
        assert chat_service.censor(msg.body) == "bosta"

    def test_lado_do_agente_tambem_e_censurado(self, api, chat_da_ana, ana, agente):
        """Inclusive o agente vê a versão censurada — os dois lados iguais."""
        BannedWord.objects.create(word="inferno")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="que inferno")
        resp = api(agente).get(f"/api/v1/chat/chats/{chat_da_ana.pk}/messages/")
        corpos = [m["body"] for m in resp.json()]
        assert "que ****" in corpos
        assert all("inferno" not in c for c in corpos)
