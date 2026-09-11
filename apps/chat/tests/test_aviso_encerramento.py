"""O cliente é avisado quando a conversa por chat termina.

Regra do Painel do Cliente: "chat finalizado" manda e-mail. Quem encerrou
não importa — o que a pessoa precisa saber é que a avaliação ficou
pendente (e trava o próximo chat) ou onde reler a conversa. A conversão em
ticket é a exceção: ela já tem o próprio aviso (`chat_converted`).
"""

import pytest

from apps.chat.services import chat_service
from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)

pytestmark = pytest.mark.django_db(transaction=True)


class TestClienteAvisadoDoEncerramento:
    def test_agente_encerra_e_o_email_pede_a_avaliacao(self, chat_da_ana, ana, agente):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_service.close_chat(chat=chat_da_ana, actor=agente)

        email = OutboundEmail.objects.get(to_email=ana.email, template="chat_closed")
        assert email.context["com_agente"] == f" com {agente.full_name}"
        assert "Avalie" in email.context["proximo_passo"]
        assert email.context["link"].endswith(f"/portal/chat?chat={chat_da_ana.pk}")

        aviso = Notification.objects.get(recipient=ana, kind=NotificationKind.CHAT_CLOSED)
        assert aviso.url == f"/portal/chat?chat={chat_da_ana.pk}"

    def test_cliente_que_encerra_tambem_recebe(self, chat_da_ana, ana):
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        email = OutboundEmail.objects.get(to_email=ana.email, template="chat_closed")
        assert email.context["com_agente"] == ""  # ninguém chegou a atender

    def test_preferencia_de_email_desligada_mantem_o_sino(self, chat_da_ana, ana):
        NotificationPreference.objects.create(user=ana, email={"chat_closed": False})
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        assert Notification.objects.filter(
            recipient=ana, kind=NotificationKind.CHAT_CLOSED
        ).exists()
        assert not OutboundEmail.objects.filter(template="chat_closed").exists()

    def test_conversao_em_ticket_nao_manda_o_aviso_de_chat_encerrado(
        self, chat_da_ana, ana, agente, suporte,
    ):
        from apps.tickets.services import ticket_service

        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ticket_service.create_from_chat(chat=chat_da_ana, team=suporte, actor=agente)

        assert OutboundEmail.objects.filter(to_email=ana.email, template="chat_converted").exists()
        assert not OutboundEmail.objects.filter(template="chat_closed").exists()
        assert not Notification.objects.filter(
            recipient=ana, kind=NotificationKind.CHAT_CLOSED
        ).exists()
