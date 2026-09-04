from django.contrib import admin

from apps.tickets.models import (
    SLAPolicy,
    Ticket,
    TicketAttachment,
    TicketMacro,
    TicketMessage,
    TicketStatusEvent,
    TicketTag,
)


@admin.register(SLAPolicy)
class SLAPolicyAdmin(admin.ModelAdmin):
    list_display = ("name", "plan", "team", "first_response_minutes",
                    "resolution_minutes", "use_business_hours", "is_active")
    list_filter = ("plan", "team", "is_active")


class TicketMessageInline(admin.StackedInline):
    model = TicketMessage
    extra = 0
    fields = ("author", "body", "is_public", "source", "is_first_response", "created_at")
    readonly_fields = ("created_at",)
    autocomplete_fields = ("author",)


class TicketStatusEventInline(admin.TabularInline):
    """Histórico de status — sempre gravado pelo service, aqui só para leitura."""

    model = TicketStatusEvent
    extra = 0
    can_delete = False
    readonly_fields = ("from_status", "to_status", "changed_by", "is_reopen",
                       "is_automatic", "note", "created_at")

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("reference", "subject", "company", "team", "status",
                    "priority", "assignee", "reopen_count", "created_at")
    list_filter = ("status", "team", "priority", "source", "company")
    search_fields = ("reference", "subject", "requester__email", "company__name")
    date_hierarchy = "created_at"
    autocomplete_fields = ("company", "requester", "assignee", "owner", "closed_by")
    # status NUNCA é editável aqui: toda transição passa por ticket_service,
    # que grava TicketStatusEvent e agenda os efeitos colaterais (pesquisa de
    # satisfação, franquia de manutenção). Editar direto pelo admin pularia
    # tudo isso e violaria a regra do módulo (ticket_service.py, docstring).
    readonly_fields = ("reference", "status", "reopen_count", "last_reopened_at",
                       "sla_cycle", "first_response_at", "waiting_agent_seconds",
                       "waiting_customer_seconds", "created_at", "updated_at")
    inlines = [TicketMessageInline, TicketStatusEventInline]

    fieldsets = (
        (None, {"fields": ("reference", "company", "requester", "team",
                           "subject", "status", "priority", "source")}),
        ("Atribuição", {"fields": ("assignee", "owner")}),
        ("Resolução (D4)", {"fields": ("resolution_started_at", "resolution_ended_at",
                                       "closed_at", "closed_by")}),
        ("SLA", {"fields": ("sla_policy", "sla_first_response_due_at",
                            "sla_resolution_due_at", "sla_first_response_breached",
                            "sla_resolution_breached", "sla_cycle")}),
        ("Métricas", {"classes": ("collapse",),
                      "fields": ("first_response_at", "reopen_count", "last_reopened_at",
                                 "waiting_agent_seconds", "waiting_customer_seconds",
                                 "created_at", "updated_at")}),
    )


@admin.register(TicketTag)
class TicketTagAdmin(admin.ModelAdmin):
    list_display = ("name", "color")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(TicketMacro)
class TicketMacroAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "priority", "assignee", "is_active", "order")


@admin.register(TicketAttachment)
class TicketAttachmentAdmin(admin.ModelAdmin):
    """Janela de operação da quarentena (D19).

    O ponto útil aqui é a ação de re-varrer: `error` é fail-closed, então um
    anexo legítimo que pegou o daemon fora do ar fica inacessível até alguém
    mandar tentar de novo. Sem isso, a saída seria mexer no banco à mão.
    """

    list_display = ("filename", "message", "size_bytes", "scan_status",
                    "scan_signature", "scan_attempts", "scanned_at")
    list_filter = ("scan_status", "content_type")
    search_fields = ("filename", "checksum", "scan_signature")
    readonly_fields = ("file", "filename", "content_type", "size_bytes", "checksum",
                       "uploaded_by", "scan_signature", "scan_error", "scan_attempts",
                       "scanned_at", "created_at", "updated_at")
    actions = ["rescan"]

    def has_add_permission(self, request):
        return False  # anexo entra por upload, nunca pelo admin

    @admin.action(description="Re-executar varredura antivírus")
    def rescan(self, request, queryset):
        from apps.tickets.models import ScanStatus
        from apps.tickets.tasks import scan_attachment

        # infectado não volta para a fila: o veredito não é ambíguo
        eligible = queryset.exclude(scan_status=ScanStatus.INFECTED)
        eligible.update(scan_status=ScanStatus.PENDING, scan_error="")
        for pk in eligible.values_list("pk", flat=True):
            scan_attachment.delay(pk)
        self.message_user(request, f"{eligible.count()} anexo(s) recolocado(s) na fila.")
