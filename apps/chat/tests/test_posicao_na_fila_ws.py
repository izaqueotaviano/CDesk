"""O aviso de posição chega pelo socket da sala — e só na sala do próprio chat.

Ponta a ponta contra o roteamento real (`config.routing`), com o
`InMemoryChannelLayer` da suíte: o `group_send` de `fila.avisar_posicoes`
precisa casar com o handler `chat_queue_position` do consumer, e o cliente
conectado na sala dele recebe a posição DELE, não a de outro.
"""

import pytest
from channels.db import database_sync_to_async
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator

from apps.chat.services import chat_service, fila
from apps.customers.services.embed import issue_access_token
from config.routing import websocket_urlpatterns

# mesmo motivo de test_embed_ws.py: o consumer lê o banco por outra conexão
pytestmark = pytest.mark.django_db(transaction=True)

application = URLRouter(websocket_urlpatterns)


@pytest.fixture
def clientes(db):
    from apps.accounts.models import User, UserKind
    from apps.customers.models import Company, Plan

    plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10, chat_enabled=True)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return [
        User.objects.create_user(email=f"{n}@acme.test", full_name=n.title(), kind=UserKind.CLIENT, company=acme)
        for n in ("ana", "beto")
    ]


@pytest.mark.asyncio
async def test_cliente_recebe_a_propria_posicao(clientes):
    ana, beto = clientes
    abrir = database_sync_to_async(chat_service.open_chat)
    chat_ana, _ = await abrir(client=ana)
    chat_beto, _ = await abrir(client=beto)

    comm = WebsocketCommunicator(application, f"/ws/chat/{chat_beto.pk}/?ticket={issue_access_token(beto.id)}")
    conectado, _ = await comm.connect()
    assert conectado

    await database_sync_to_async(fila.avisar_posicoes)()
    evento = await comm.receive_json_from(timeout=2)
    assert evento == {
        "type": "queue_position", "chat_id": chat_beto.pk, "position": 2, "ahead": 1,
        "estimated_wait_minutes": None, "queue_open": True, "queue_opens_at": None,
    }
    # a posição da Ana foi para a sala da Ana — nada mais chega aqui
    assert await comm.receive_nothing(timeout=0.3)
    await comm.disconnect()
