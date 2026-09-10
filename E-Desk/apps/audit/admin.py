from django.contrib import admin

from apps.audit.models import AuditLog, DataSubjectRequest, RetentionRun, TicketAccessLog


class ReadOnlyAdmin(admin.ModelAdmin):
    """Trilha append-only: nem admin altera ou apaga."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AuditLog)
class AuditLogAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "actor", "action", "content_type", "object_id", "summary")
    list_filter = ("action", "content_type")
    date_hierarchy = "created_at"


@admin.register(TicketAccessLog)
class TicketAccessLogAdmin(ReadOnlyAdmin):
    list_display = ("created_at", "ticket", "user", "was_granted", "context")
    list_filter = ("was_granted", "context")


@admin.register(DataSubjectRequest)
class DataSubjectRequestAdmin(admin.ModelAdmin):
    list_display = ("kind", "status", "subject_user", "subject_company",
                    "requested_by", "executed_at")
    list_filter = ("kind", "status")


@admin.register(RetentionRun)
class RetentionRunAdmin(admin.ModelAdmin):
    """Ciclos de retenção (D18) — a janela para revisar o dry-run."""

    list_display = ("created_at", "dry_run", "status", "total_matched",
                    "total_applied", "triggered_by")
    list_filter = ("dry_run", "status")
    readonly_fields = [f.name for f in RetentionRun._meta.fields]
    actions = ["simulate_now", "mark_reviewed"]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False  # é trilha: não se apaga

    @admin.action(description="Marcar como revisado (destrava o expurgo efetivo)")
    def mark_reviewed(self, request, queryset):
        from django.utils import timezone

        eligible = queryset.filter(dry_run=True, reviewed_at__isnull=True)
        count = eligible.update(
            reviewed_by=request.user,
            reviewed_at=timezone.now(),
            review_note="Revisado pelo Django Admin.",
        )
        self.message_user(
            request,
            f"{count} simulação(ões) marcada(s) como revisada(s). "
            "Com RETENTION_DRY_RUN=0 o expurgo passa a rodar.",
        )

    @admin.action(description="Simular um ciclo agora (não apaga nada)")
    def simulate_now(self, request, queryset):
        from apps.audit.services import retention

        cycle = retention.run(dry_run=True, triggered_by=request.user)
        self.message_user(
            request,
            f"Simulação #{cycle.pk}: {cycle.total_matched} registro(s) elegível(is).",
        )
