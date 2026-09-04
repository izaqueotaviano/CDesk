"""Audit — trilhas de auditoria e compliance LGPD.

`AuditLog` e `TicketAccessLog` são append-only: a aplicação nunca faz update ou
delete nestas tabelas (idealmente o usuário de banco da app não tem DELETE nelas).
Nenhum app escreve aqui diretamente — só via `audit.services.record()`.
"""

import datetime as dt

from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class AppendOnlyError(Exception):
    """Trilha de auditoria é append-only: UPDATE e DELETE de instância são barrados."""


class AppendOnlyModel(models.Model):
    """Base das trilhas de auditoria: a linha nasce e nunca muda.

    Antes a imutabilidade era só convenção (docstring + admin/API read-only);
    nada impedia um `.save()`/`.delete()` de instância no ORM. Aqui vira invariante:
    - UPDATE (save de linha já existente) → erro;
    - DELETE de instância → erro.

    O expurgo de retenção (LGPD, D18) usa delete **em massa** por queryset, que
    não passa por este método — é um caminho de sistema deliberado, revisado e
    ele mesmo auditado. Continua funcionando; o que se barra aqui é a adulteração
    linha a linha (admin, shell, view mal escrita).
    """

    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnlyError(
                f"{type(self).__name__} é imutável: a linha não pode ser alterada."
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError(
            f"{type(self).__name__} é imutável: a linha não pode ser excluída "
            "individualmente."
        )


class AuditAction(models.TextChoices):
    CREATE = "create", "Criação"
    UPDATE = "update", "Alteração"
    DELETE = "delete", "Exclusão"
    STATUS_CHANGE = "status_change", "Mudança de status"
    ASSIGN = "assign", "Atribuição"
    LOGIN = "login", "Login"
    CONFIG_CHANGE = "config_change", "Configuração"
    EXPORT = "export", "Exportação"
    ANONYMIZE = "anonymize", "Anonimização"
    SCAN_BLOCKED = "scan_blocked", "Anexo bloqueado pelo antivírus"


class AuditLog(AppendOnlyModel):
    actor = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="audit_logs"
    )
    action = models.CharField(max_length=20, choices=AuditAction.choices)
    content_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    object_id = models.CharField(max_length=40)
    target = GenericForeignKey("content_type", "object_id")
    changes = models.JSONField(default=dict, blank=True)  # {"campo": ["antes", "depois"]}
    summary = models.CharField(max_length=250, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=250, blank=True)
    request_id = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "log de auditoria"
        verbose_name_plural = "logs de auditoria"
        indexes = [
            models.Index(fields=["content_type", "object_id", "-created_at"]),
            models.Index(fields=["actor", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.action} {self.content_type_id}#{self.object_id}"


class TicketAccessLog(AppendOnlyModel):
    """Leitura (não só edição) de ticket em equipe restrita — inclusive
    por agente e admin, e inclusive tentativas negadas."""

    ticket = models.ForeignKey(
        "tickets.Ticket", on_delete=models.CASCADE, related_name="access_logs"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="ticket_accesses"
    )
    was_granted = models.BooleanField(default=True)
    context = models.CharField(max_length=40)  # detail | export | api | kanban
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "log de acesso a ticket"
        verbose_name_plural = "logs de acesso a ticket"
        indexes = [
            models.Index(fields=["ticket", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.user_id} acessou {self.ticket_id}"


class DataSubjectRequest(TimeStampedModel):
    """D11: trilha de pedidos LGPD. Anonimização preserva tickets, métricas e o
    histórico das demais empresas — nada é hard-deleted."""

    class Kind(models.TextChoices):
        EXPORT = "export", "Exportação de dados"
        ANONYMIZE = "anonymize", "Anonimização"
        RECTIFY = "rectify", "Retificação"

    class Status(models.TextChoices):
        PENDING = "pending", "Pendente"
        APPROVED = "approved", "Aprovado"      # identidade conferida, pronto para executar
        RUNNING = "running", "Em execução"
        DONE = "done", "Concluído"
        FAILED = "failed", "Falhou"            # ≠ pendente: já tentou e não deu
        REJECTED = "rejected", "Rejeitado"

    # LGPD art. 19: 15 dias para resposta completa. A meta interna é menor —
    # o prazo legal é teto, não expectativa.
    DEADLINE_DAYS = 15

    subject_user = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lgpd_requests",
    )
    subject_company = models.ForeignKey(
        "customers.Company",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="lgpd_requests",
    )
    kind = models.CharField(max_length=15, choices=Kind.choices)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, related_name="requested_lgpd"
    )
    # Quem apertou o botão. Antes o AuditLog creditava `requested_by`, o que
    # dizia a pessoa errada sempre que um admin abria e outro executava —
    # numa trilha de LGPD é exatamente o dado que se quer.
    executed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="executed_lgpd",
    )
    executed_at = models.DateTimeField(null=True, blank=True)

    # Verificação de identidade: executar anonimização sem confirmar quem pediu
    # é o próprio vetor de ataque — basta um e-mail se passando pelo titular.
    verified_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="verified_lgpd",
    )
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_note = models.CharField(
        max_length=250, blank=True,
        help_text="Como a identidade foi confirmada (sessão autenticada, ligação, documento).",
    )

    due_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # Pacote de portabilidade. Fica aqui, e não em ReportExport, porque é onde
    # o auditor procura — e porque expira junto com o pedido.
    export_file = models.FileField(upload_to="lgpd/%Y/%m/", null=True, blank=True)
    export_expires_at = models.DateTimeField(null=True, blank=True)
    result = models.JSONField(default=dict, blank=True)  # o que foi anonimizado
    error = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    # LGPD exige informar o motivo da negativa
    rejection_reason = models.TextField(blank=True)

    class Meta:
        verbose_name = "pedido LGPD"
        verbose_name_plural = "pedidos LGPD"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.get_kind_display()} ({self.get_status_display()})"

    def save(self, *args, **kwargs):
        if self.due_at is None:
            base = self.created_at or timezone.now()
            self.due_at = base + dt.timedelta(days=self.DEADLINE_DAYS)
        super().save(*args, **kwargs)

    @property
    def is_open(self) -> bool:
        return self.status in (
            self.Status.PENDING, self.Status.APPROVED, self.Status.RUNNING,
        )

    @property
    def is_overdue(self) -> bool:
        return bool(self.is_open and self.due_at and self.due_at < timezone.now())

    @property
    def days_left(self) -> int | None:
        if not self.is_open or not self.due_at:
            return None
        return (self.due_at - timezone.now()).days

    def requires_verification(self) -> bool:
        """Exportação é não-destrutiva e o titular já vê esses dados na tela.
        Anonimização é irreversível — essa exige conferência de identidade."""
        return self.kind == self.Kind.ANONYMIZE


