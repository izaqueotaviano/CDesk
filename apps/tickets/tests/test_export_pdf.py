"""Exportar a conversa em PDF (`GET /tickets/{id}/export/`).

O caso que importa: servidor SEM o extra `reports` precisa responder 501 com
a mensagem — não 500. Achado no Painel do Cliente: o `except RuntimeError`
montava a resposta com `status.HTTP_501…`, mas o módulo importa o status do
DRF como `http`, e o NameError virava um 500 sem explicação na tela."""

from unittest import mock

import pytest

pytestmark = pytest.mark.django_db


class TestExportarPdf:
    def test_sem_gerador_de_pdf_responde_501_com_motivo(self, api, ana, suporte, make_ticket):
        ticket = make_ticket(requester=ana, team=suporte)
        with mock.patch(
            "apps.tickets.views.transcript.ticket_pdf",
            side_effect=RuntimeError("Exportar a conversa em PDF exige o extra 'reports'."),
        ):
            resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/")
        assert resp.status_code == 501
        assert "extra 'reports'" in resp.json()["detail"]

    def test_com_gerador_devolve_o_arquivo(self, api, ana, suporte, make_ticket):
        ticket = make_ticket(requester=ana, team=suporte)
        with mock.patch(
            "apps.tickets.views.transcript.ticket_pdf",
            return_value=(b"%PDF-1.4 fake", f"{ticket.reference}.pdf"),
        ):
            resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/")
        assert resp.status_code == 200
        assert resp["Content-Type"] == "application/pdf"
        assert ticket.reference in resp["Content-Disposition"]

    def test_ticket_de_outra_empresa_nao_existe_para_o_cliente(
        self, api, ana, carla, suporte, make_ticket
    ):
        ticket = make_ticket(requester=carla, team=suporte)
        resp = api(ana).get(f"/api/v1/tickets/{ticket.pk}/export/")
        assert resp.status_code == 404
