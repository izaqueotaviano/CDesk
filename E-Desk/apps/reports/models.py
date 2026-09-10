"""Reports — exportação assíncrona.

Sem tabelas agregadas nesta fase: em 50–500 tickets/mês, annotate/aggregate sobre
Ticket e TicketStatusEvent resolvem com folga (docs/02). Ponto de virada
documentado: acima de ~5k tickets/mês, introduzir TicketDailyMetric.
"""

from django.db import models

from apps.core.models import TimeStampedModel


class ExportFormat(models.TextChoices):
    CSV = "csv", "CSV"
    XLSX = "xlsx", "Excel"
    PDF = "pdf", "PDF"


class ReportExport(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pendente"
        RUNNING = "running", "Gerando"
        DONE = "done", "Pronto"
        FAILED = "failed", "Falhou"


    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="report_exports"
    )
    report_key = models.CharField(max_length=50)  # by_agent | by_company | by_user | ...
    params = models.JSONField(default=dict, blank=True)  # período, filtros
    format = models.CharField(max_length=5, choices=ExportFormat.choices)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    file = models.FileField(upload_to="exports/%Y/%m/", null=True, blank=True)
    row_count = models.PositiveIntegerField(null=True, blank=True)
    error = models.TextField(blank=True)
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="D18: arquivo expurgado após 7 dias."
    )

    class Meta:
        verbose_name = "exportação de relatório"
        verbose_name_plural = "exportações de relatório"

    def __str__(self):
        return f"{self.report_key}.{self.format} ({self.status})"
