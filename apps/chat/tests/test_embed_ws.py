"""`ws/chat/<id>/?ticket=` — o caminho de autenticação que o mini chat
embutido usa quando não há sessão de cookie nenhuma (docs/14-seguranca.md
§10). `WebsocketCommunicator` contra o roteamento real, com um scope SEM
`user` — é assim que a conexão chega de fato quando não passa por
`AuthMiddlewareStack` (o widget não tem cookie de propósito).
"""

import pytest
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator

from apps.chat.consumers import CLOSE_FORBIDDEN, CLOSE_UNAUTHENTICATED
from apps.chat.services import chat_service
from apps.customers.services.embed import issue_access_token
from config.routing import websocket_urlpatterns

# transaction=True: o consumer roda `database_sync_to_async` numa conexão de
# BANCO PRÓPRIA (thread separada) — com a trava padrão do django_db (uma
# transação que nunca comita, só desfaz no fim) essa conexão não enxerga o
# que o teste criou. Isto força os dados a serem escritos de verdade.
pytestmark = pytest.mark.django_db(transaction=True)

application = URLRouter(websocket_urlpatterns)


async def _conectar(chat_id, ticket=None):
    caminho = f"/ws/chat/{chat_id}/"
    if ticket is not None:
        caminho += f"?ticket={ticket}"
    return WebsocketCommunicator(application, caminho)


@pytest.fixture
def plan(db):
    from apps.customers.models import Plan

    return Plan.objects.create(
        slug="gold", name="Gold", default_ticket_limit=10, chat_enabled=True,
    )


@pytest.fixture
def acme(plan):
    from apps.customers.models import Company

    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def ana(acme):
    from apps.accounts.models import User, UserKind

    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana Almeida", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def beto(acme):
    from apps.accounts.models import User, UserKind

    return User.objects.create_user(
        email="beto@acme.test", full_name="Beto Barros", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
async def chat_da_ana(ana):
    from channels.db import database_sync_to_async

    chat, _ = await database_sync_to_async(chat_service.open_chat)(client=ana)
    return chat


@pytest.mark.asyncio
async def test_ticket_valido_conecta(ana, chat_da_ana):
    comm = await _conectar(chat_da_ana.id, issue_access_token(ana.id))
    conectado, _ = await comm.connect()
    assert conectado
    await comm.disconnect()


@pytest.mark.asyncio
async def test_sem_ticket_e_sem_sessao_e_recusado(chat_da_ana):
    comm = await _conectar(chat_da_ana.id)  # nem ?ticket= nem AuthMiddlewareStack
    conectado, fechado_com = await comm.connect()
    assert not conectado
    assert fechado_com == CLOSE_UNAUTHENTICATED


@pytest.mark.asyncio
async def test_ticket_forjado_e_recusado(chat_da_ana):
    comm = await _conectar(chat_da_ana.id, "token-completamente-forjado")
    conectado, fechado_com = await comm.connect()
    assert not conectado
    assert fechado_com == CLOSE_UNAUTHENTICATED


@pytest.mark.asyncio
async def test_ticket_de_quem_nao_e_dono_do_chat_e_recusado(beto, chat_da_ana):
    """O ticket prova QUEM é a pessoa — não dá acesso a qualquer chat. A
    mesma regra de sempre (`chat.client_id != user.id`) continua valendo."""
    comm = await _conectar(chat_da_ana.id, issue_access_token(beto.id))
    conectado, fechado_com = await comm.connect()
    assert not conectado
    assert fechado_com == CLOSE_FORBIDDEN


@pytest.mark.asyncio
async def test_mensagem_enviada_pelo_ticket_persiste_e_chega_de_volta(ana, chat_da_ana):
    comm = await _conectar(chat_da_ana.id, issue_access_token(ana.id))
    conectado, _ = await comm.connect()
    assert conectado

    await comm.send_json_to({"type": "message", "body": "Olá, preciso de ajuda"})
    resposta = await comm.receive_json_from()
    assert resposta["type"] == "message"
    assert resposta["body"] == "Olá, preciso de ajuda"
    assert resposta["author_name"] == ana.full_name

    from channels.db import database_sync_to_async

    # `open_chat` já grava a mensagem de boas-vindas do sistema — a nossa é
    # a segunda, não a única
    persistida = await database_sync_to_async(
        lambda: chat_da_ana.messages.filter(body="Olá, preciso de ajuda", author=ana).exists()
    )()
    assert persistida

    await comm.disconnect()