class RetentionRun(TimeStampedModel):
    """D18: um ciclo de aplicação da política de retenção.

    Existe por um motivo específico: dry-run cujo resultado só vai para o log
    é teatro — ninguém lê log. Gravando o ciclo, "revisar o que seria apagado
    antes de ligar de verdade" vira uma coisa que dá para fazer na tela.
    """

    class Status(models.TextChoices):
        RUNNING = "running", "Em execução"
        DONE = "done", "Concluído"
        FAILED = "failed", "Falhou"

    dry_run = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.RUNNING)
    finished_at = models.DateTimeField(null=True, blank=True)
    # {"politica": {"matched": 12, "applied": 0, "sample": ["CVZ-2021-000004", ...]}}
    results = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    triggered_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="retention_runs", help_text="Nulo quando veio do agendamento.",
    )

    # Alguém olhou este relatório e disse "pode apagar isso".
    # É o que destrava o primeiro expurgo efetivo — ver `services.retention`.
    reviewed_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_retention_runs",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=250, blank=True)

    class Meta:
        verbose_name = "ciclo de retenção"
        verbose_name_plural = "ciclos de retenção"
        ordering = ["-created_at"]

    def __str__(self):
        modo = "simulação" if self.dry_run else "efetivo"
        return f"Retenção {modo} ({self.get_status_display()})"

    @property
    def total_matched(self) -> int:
        return sum(policy.get("matched", 0) for policy in self.results.values())

    @property
    def total_applied(self) -> int:
        return sum(policy.get("applied", 0) for policy in self.results.values())

    @property
    def is_reviewed(self) -> bool:
        return self.reviewed_at is not None
