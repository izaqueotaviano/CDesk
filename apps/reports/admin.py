from django.contrib import admin

from apps.reports.models import ReportExport


@admin.register(ReportExport)
class ReportExportAdmin(admin.ModelAdmin):
    list_display = ("report_key", "format", "status", "requested_by",
                    "row_count", "created_at", "expires_at")
    list_filter = ("status", "format", "report_key")
