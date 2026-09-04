from django.contrib import admin

from apps.chat.models import BannedWord, Chat, ChatConfig, ChatMessage


class ChatMessageInline(admin.TabularInline):
    model = ChatMessage
    extra = 0
    readonly_fields = ("author", "body", "sent_at", "is_system")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Chat)
class ChatAdmin(admin.ModelAdmin):
    list_display = ("id", "company", "client", "agent", "status",
                    "queued_at", "closed_at", "timeout_converted")
    list_filter = ("status", "company", "timeout_converted")
    inlines = [ChatMessageInline]


@admin.register(ChatConfig)
class ChatConfigAdmin(admin.ModelAdmin):
    pass


@admin.register(BannedWord)
class BannedWordAdmin(admin.ModelAdmin):
    list_display = ("word",)
