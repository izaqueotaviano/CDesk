"""Consumers do chat v2 (Django Channels).

O banco é a fonte da verdade e o socket é transporte: mensagem persiste
ANTES do group_send; reconectar é buscar o que faltou por REST e voltar a
escutar. Typing é efêmero e nunca persiste.

- ChatConsumer (ws/chat/<id>/): a sala da conversa. Escrever é restrito
  (cliente dono; agente só o que pegou) — LER, todo interno pode: é o que
  permite supervisão sem interferência.
- UserConsumer (ws/me/): canal pessoal. Interno entra TAMBÉM no grupo da
  fila (`chat_agentes`) — é por aqui que chega o popup "Pegar chat", já
  filtrado pelo limite de simultâneos DO SERVIDOR: quem está no teto não
  recebe o aviso. Ao conectar, a fila que já estava esperando é reenviada
  pelo mesmo caminho (e pelo mesmo filtro), senão o aviso só existiria para
  quem estivesse com a tela aberta no instante do clique do cliente.

`ChatConsumer` aceita uma SEGUNDA forma de chegar autenticado: `?ticket=`
na URL da conexão, verificado por `apps.customers.services.embed` — é o que
o mini chat embutido (docs/14-seguranca.md §10) usa, porque ele não tem
cookie de sessão nenhum (de propósito: cookie de terceiro em iframe é
bloqueado por padrão no Safari). `AuthMiddlewareStack` continua sendo o
caminho normal — o ticket só é olhado quando a sessão não resolveu ninguém.
"""

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_NOT_FOUND = 4404


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            user = await self._user_from_ticket()
        if user is None or not user.is_authenticated:
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return

        chat_id = self.scope["url_route"]["kwargs"]["chat_id"]
        chat = await self._get_chat(chat_id)
        if chat is None:
            await self.close(code=CLOSE_NOT_FOUND)
            return
        if not user.is_internal and chat.client_id != user.id:
            await self.close(code=CLOSE_FORBIDDEN)
            return

        self.user = user
        self.chat_id = chat_id
        self.group = f"chat_{chat_id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group"):
            # NÃO fecha o chat: sessão ≠ conexão
            await self.channel_layer.group_discard(self.group, self.channel_name)

    # ------------------------------------------------------------------ #
    # Mensagens do cliente WS
    # ------------------------------------------------------------------ #

    async def receive_json(self, content, **kwargs):
        msg_type = content.get("type")

        if msg_type == "ping":
            await self.send_json({"type": "pong"})

        elif msg_type == "typing":
            await self.channel_layer.group_send(
                self.group,
                {
                    "type": "chat.typing",
                    "user_id": self.user.id,
                    "user_name": self.user.full_name,
                    "is_typing": bool(content.get("is_typing", True)),
                },
            )

        elif msg_type == "delivered":
            # O DESTINATÁRIO confirma que a mensagem chegou no aparelho dele.
            # É o único jeito honesto de o remetente ver "entregue": o
            # servidor sabe que gravou, não que alguém recebeu.
            ids = [i for i in (content.get("ids") or []) if isinstance(i, int)]
            marcados = await self._persist_delivered(ids)
            if marcados:
                await self.channel_layer.group_send(
                    self.group, {"type": "chat.message_delivered", "ids": marcados}
                )

        elif msg_type == "message":
            body = (content.get("body") or "").strip()
            if not body:
                await self.send_json({"type": "error", "detail": "Mensagem vazia."})
                return
            bruto = content.get("reply_to")
            citada = bruto if isinstance(bruto, int) else None
            # só interno escreve nota interna: o cliente pedindo isso não
            # esconderia a própria mensagem dele de ninguém
            nota = bool(content.get("is_internal_note")) and self.user.is_internal
            payload = await self._persist_message(
                body, reply_to_id=citada, is_internal_note=nota
            )
            if payload is None:
                await self.send_json(
                    {"type": "error",
                     "detail": "Este chat não aceita mensagens suas agora."}
                )
                return
            # 1º persistiu (acima); 2º retransmite — já censurado
            await self.channel_layer.group_send(
                self.group, {"type": "chat.message", **payload}
            )
            # nota interna não vira notificação no celular do cliente — seria
            # o vazamento pela porta dos fundos, com o texto na prévia
            if not nota:
                await self._badge_counterpart(payload)

    # ------------------------------------------------------------------ #
    # Eventos do grupo → cliente
    # ------------------------------------------------------------------ #

    def _esconder(self, event) -> bool:
        """A trava da NOTA INTERNA no socket.

        `group_send` fala com a sala inteira, e a sala tem o cliente dentro.
        Esta é a segunda metade do par: a primeira é
        `chat_service.mensagens_visiveis`, que cobre o REST. Sem as duas, uma
        nota interna que o REST esconde chegaria pelo tempo real assim mesmo.
        """
        return bool(event.get("is_internal_note")) and not self.user.is_internal

    async def chat_message(self, event):
        if self._esconder(event):
            return
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "message"})

    async def chat_message_edited(self, event):
        if self._esconder(event):
            return
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "message_edited"})

    async def chat_message_deleted(self, event):
        if self._esconder(event):
            return
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "message_deleted"})

    async def chat_message_delivered(self, event):
        await self.send_json({"type": "message_delivered", "ids": event["ids"]})

    async def chat_message_read(self, event):
        await self.send_json({"type": "message_read", "ids": event["ids"]})

    async def chat_typing(self, event):
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "typing"})

    async def chat_accepted(self, event):
        await self.send_json({"type": "accepted", "agent_name": event["agent_name"]})

    async def chat_transferred(self, event):
        await self.send_json({"type": "transferred", "agent_name": event["agent_name"]})

    async def chat_closed(self, event):
        await self.send_json({"type": "closed", "by_internal": event["by_internal"]})

    async def chat_converted(self, event):
        await self.send_json({
            "type": "converted",
            "ticket_id": event["ticket_id"],
            "ticket_reference": event["ticket_reference"],
        })

    async def chat_queue_position(self, event):
        """A fila andou (`services/fila.avisar_posicoes`). Só números, e só
        os DESTE chat: a lista de campos é fechada aqui de propósito, para um
        campo novo no evento não sair para o cliente sem alguém decidir."""
        await self.send_json({
            "type": "queue_position",
            **{k: event.get(k) for k in (
                "chat_id", "position", "ahead", "estimated_wait_minutes",
                "queue_open", "queue_opens_at",
            )},
        })

    # ------------------------------------------------------------------ #
    # Acesso a banco
    # ------------------------------------------------------------------ #

    @database_sync_to_async
    def _get_chat(self, chat_id):
        from apps.chat.models import Chat

        return Chat.objects.filter(pk=chat_id).first()

    @database_sync_to_async
    def _user_from_ticket(self):
        """`?ticket=` da URL de conexão → o usuário CLIENTE ativo dono dele,
        ou `None` pra qualquer motivo (sem ticket, assinatura inválida,
        expirado, conta desativada) — o chamador trata tudo isso como "não
        autenticado", sem distinguir qual foi."""
        from apps.accounts.models import User, UserKind
        from apps.customers.services.embed import verify_access_token

        token = parse_qs((self.scope.get("query_string") or b"").decode()).get("ticket", [None])[0]
        if not token:
            return None
        user_id = verify_access_token(token)
        if user_id is None:
            return None
        return User.objects.filter(pk=user_id, kind=UserKind.CLIENT, is_active=True).first()

    @database_sync_to_async
    def _persist_message(self, body, reply_to_id=None, is_internal_note=False):
        from apps.chat.models import Chat, ChatMessage
        from apps.chat.serializers import ChatMessageSerializer
        from apps.chat.services.chat_service import can_send

        chat = Chat.objects.get(pk=self.chat_id)
        if not can_send(self.user, chat):
            return None
        citada = None
        if reply_to_id is not None:
            # do PRÓPRIO chat: um id qualquer vazaria o trecho citado de uma
            # conversa de outro cliente dentro do preview
            citada = chat.messages.filter(
                pk=reply_to_id, deleted_at__isnull=True
            ).first()
        msg = ChatMessage.objects.create(
            chat=chat, author=self.user, body=body, reply_to=citada,
            is_internal_note=is_internal_note,
        )
        return dict(ChatMessageSerializer(msg, context={"user": self.user}).data)

    @database_sync_to_async
    def _persist_delivered(self, ids):
        from apps.chat.models import Chat
        from apps.chat.services import chat_service

        chat = Chat.objects.get(pk=self.chat_id)
        return chat_service.marcar_entregues(chat=chat, actor=self.user, ids=ids)

    @database_sync_to_async
    def _counterpart_id(self):
        from apps.chat.models import Chat

        chat = Chat.objects.get(pk=self.chat_id)
        if self.user.is_internal:
            return chat.client_id
        return chat.agent_id  # na fila: os agentes já receberam o popup

    async def _badge_counterpart(self, payload):
        """Badge no canal pessoal do outro lado, esteja ele na tela que estiver."""
        uid = await self._counterpart_id()
        if not uid:
            return
        await self.channel_layer.group_send(
            f"user_{uid}",
            {
                "type": "notify",
                "kind": "chat_message",
                "chat_id": int(self.chat_id),
                "preview": (payload.get("body") or "")[:80],
                "author_name": payload.get("author_name", ""),
            },
        )


