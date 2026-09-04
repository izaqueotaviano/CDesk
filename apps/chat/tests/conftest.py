"""Fixtures do chat v2: duas empresas, três agentes, fila única sem equipe."""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, Team, User, UserKind
from apps.chat.models import ChatConfig
from apps.customers.models import Company, Plan


@pytest.fixture
def plan_gold(db):
    return Plan.objects.create(
        slug="gold", name="Gold", rank=20,
        default_ticket_limit=50, chat_enabled=True, chat_consumes_quota=False,
    )


@pytest.fixture
def acme(plan_gold):
    return Company.objects.create(name="Acme", slug="acme", plan=plan_gold)


@pytest.fixture
def bravo(plan_gold):
    return Company.objects.create(name="Bravo", slug="bravo", plan=plan_gold)


@pytest.fixture
def suporte(db):
    """Equipe existe só para a CONVERSÃO — a fila do chat não a usa."""
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def ana(acme):
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana Almeida",
        kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def beto(acme):
    """Colega de empresa da Ana — chats simultâneos entre eles são permitidos."""
    return User.objects.create_user(
        email="beto@acme.test", full_name="Beto Barros",
        kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def carla(bravo):
    return User.objects.create_user(
        email="carla@bravo.test", full_name="Carla Costa",
        kind=UserKind.CLIENT, company=bravo,
    )


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="samuel@x.test", full_name="Samuel Suporte",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def agente2(db):
    return User.objects.create_user(
        email="fatima@x.test", full_name="Fátima Financeiro",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="alice@x.test", full_name="Alice Admin",
        kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def chat_da_ana(ana):
    from apps.chat.services import chat_service

    chat, _ = chat_service.open_chat(client=ana)
    return chat


@pytest.fixture
def config(db):
    """Ajusta o ChatConfig do cenário (e limpa o cache do singleton)."""
    from django.core.cache import cache

    def _ajustar(**campos):
        cfg = ChatConfig.load()
        for chave, valor in campos.items():
            setattr(cfg, chave, valor)
        cfg.save()
        cache.delete(ChatConfig.CACHE_KEY)
        return ChatConfig.load()
    yield _ajustar
    cache.delete(ChatConfig.CACHE_KEY)


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for
