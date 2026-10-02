from django.apps import AppConfig


class ChatConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.chat"
    label = "chat"
    verbose_name = "Chat"

    def ready(self):
        # conecta o `post_save` que avisa a fila quando ela anda
        # (`services/fila._fila_mudou`) — sem este import o receptor só
        # existiria depois que alguém importasse o módulo por acaso
        from apps.chat.services import fila  # noqa: F401
