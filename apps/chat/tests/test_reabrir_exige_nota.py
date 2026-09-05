"""Antes de reabrir a conversa, a nota — inclusive a do PRÓPRIO chat.

Antes, o chat pendente podia ser reaberto como forma de retomar; a regra
de produto passou a ser uma só: fechou, avalia, e só então abre ou reabre.
"""

import pytest

from apps.chat.models import ChatStatus
from apps.chat.services import chat_service
from apps.chat.services.chat_service import ChatRuleViolation

pytestmark = pytest.mark.django_db


class TestReabrirExigeNota:
    def test_proprio_chat_pendente_nao_reabre(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        with pytest.raises(ChatRuleViolation) as exc:
            chat_service.reopen(chat=chat_da_ana, actor=ana)
        assert exc.value.code == "rating_pending"
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.status == ChatStatus.CLOSED

    def test_depois_da_nota_reabre(self, chat_da_ana, ana, agente):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)
        chat_service.rate(chat=chat_da_ana, client=ana, service_score=9, resolution_score=9)
        chat = chat_service.reopen(chat=chat_da_ana, actor=ana)
        assert chat.status == ChatStatus.QUEUED

    def test_agente_reabre_sem_nota(self, chat_da_ana, ana, agente):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        chat = chat_service.reopen(chat=chat_da_ana, actor=agente)
        assert chat.status == ChatStatus.QUEUED
