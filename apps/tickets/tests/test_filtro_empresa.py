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
