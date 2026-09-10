from django.contrib import admin

from apps.customers.models import (
    Company,
    Plan,
    QuotaPeriodCounter,
    TicketQuotaConsumption,
)


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ("name", "rank", "default_ticket_limit", "default_limit_period",
                    "chat_enabled", "is_active")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name", "plan", "effective_ticket_limit_display",
                    "effective_limit_period", "limit_scope", "is_active")
    list_filter = ("plan", "is_active", "limit_scope")
    search_fields = ("name", "legal_name", "tax_id")
    prepopulated_fields = {"slug": ("name",)}
    autocomplete_fields = ("account_manager",)

    @admin.display(description="limite efetivo")
    def effective_ticket_limit_display(self, obj):
        limit = obj.effective_ticket_limit
        suffix = "" if obj.ticket_limit is None else " (override)"
        return ("ilimitado" if limit is None else limit) if not suffix else f"{limit}{suffix}"


@admin.register(TicketQuotaConsumption)
class TicketQuotaConsumptionAdmin(admin.ModelAdmin):
    """Ledger de cota — somente leitura: consumo é registrado pelo service."""

    list_display = ("ticket", "company", "user", "period_start", "limit_snapshot")
    list_filter = ("company",)
    date_hierarchy = "period_start"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(QuotaPeriodCounter)
class QuotaPeriodCounterAdmin(admin.ModelAdmin):
    list_display = ("company", "user", "period_start", "used")
    list_filter = ("company",)

    def has_add_permission(self, request):
        return False
