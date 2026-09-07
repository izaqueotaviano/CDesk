""""Dono técnico" do chamado — `owner`, separado de `assignee` (docs/05
§3.2). O campo já existia no model desde antes desta rodada, mas sem
NENHUMA exposição de API — nem leitura, nem escrita. Espelha o contrato de
`assign()`, mesmo desenho (histórico + notificação in-app)."""

import pytest

from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)

pytestmark = pytest.mark.django_db


class TestSetOwner:
    def test_define_dono_tecnico(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["owner_id"] == agente_financeiro.pk
        assert resp.json()["owner_name"] == agente_financeiro.full_name
        ticket.refresh_from_db()
        assert ticket.owner_id == agente_financeiro.pk

    def test_owner_e_assignee_sao_campos_independentes(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/assign/",
            {"assignee_id": agente_suporte.pk}, format="json",
        )
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        ticket.refresh_from_db()
        assert ticket.assignee_id == agente_suporte.pk
        assert ticket.owner_id == agente_financeiro.pk  # não sobrescreveu um o outro

    def test_remove_dono_tecnico_com_owner_id_nulo(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/", {}, format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["owner_id"] is None

    def test_so_agente_interno_pode_ser_dono_tecnico(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": ana.pk}, format="json",
        )
        assert resp.status_code == 400

    def test_cliente_nao_alcanca(self, api, ana, suporte, agente_suporte, make_ticket):
        ticket = make_ticket(requester=ana, team=suporte)
        resp = api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_suporte.pk}, format="json",
        )
        assert resp.status_code == 403

    def test_notifica_o_novo_dono_tecnico(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        assert Notification.objects.filter(
            recipient=agente_financeiro, kind=NotificationKind.TICKET_OWNER_SET, ticket=ticket,
        ).exists()

    def test_nao_notifica_a_si_mesmo(self, api, agente_suporte, ana, suporte, make_ticket):
        """Mesma regra de `assign()`: definir a si mesmo como dono não
        gera notificação — a pessoa já sabe."""
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_suporte.pk}, format="json",
        )
        assert not Notification.objects.filter(
            recipient=agente_suporte, kind=NotificationKind.TICKET_OWNER_SET,
        ).exists()

    def test_grava_historico(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        evento = ticket.status_events.latest("id")
        assert "dono técnico" in evento.note
        assert agente_financeiro.full_name in evento.note

    def test_email_ao_novo_dono_tecnico(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        """TICKET_OWNER_SET só avisava in-app — o toggle de e-mail da tela de
        Notificações não tinha efeito nenhum para este tipo."""
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        email = OutboundEmail.objects.get(
            to_email=agente_financeiro.email, template="ticket_owner_set",
        )
        assert email.ticket_id == ticket.pk

    def test_email_desligado_nao_envia(
        self, api, agente_suporte, agente_financeiro, ana, suporte, make_ticket,
    ):
        NotificationPreference.objects.create(
            user=agente_financeiro, email={"ticket_owner_set": False}
        )
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_financeiro.pk}, format="json",
        )
        assert Notification.objects.filter(
            recipient=agente_financeiro, kind=NotificationKind.TICKET_OWNER_SET,
        ).exists()  # sino continua ligado
        assert not OutboundEmail.objects.filter(template="ticket_owner_set").exists()

    def test_nao_notifica_a_si_mesmo_por_email(
        self, api, agente_suporte, ana, suporte, make_ticket
    ):
        ticket = make_ticket(requester=ana, team=suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/set-owner/",
            {"owner_id": agente_suporte.pk}, format="json",
        )
        assert not OutboundEmail.objects.filter(template="ticket_owner_set").exists()
