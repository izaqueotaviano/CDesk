"""Relatório de chat: tempo médio de espera e de atendimento.

O que este arquivo prova: a média sai em MINUTOS (não `timedelta` cru — o
JSONRenderer do DRF não sabe serializar isso; sem a conversão, o endpoint
quebraria com TypeError, achado desta rodada), e só entra na conta quem
realmente tem o par de timestamps que cada métrica pede — chat ainda na
fila não tem `accepted_at`, chat ainda aberto não tem `closed_at`. Os dois
ficam de FORA da média (não viram zero, que puxaria a média pra baixo à
toa).
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.chat.models import Chat
from apps.chat.services import chat_service

pytestmark = pytest.mark.django_db


def _marcar(chat, **campos):
    """Ajusta timestamps direto no banco — os serviços usam `timezone.now()`
    de verdade, então controlar o intervalo exige sobrescrever depois
    (mesmo padrão de `test_saved_views.py::cenario`, tickets)."""
    Chat.objects.filter(pk=chat.pk).update(**campos)
    chat.refresh_from_db()
    return chat


class TestTempoMedio:
    URL = "/api/v1/chat/reports/"

    def test_espera_e_atendimento_em_minutos(self, api, admin, ana, agente):
        agora = timezone.now()
        chat, _ = chat_service.open_chat(client=ana)
        chat = _marcar(chat, queued_at=agora - dt.timedelta(minutes=10))
        chat_service.take_chat(chat=chat, agent=agente)
        chat = _marcar(chat, accepted_at=agora - dt.timedelta(minutes=5))  # esperou 5min
        chat_service.close_chat(chat=chat, actor=agente)
        chat = _marcar(chat, closed_at=agora)  # atendeu 5min

        resp = api(admin).get(self.URL, {"by": "agent"})
        assert resp.status_code == 200
        linha = resp.json()[0]
        assert linha["espera_media_minutos"] == pytest.approx(5.0, abs=0.1)
        assert linha["atendimento_medio_minutos"] == pytest.approx(5.0, abs=0.1)

    def test_chat_ainda_na_fila_nao_entra_na_media(self, api, admin, ana):
        chat_service.open_chat(client=ana)  # nunca pego — accepted_at nulo

        resp = api(admin).get(self.URL, {"by": "company"})
        assert resp.status_code == 200
        linha = resp.json()[0]
        assert linha["espera_media_minutos"] is None
        assert linha["atendimento_medio_minutos"] is None

    def test_chat_ainda_aberto_nao_entra_no_tempo_de_atendimento(self, api, admin, ana, agente):
        chat, _ = chat_service.open_chat(client=ana)
        chat_service.take_chat(chat=chat, agent=agente)  # pego, mas nunca fechado

        resp = api(admin).get(self.URL, {"by": "agent"})
        linha = resp.json()[0]
        assert linha["espera_media_minutos"] is not None  # foi pego, isso já dá pra medir
        assert linha["atendimento_medio_minutos"] is None  # não fechou, nada pra medir

    def test_resposta_e_json_valido_nao_timedelta_cru(self, api, admin, ana, agente):
        chat, _ = chat_service.open_chat(client=ana)
        chat_service.take_chat(chat=chat, agent=agente)
        chat_service.close_chat(chat=chat, actor=agente)

        resp = api(admin).get(self.URL, {"by": "agent"})
        assert resp.status_code == 200  # não quebrou serializando timedelta
        valor = resp.json()[0]["espera_media_minutos"]
        assert isinstance(valor, (int, float))
