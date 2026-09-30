"""Filtro `?company=` na listagem (Fase 2, etapa 2 — Empresas, GAPS.md):
faltava um jeito de listar os chamados de UMA empresa."""

import pytest

pytestmark = pytest.mark.django_db


def test_filtra_so_a_empresa_pedida(api, agente_suporte, make_ticket, ana, carla, suporte):
    ticket_acme = make_ticket(ana, suporte)
    make_ticket(carla, suporte)  # de outra empresa (Bravo)

    resp = api(agente_suporte).get(f"/api/v1/tickets/?company={ana.company_id}")
    ids = [t["id"] for t in resp.json()["results"]]

    assert ids == [ticket_acme.id]


def test_sem_o_parametro_nao_filtra(api, agente_suporte, make_ticket, ana, carla, suporte):
    make_ticket(ana, suporte)
    make_ticket(carla, suporte)

    resp = api(agente_suporte).get("/api/v1/tickets/")

    assert resp.json()["count"] == 2


# ---------------------------------------------------------------------------
# A consulta do bloco "Tickets abertos" da página da empresa (Cliente 360):
# `company` + os três status em aberto + ordem de SLA. O filtro só estreita o
# que `visible_tickets` já recortou — nunca alarga.
# ---------------------------------------------------------------------------


def test_combina_com_os_status_em_aberto(api, agente_suporte, make_ticket, ana, suporte):
    from apps.tickets.models import Ticket

    aberto = make_ticket(ana, suporte, subject="Aberto")
    fechado = make_ticket(ana, suporte, subject="Fechado")
    Ticket.objects.filter(pk=fechado.pk).update(status="closed")

    resp = api(agente_suporte).get(
        f"/api/v1/tickets/?company={ana.company_id}"
        "&status=new,open,pending_customer&ordering=sla&limit=5"
    )

    assert resp.status_code == 200
    assert [t["id"] for t in resp.json()["results"]] == [aberto.id]


def test_agente_de_outra_equipe_nao_ve_pelo_filtro(
    api, agente_financeiro, make_ticket, ana, suporte
):
    make_ticket(ana, suporte)  # equipe Suporte: fora do escopo do financeiro

    resp = api(agente_financeiro).get(f"/api/v1/tickets/?company={ana.company_id}")

    assert resp.json()["count"] == 0


def test_cliente_nao_lista_outra_empresa_pelo_filtro(api, make_ticket, ana, carla, suporte):
    make_ticket(carla, suporte)  # Bravo

    resp = api(ana).get(f"/api/v1/tickets/?company={carla.company_id}")

    assert resp.json()["count"] == 0
