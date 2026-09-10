"""A busca encontra o que a pessoa digitou SEM acento.

Achado de QA rodando o sistema: buscar "acentuacao" devolvia zero para um
chamado com "acentuação" no assunto. Quem digita rápido não acentua, e a
lista vazia lê como "esse chamado não existe" — pior que um erro, porque
ninguém desconfia dela. O conserto é a extensão `unaccent` do Postgres
(migração tickets/0024) aplicada ao ASSUNTO em `_busca_q` e ao nome de
empresa/pessoa na busca global; a REFERÊNCIA fica fora porque é código.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def cenario(db):
    team = Team.objects.create(name="Suporte", slug="suporte")
    plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=100)
    acme = Company.objects.create(name="Padaria São João", slug="sao-joao", plan=plan)
    cliente = User.objects.create_user(
        email="jose@saojoao.test", full_name="José Conceição",
        kind=UserKind.CLIENT, company=acme, password="x",
    )
    agente = User.objects.create_user(
        email="ag@interno.test", full_name="Agente", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT, password="x",
    )
    AgentTeam.objects.create(user=agente, team=team)
    ticket = ticket_service.create_ticket(
        requester=cliente, team=team,
        subject="Emissão de segunda via não está funcionando",
        body="corpo", actor=cliente,
    )
    api = APIClient()
    api.force_authenticate(agente)
    return api, ticket


def test_assunto_sem_acento_encontra_o_acentuado(cenario):
    api, ticket = cenario
    resp = api.get("/api/v1/tickets/", {"q": "emissao"})
    assert resp.status_code == 200
    assert [t["id"] for t in resp.data["results"]] == [ticket.pk]


def test_com_acento_continua_encontrando(cenario):
    api, ticket = cenario
    resp = api.get("/api/v1/tickets/", {"q": "emissão"})
    assert [t["id"] for t in resp.data["results"]] == [ticket.pk]


def test_busca_global_ignora_acento_em_empresa_e_pessoa(cenario):
    api, _ = cenario
    resp = api.get("/api/v1/search/", {"q": "sao joao"})
    assert resp.status_code == 200
    assert [c["name"] for c in resp.data["companies"]] == ["Padaria São João"]

    resp = api.get("/api/v1/search/", {"q": "conceicao"})
    assert [r["full_name"] for r in resp.data["requesters"]] == ["José Conceição"]
