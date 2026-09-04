"""Fixtures de notificações: cenário mínimo com SLA configurado."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    User,
    UserKind,
)
from apps.customers.models import Company, Plan
from apps.tickets.models import SLAPolicy


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=None)


@pytest.fixture
def sla_policy(plan, suporte):
    """1h para primeira resposta, 4h para resolução — tempo corrido (sem calendário)."""
    return SLAPolicy.objects.create(
        name="SLA teste", plan=plan, team=None,
        first_response_minutes=60, resolution_minutes=240,
        use_business_hours=False,
    )


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=acme, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def colega(suporte):
    user = User.objects.create_user(
        email="colega@x.test", full_name="Clara", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for
