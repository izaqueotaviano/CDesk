"""Notifications — notificações in-app e outbox de e-mail.

Consumidor de eventos dos demais apps. O outbox (`OutboundEmail`) dá idempotência
e reprocessamento às tasks Celery — nenhum app manda e-mail direto.
"""

from django.db import models

from apps.core.models import TimeStampedModel


class NotificationKind(models.TextChoices):
    TICKET_CREATED = "ticket_created", "Ticket novo"
    TICKET_ASSIGNED = "ticket_assigned", "Ticket atribuído"
    TICKET_OWNER_SET = "ticket_owner_set", "Dono técnico definido"
    TICKET_REPLIED = "ticket_replied", "Ticket respondido"
    TICKET_REOPENED = "ticket_reopened", "Ticket reaberto"
    # Ciclo de vida visto pelo CLIENTE (o portal): o e-mail de "seu chamado
    # foi resolvido/encerrado" e o de "sua conversa por chat terminou" — a
    # regra do portal é avisar por e-mail da abertura ao encerramento.
    TICKET_CLOSED = "ticket_closed", "Chamado encerrado"
    MENTION = "mention", "Menção"
    SLA_WARNING = "sla_warning", "SLA próximo do limite"
    SLA_BREACHED = "sla_breached", "SLA estourado"
    CHAT_INCOMING = "chat_incoming", "Chat na fila"
    CHAT_CONVERTED = "chat_converted", "Chat virou chamado"
    CHAT_CLOSED = "chat_closed", "Chat encerrado"
    ANNOUNCEMENT = "announcement", "Aviso"
    ATTACHMENT_BLOCKED = "attachment_blocked", "Anexo bloqueado"
    LGPD_DEADLINE = "lgpd_deadline", "Prazo de pedido LGPD"
    KANBAN_DUE = "kanban_due", "Prazo do quadro vencido"


class Notification(models.Model):
    recipient = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="notifications"
    )
    kind = models.CharField(max_length=25, choices=NotificationKind.choices)
    title = models.CharField(max_length=150)
    body = models.CharField(max_length=400, blank=True)
    url = models.CharField(max_length=300, blank=True)
    ticket = models.ForeignKey(
        "tickets.Ticket",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
    )
    actor = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="triggered_notifications",
    )
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)


    class Meta:
        verbose_name = "notificação"
        verbose_name_plural = "notificações"
        indexes = [models.Index(fields=["recipient", "read_at", "-created_at"])]

    def __str__(self):
        return f"{self.get_kind_display()} → {self.recipient_id}"


class NotificationPreference(models.Model):
    user = models.OneToOneField(
        "accounts.User", on_delete=models.CASCADE, related_name="notification_preference"
    )
    in_app = models.JSONField(default=dict, blank=True)  # {"sla_warning": true, ...}
    email = models.JSONField(default=dict, blank=True)


    class Meta:
        verbose_name = "preferência de notificação"
        verbose_name_plural = "preferências de notificação"

    def __str__(self):
        return f"Preferências de {self.user_id}"


class OutboundEmail(TimeStampedModel):
    """Outbox: e-mail é gravado aqui e enviado por task Celery; `dedupe_key`
    impede duplicata em retry."""


    class Status(models.TextChoices):
        PENDING = "pending", "Pendente"
        SENT = "sent", "Enviado"
        FAILED = "failed", "Falhou"

    to_email = models.EmailField()
    subject = models.CharField(max_length=200)
    template = models.CharField(max_length=80)
    context = models.JSONField(default=dict, blank=True)
    ticket = models.ForeignKey(
        "tickets.Ticket",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="emails",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    error = models.TextField(blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    dedupe_key = models.CharField(max_length=120, unique=True, null=True, blank=True)

    class Meta:
        verbose_name = "e-mail de saída"
        verbose_name_plural = "e-mails de saída"

    def __str__(self):
        return f"{self.subject} → {self.to_email} ({self.status})"
