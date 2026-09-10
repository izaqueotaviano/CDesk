from django.contrib import admin

from apps.notifications.models import Notification, OutboundEmail


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("recipient", "kind", "title", "read_at", "created_at")
    list_filter = ("kind",)


@admin.register(OutboundEmail)
class OutboundEmailAdmin(admin.ModelAdmin):
    """Outbox — somente leitura; envio é responsabilidade da task Celery."""

    list_display = ("to_email", "subject", "template", "status", "attempts", "sent_at")
    list_filter = ("status", "template")

    def has_add_permission(self, request):
        return False
