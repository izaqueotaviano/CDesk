"""Rotas WebSocket (docs/01 §5).

- ws/chat/<id>/ : sala do chat (ChatConsumer)
- ws/me/        : canal pessoal do widget global e notificações (UserConsumer)
"""

from django.urls import path

from apps.chat.consumers import ChatConsumer, UserConsumer

websocket_urlpatterns = [
    path("ws/chat/<int:chat_id>/", ChatConsumer.as_asgi()),
    path("ws/me/", UserConsumer.as_asgi()),
]
