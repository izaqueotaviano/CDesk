"""Minha conta → Notificações, do lado de quem ATENDE.

O console ganhou a mesma tela de preferências que o portal já tinha, com um
interruptor por tipo para o sino (in-app) e outro para o e-mail. O que estas
travas protegem: o interruptor do sino desligado precisa calar o sino de
verdade (a tela não pode prometer silêncio que o serviço ignora), e mexer
num canal não pode mexer no outro. O lado do e-mail já tem as suas em
`test_notifications.py::TestAgentEmails`/`TestPreferenciaPadrao`.
"""

import pytest

from apps.notifications.models import Notification, NotificationKind, OutboundEmail
from apps.notifications.services import quer_email, quer_in_app
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


def _ticket(ana, suporte):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject="Assunto", body="Corpo",
    )


class TestSinoDoAgente:
    def test_desligar_o_sino_de_um_tipo_cala_so_aquele_tipo(self, api, ana, suporte, agente, colega):
        resp = api(colega).put(
            "/api/v1/notification-preferences/",
            {"in_app": {NotificationKind.TICKET_ASSIGNED: False}},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["in_app"][NotificationKind.TICKET_ASSIGNED] is False

        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        # atribuição: sem sino...
        assert not Notification.objects.filter(
            recipient=colega, kind=NotificationKind.TICKET_ASSIGNED
        ).exists()
        # ...mas o e-mail (outro canal, não mexido) continua saindo
        assert OutboundEmail.objects.filter(
            to_email=colega.email, template="ticket_assigned"
        ).exists()

        # e o resto do sino segue vivo: a menção chega normalmente
        ticket_service.add_reply(
            ticket=ticket, author=agente, is_public=False,
            body=f"@[user:{colega.pk}] consegue olhar?",
        )
        assert Notification.objects.filter(
            recipient=colega, kind=NotificationKind.MENTION
        ).exists()

    def test_os_dois_canais_sao_independentes(self, api, agente):
        client = api(agente)
        client.put(
            "/api/v1/notification-preferences/",
            {"in_app": {NotificationKind.SLA_WARNING: False}},
            format="json",
        )
        client.put(
            "/api/v1/notification-preferences/",
            {"email": {NotificationKind.CHAT_INCOMING: False}},
            format="json",
        )
        assert quer_in_app(agente, NotificationKind.SLA_WARNING) is False
        assert quer_email(agente, NotificationKind.SLA_WARNING) is True
        assert quer_email(agente, NotificationKind.CHAT_INCOMING) is False
        assert quer_in_app(agente, NotificationKind.CHAT_INCOMING) is True

    def test_religar_volta_a_avisar(self, api, ana, suporte, agente, colega):
        client = api(colega)
        client.put(
            "/api/v1/notification-preferences/",
            {"in_app": {NotificationKind.TICKET_ASSIGNED: False}},
            format="json",
        )
        client.put(
            "/api/v1/notification-preferences/",
            {"in_app": {NotificationKind.TICKET_ASSIGNED: True}},
            format="json",
        )
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=colega, actor=agente)
        assert Notification.objects.filter(
            recipient=colega, kind=NotificationKind.TICKET_ASSIGNED
        ).exists()

    def test_tipo_que_nao_existe_e_recusado(self, api, agente):
        resp = api(agente).put(
            "/api/v1/notification-preferences/",
            {"in_app": {"ticket_explodiu": False}},
            format="json",
        )
        assert resp.status_code == 400
