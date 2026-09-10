"""O histórico operacional do chamado é INTERNO.

Ele conta quem atribuiu para quem, quem mencionou quem e o que o sistema
fechou sozinho. Entregar isso ao cliente mostraria o nome de quem foi acionado
por dentro e a colaboração que ele não deveria enxergar — o mesmo motivo pelo
qual nota interna já não sai. Aqui essa fronteira fica travada.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def cena(db):
    plano = Plan.objects.create(slug="g", name="G", default_ticket_limit=99)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plano)
    eq = Team.objects.create(name="Suporte", slug="suporte")
    ana = User.objects.create_user(email="ana@acme.test", full_name="Ana",
                                   kind=UserKind.CLIENT, company=acme, client_role="owner")
    agente = User.objects.create_user(email="ag@x.test", full_name="Samuel",
                                      kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT)
    AgentTeam.objects.create(user=agente, team=eq)
    t = ticket_service.create_ticket(requester=ana, team=eq, subject="s", body="b")
    ticket_service.assign(ticket=t, assignee=agente, actor=agente)
    return dict(t=t, ana=ana, agente=agente)


def _detalhe(user, ticket):
    c = APIClient()
    c.force_authenticate(user=user)
    r = c.get(f"/api/v1/tickets/{ticket.pk}/")
    assert r.status_code == 200
    return r.json()


def test_interno_ve_o_historico(cena):
    eventos = _detalhe(cena["agente"], cena["t"])["events"]
    assert len(eventos) >= 2                      # criação + atribuição
    assert any("atribuído" in (e["note"] or "") for e in eventos)


def test_cliente_nao_recebe_o_historico(cena):
    """A regra dura: nem uma linha."""
    assert _detalhe(cena["ana"], cena["t"])["events"] == []


def test_o_historico_do_cliente_nao_vaza_nome_de_agente(cena):
    """Além de vir vazio, o corpo inteiro da resposta não pode citar o agente
    por causa do histórico — a atribuição é decisão interna."""
    dados = _detalhe(cena["ana"], cena["t"])
    import json
    assert "atribuído a Samuel" not in json.dumps(dados, ensure_ascii=False)