class UserConsumer(AsyncJsonWebsocketConsumer):
    """Canal pessoal (ws/me/) — e, para interno, a fila de chats.

    O evento `chat.queued` só é REPASSADO se o agente ainda tem vaga
    (limite de simultâneos do `ChatConfig`): o filtro é do servidor, o
    front não é confiável para esconder aviso de trabalho.
    """

    async def connect(self):
        from apps.chat.services.chat_service import GRUPO_AGENTES

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        self.user = user
        self.group = f"user_{user.id}"
        await self.channel_layer.group_add(self.group, self.channel_name)
        if user.is_internal:
            await self.channel_layer.group_add(GRUPO_AGENTES, self.channel_name)
        await self.accept()
        if user.is_internal:
            # A fila que JÁ estava esperando quando o agente abriu a tela.
            # Sem isto o popup só existia para quem tivesse o navegador
            # aberto no instante exato em que o cliente clicou: quem chegava
            # depois via o contador da barra mudar e mais nada — e contador
            # não diz de quem é nem dá o botão de pegar.
            for evento in await self._fila_atual():
                await self.chat_queued(evento)

    async def disconnect(self, code):
        from apps.chat.services.chat_service import GRUPO_AGENTES

        if hasattr(self, "group"):
            await self.channel_layer.group_discard(self.group, self.channel_name)
            if self.user.is_internal:
                await self.channel_layer.group_discard(GRUPO_AGENTES, self.channel_name)

    async def receive_json(self, content, **kwargs):
        if content.get("type") == "ping":
            await self.send_json({"type": "pong"})

    async def notify(self, event):
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "notification"})

    async def chat_queued(self, event):
        if not await self._tem_vaga():
            return  # no teto: sem popup até liberar
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "chat_queued"})

    async def chat_taken(self, event):
        """Alguém pegou (ou o chat saiu da fila): o popup some em todo lugar."""
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "chat_taken"})

    async def ticket_event(self, event):
        """Dica de mudança num ticket que a pessoa acompanha (ver
        `notifications.services.broadcast_ticket_event`). O front revalida por
        REST — o evento não carrega conteúdo."""
        await self.send_json({
            "type": "ticket_event",
            "ticket_id": event["ticket_id"],
            "kind": event["kind"],
        })

    async def ticket_presence(self, event):
        """Quem mais está com um ticket aberto (detecção de colisão —
        `apps/tickets/services/presenca.py`). Só chega a quem está na própria
        lista de presença, e só interno entra nela; a checagem aqui é a
        segunda porta, para um evento destes nunca sair num canal de cliente
        mesmo que alguém o mande pelo grupo errado."""
        if not self.user.is_internal:
            return
        await self.send_json({
            "type": "ticket_presence",
            "ticket_id": event["ticket_id"],
            "presentes": event["presentes"],
        })

    async def agent_presence(self, event):
        """Repassa pra TODO agente conectado — o `group_send` já mandou pro
        grupo `chat_agentes` inteiro (apps/accounts/views.py:_avisar_presenca);
        aqui só traduz pro formato que o front espera, igual aos vizinhos
        acima."""
        await self.send_json({k: v for k, v in event.items() if k != "type"}
                             | {"type": "agent_presence"})

    @database_sync_to_async
    def _tem_vaga(self) -> bool:
        from apps.chat.services.chat_service import sob_o_limite

        return sob_o_limite(self.user)

    @database_sync_to_async
    def _fila_atual(self) -> list[dict]:
        """Os chats esperando agora, no mesmo formato do `chat.queued`.

        Teto de 5: os popups empilham num canto fixo e uma fila grande
        cobriria a tela. Quem quer a fila inteira tem o contador da barra e a
        tela de Chat — o popup é aviso, não é a lista.
        """
        from apps.chat.models import Chat, ChatStatus

        fila = (
            Chat.objects.filter(status=ChatStatus.QUEUED)
            .select_related("client", "company")
            .order_by("queued_at")[:5]
        )
        return [
            {
                "type": "chat.queued",
                "chat_id": c.pk,
                "client_name": c.client.full_name,
                "company": c.company.name,
                "queued_at": c.queued_at.isoformat() if c.queued_at else "",
            }
            for c in fila
        ]
