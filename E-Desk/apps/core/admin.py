from django.contrib import admin

from apps.core.models import BusinessCalendar, Holiday, SystemConfig


class HolidayInline(admin.TabularInline):
    model = Holiday
    extra = 0


@admin.register(BusinessCalendar)
class BusinessCalendarAdmin(admin.ModelAdmin):
    list_display = ("name", "timezone", "is_default")
    inlines = [HolidayInline]


@admin.register(SystemConfig)
class SystemConfigAdmin(admin.ModelAdmin):
    """Singleton: sem lista, sem "adicionar", sem excluir — só a linha que existe."""

    fieldsets = (
        ("Anexos (D13)", {
            "fields": ("attachment_max_bytes", "attachment_max_files_per_message",
                       "attachment_max_bytes_per_message"),
            "description": (
                "Tamanhos em bytes. 20 MB = 20971520. O somado por mensagem precisa "
                "acompanhar (máx. por arquivo × máx. de arquivos)."
            ),
        }),
    )

    def has_add_permission(self, request):
        return not SystemConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        """Vai direto para a única linha — lista de um item só é atrito."""
        from django.shortcuts import redirect
        from django.urls import reverse

        config = SystemConfig.load()
        return redirect(reverse("admin:core_systemconfig_change", args=[config.pk]))
