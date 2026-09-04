"""Fixtures da suíte de tickets.

Monta o cenário canônico dos docs: duas empresas (isolamento), equipe restrita
(Financeiro) e a matriz de papéis — admin, supervisor (2 equipes), agente de
Suporte, agente do Financeiro, cliente solicitante, colega da mesma empresa,
responsável (OWNER) e cliente de outra empresa.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    TeamVisibility,
    User,
    UserKind,
)
from apps.customers.models import Company, LimitPeriod, Plan
from apps.tickets.services import ticket_service


@pytest.fixture
def suporte(db):
    return Team.objects.create(
        name="Suporte", slug="suporte", visibility=TeamVisibility.COMPANY_WIDE
    )


@pytest.fixture
def financeiro(db):
    return Team.objects.create(
        name="Financeiro",
        slug="financeiro",
        visibility=TeamVisibility.REQUESTER_ONLY,
        mask_subject_for_others=True,
    )


@pytest.fixture
def plan_gold(db):
    return Plan.objects.create(
        slug="gold", name="Gold", rank=20,
        default_ticket_limit=3, default_limit_period=LimitPeriod.MONTHLY,
    )


@pytest.fixture
def acme(plan_gold):
    return Company.objects.create(name="Acme", slug="acme", plan=plan_gold)


@pytest.fixture
def bravo(plan_gold):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan_gold)


def _internal(email, role, *teams):
    user = User.objects.create_user(
        email=email, full_name=email.split("@")[0], kind=UserKind.INTERNAL,
        internal_role=role,
    )
    for equipe in teams:
        AgentTeam.objects.create(user=user, team=equipe)
    return user


def _client_user(email, company, role=ClientRole.MEMBER):
    return User.objects.create_user(
        email=email, full_name=email.split("@")[0], kind=UserKind.CLIENT,
        company=company, client_role=role,
    )


@pytest.fixture
def admin(db, suporte, financeiro):
    return _internal("admin@x.test", InternalRole.ADMIN)


@pytest.fixture
def supervisor(suporte, financeiro):
    return _internal("supervisor@x.test", InternalRole.SUPERVISOR, suporte, financeiro)


@pytest.fixture
def agente_suporte(suporte):
    return _internal("agente.sup@x.test", InternalRole.AGENT, suporte)


@pytest.fixture
def agente_financeiro(financeiro):
    return _internal("agente.fin@x.test", InternalRole.AGENT, financeiro)


@pytest.fixture
def ana(acme):
    """Solicitante dos tickets da Acme."""
    return _client_user("ana@acme.test", acme)


@pytest.fixture
def beto(acme):
    """Colega de empresa da Ana, sem papel de responsável."""
    return _client_user("beto@acme.test", acme)


@pytest.fixture
def olga(acme):
    """Responsável (OWNER) da Acme — pode responder tickets da empresa (D9)."""
    return _client_user("olga@acme.test", acme, ClientRole.OWNER)


@pytest.fixture
def carla(bravo):
    """Cliente de OUTRA empresa — nunca vê nada da Acme."""
    return _client_user("carla@bravo.test", bravo)


@pytest.fixture
def agente_leve(suporte):
    """Colaborador de outra área que acompanha o caso por dentro: lê e
    comenta internamente, não fala com o cliente nem é atribuído."""
    return _internal("leve@x.test", InternalRole.LIGHT_AGENT, suporte)


@pytest.fixture
def make_ticket(db):
    def _make(requester, team, subject="Assunto", body="Corpo", actor=None):
        return ticket_service.create_ticket(
            requester=requester, team=team, subject=subject,
            body=body, actor=actor,
        )
    return _make


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


@pytest.fixture
def config(db):
    """Ajusta o `SystemConfig` do cenário.

    Sem argumento devolve a configuração corrente — útil para afirmar sobre os
    defaults de fábrica, que agora são a decisão do negócio, não um acaso.
    """
    from apps.core.models import SystemConfig

    def _set(**campos):
        current = SystemConfig.load()
        for campo, valor in campos.items():
            setattr(current, campo, valor)
        if campos:
            current.save()
        return current

    return _set


@pytest.fixture
def comercial(db):
    """Equipe interna — o cliente não abre nem enxerga."""
    return Team.objects.create(
        name="Comercial", slug="comercial", internal_only=True,
    )
