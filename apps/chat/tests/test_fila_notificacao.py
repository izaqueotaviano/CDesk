"""Aviso persistente (sino + e-mail) de chat esquecido na fila —
`NotificationKind.CHAT_INCOMING` não tinha NENHUM emissor até esta rodada.
`notify_queued_chats` é o único lugar do sistema que chama
`notify()`/`queue_email()` para este tipo — o popup em tempo real de
`_avisar_fila` (WebSocket, GRUPO_AGENTES) é um canal diferente e este teste
não mexe nele."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.chat.models import Chat
from apps.chat.services import chat_service
from apps.chat.tasks import notify_queued_chats
from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)

pytestmark = pytest.mark.django_db


def _envelhecer(chat, minutos):
    Chat.objects.filter(pk=chat.pk).update(
        queued_at=timezone.now() - dt.timedelta(minutes=minutos)
    )


class TestNotificaAgenteDisponivel:
    def test_notifica_apos_metade_do_timeout(self, chat_da_ana, ana, agente, config):
        config(queue_timeout_minutes=10)  # metade = 5min
        _envelhecer(chat_da_ana, 6)

        avisados = notify_queued_chats()

        assert avisados == 1
        aviso = Notification.objects.get(
            recipient=agente, kind=NotificationKind.CHAT_INCOMING,
        )
        assert ana.full_name in aviso.title
        assert aviso.url == f"/chat?chat={chat_da_ana.pk}"
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="chat_incoming",
        ).exists()

    def test_nao_notifica_antes_da_metade_do_timeout(self, chat_da_ana, agente, config):
        config(queue_timeout_minutes=10)
        _envelhecer(chat_da_ana, 2)  # menos que a metade (5min)

        assert notify_queued_chats() == 0
        assert not Notification.objects.filter(kind=NotificationKind.CHAT_INCOMING).exists()

    def test_email_so_sai_com_a_preferencia_ligada(self, chat_da_ana, agente, config):
        config(queue_timeout_minutes=2)  # metade cairia em 1min, já é o piso
        _envelhecer(chat_da_ana, 2)
        NotificationPreference.objects.create(user=agente, email={"chat_incoming": False})

        notify_queued_chats()

        # o sino é outro canal — desligar e-mail não desliga o in-app
        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.CHAT_INCOMING,
        ).exists()
        assert not OutboundEmail.objects.filter(
            to_email=agente.email, template="chat_incoming",
        ).exists()

    def test_rodar_duas_vezes_seguidas_nao_duplica(self, chat_da_ana, agente, config):
        config(queue_timeout_minutes=10)
        _envelhecer(chat_da_ana, 6)

        notify_queued_chats()
        notify_queued_chats()

        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.CHAT_INCOMING,
        ).count() == 1
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="chat_incoming",
        ).count() == 1


class TestTetoDeAtendimentos:
    def test_nao_notifica_agente_no_teto(
        self, chat_da_ana, beto, agente, agente2, config,
    ):
        config(queue_timeout_minutes=10, max_chats_per_agent=1)
        # agente assume outro chat e vai pro teto (1 de 1) ANTES da varredura
        chat_do_beto, _ = chat_service.open_chat(client=beto)
        chat_service.take_chat(chat=chat_do_beto, agent=agente)
        _envelhecer(chat_da_ana, 6)

        avisados = notify_queued_chats()

        assert avisados == 1  # só agente2, que ainda tem vaga
        assert not Notification.objects.filter(
            recipient=agente, kind=NotificationKind.CHAT_INCOMING,
        ).exists()
        assert Notification.objects.filter(
            recipient=agente2, kind=NotificationKind.CHAT_INCOMING,
        ).exists()
