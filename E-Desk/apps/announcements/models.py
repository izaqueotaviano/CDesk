"""Announcements — mural de avisos com segmentação de público.

Histórico é a própria tabela: "antigo" = ends_at < now(). Nada é apagado.
"""

from django.db import models

from apps.core.models import TimeStampedModel


class AnnouncementKind(models.TextChoices):
    INFO = "info", "Informativo"
    URGENT = "urgent", "Urgente"
    HOLIDAY = "holiday", "Feriado"
    VACATION = "vacation", "Férias da equipe"


class AudienceKind(models.TextChoices):
    ALL = "all", "Todos"
    ALL_INTERNAL = "all_internal", "Todos os internos"
    ALL_CLIENTS = "all_clients", "Todos os clientes"
    TEAMS = "teams", "Equipes específicas"
    ROLES = "roles", "Papéis específicos"
    COMPANIES = "companies", "Empresas específicas"
    PLANS = "plans", "Planos específicos"


class Announcement(TimeStampedModel):
    title = models.CharField(max_length=150)
    body = models.TextField()
    kind = models.CharField(
        max_length=10, choices=AnnouncementKind.choices, default=AnnouncementKind.INFO
    )
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField(null=True, blank=True)  # vazio = sem expiração
    is_pinned = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="announcements"
    )

    audience_kind = models.CharField(
        max_length=15, choices=AudienceKind.choices, default=AudienceKind.ALL_INTERNAL
    )
    target_teams = models.ManyToManyField(
        "accounts.Team", blank=True, related_name="announcements"
    )
    target_roles = models.JSONField(default=list, blank=True)  # ["agent", "supervisor"]
    target_companies = models.ManyToManyField(
        "customers.Company", blank=True, related_name="announcements"
    )
    target_plans = models.ManyToManyField(
        "customers.Plan", blank=True, related_name="announcements"
    )

    class Meta:
        verbose_name = "aviso"
        indexes = [models.Index(fields=["is_active", "starts_at", "ends_at"])]
        ordering = ["-is_pinned", "-starts_at"]

    def __str__(self):
        return self.title


class AnnouncementRead(models.Model):
    announcement = models.ForeignKey(
        Announcement, on_delete=models.CASCADE, related_name="reads"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="announcement_reads"
    )
    read_at = models.DateTimeField(auto_now_add=True)
    dismissed = models.BooleanField(default=False)

    class Meta:
        verbose_name = "leitura de aviso"
        verbose_name_plural = "leituras de aviso"
        constraints = [
            models.UniqueConstraint(
                fields=["announcement", "user"], name="uniq_announcement_read"
            )
        ]

    def __str__(self):
        return f"{self.user_id} leu {self.announcement_id}"
