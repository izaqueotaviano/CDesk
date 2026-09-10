"""Aplicação da política de retenção (D18).

Cada política é uma função isolada que recebe o corte e devolve o que casou e o
que foi aplicado. Isso permite três coisas que importam:

- **dry-run de verdade**: a mesma função roda em simulação, contando e
  amostrando sem tocar em nada;
- **falha localizada**: uma política que quebra não impede as outras;
- **teste por política**, sem orquestrar o ciclo inteiro.

⚠️ **Desvio consciente do texto do D18.** A tabela original dizia "anonimizar
autor" para tickets vencidos. Anonimizar o *usuário* porque um ticket dele fez
5 anos destruiria o cadastro de um cliente ativo — o titular pode ter um ticket
de 2021 e outro de ontem. O que expira é o **conteúdo do ticket**, não a pessoa:
assunto, corpo das mensagens e anexos saem; referência, datas, status, empresa e
métricas ficam. Anonimizar a pessoa continua sendo ato de pedido LGPD (D11),
nunca efeito colateral do calendário.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

PURGED_MARKER = "[expurgado por retenção]"

# quantos identificadores guardar por política, para o dry-run ser conferível
SAMPLE_SIZE = 20

# processa em lotes: um expurgo anual pode casar dezenas de milhares de linhas
BATCH_SIZE = 500


def _cutoff(key: str) -> dt.datetime:
    return timezone.now() - dt.timedelta(days=settings.RETENTION_DAYS[key])


def _result(matched: int, applied: int, sample: list) -> dict:
    return {"matched": matched, "applied": applied, "sample": [str(s) for s in sample]}


# --------------------------------------------------------------------------- #
# Políticas
# --------------------------------------------------------------------------- #

def purge_ticket_content(*, dry_run: bool) -> dict:
    """Tickets fechados há mais que o prazo perdem o conteúdo, não a linha.

    O gatilho é `closed_at`, que é reescrito a cada fechamento — um ticket
    reaberto em 2030 não pode expirar pelo fechamento de 2026.
    """
    from apps.tickets.models import Ticket, TicketMessage, TicketStatus
    from apps.tickets.services.attachments import purge_blob

    queryset = Ticket.objects.filter(
        status=TicketStatus.CLOSED,
        closed_at__lt=_cutoff("ticket_after_close"),
        retention_purged_at__isnull=True,
    ).order_by("pk")

    matched = queryset.count()
    sample = list(queryset.values_list("reference", flat=True)[:SAMPLE_SIZE])
    if dry_run or not matched:
        return _result(matched, 0, sample)

    applied = 0
    while True:
        batch = list(queryset[:BATCH_SIZE])
        if not batch:
            break
        for ticket in batch:
            with transaction.atomic():
                TicketMessage.objects.filter(ticket=ticket).exclude(
                    body=PURGED_MARKER
                ).update(body=PURGED_MARKER)
                _purge_ticket_attachments(ticket, purge_blob)
                _purge_origin_chat(ticket)
                ticket.subject = PURGED_MARKER
                ticket.retention_purged_at = timezone.now()
                ticket.save(update_fields=["subject", "retention_purged_at"])
            applied += 1

    return _result(matched, applied, sample)


def _purge_ticket_attachments(ticket, purge_blob) -> None:
    from apps.tickets.models import TicketAttachment

    attachments = TicketAttachment.objects.filter(
        message__ticket=ticket, purged_at__isnull=True
    )
    for attachment in attachments:
        purge_blob(attachment)


def _purge_origin_chat(ticket) -> None:
    """A transcrição do chat é a mesma conversa do ticket — expira junto."""
    from apps.chat.models import ChatMessage

    chat_id = getattr(ticket, "origin_chat_id", None)
    if chat_id:
        ChatMessage.objects.filter(chat_id=chat_id, is_system=False).exclude(
            body=PURGED_MARKER
        ).update(body=PURGED_MARKER)


def purge_audit_log(*, dry_run: bool) -> dict:
    """Expurgo do log de auditoria — **exceto** as entradas de LGPD.

    Se o log de uma anonimização sumisse em 2 anos, você perderia justamente a
    prova de que cumpriu o pedido. A entrada de LGPD é isenta; o `DataSubjectRequest`
    é o registro primário e nunca é expurgado.
    """
    from apps.audit.models import AuditAction, AuditLog

    queryset = AuditLog.objects.filter(created_at__lt=_cutoff("audit_log")).exclude(
        action=AuditAction.ANONYMIZE
    )
    return _delete(queryset, dry_run=dry_run, label="pk")


def purge_ticket_access_log(*, dry_run: bool) -> dict:
    from apps.audit.models import TicketAccessLog

    queryset = TicketAccessLog.objects.filter(
        created_at__lt=_cutoff("ticket_access_log")
    )
    return _delete(queryset, dry_run=dry_run, label="pk")


def purge_read_notifications(*, dry_run: bool) -> dict:
    from apps.notifications.models import Notification

    queryset = Notification.objects.filter(
        read_at__isnull=False, read_at__lt=_cutoff("notification_read")
    )
    return _delete(queryset, dry_run=dry_run, label="pk")


def purge_outbound_email(*, dry_run: bool) -> dict:
    from apps.notifications.models import OutboundEmail

    queryset = OutboundEmail.objects.filter(created_at__lt=_cutoff("outbound_email"))
    return _delete(queryset, dry_run=dry_run, label="pk")


def purge_export_files(*, dry_run: bool) -> dict:
    """Arquivo de exportação vencido: apaga o arquivo, **mantém a linha** — o
    registro de que a exportação foi feita é o que a auditoria precisa."""
    from apps.reports.models import ReportExport

    queryset = ReportExport.objects.filter(
        expires_at__lt=timezone.now()
    ).exclude(file="")

    matched = queryset.count()
    sample = list(queryset.values_list("pk", flat=True)[:SAMPLE_SIZE])
    if dry_run or not matched:
        return _result(matched, 0, sample)

    applied = 0
    for export in queryset.iterator(chunk_size=BATCH_SIZE):
        export.file.delete(save=False)
        export.file = ""
        export.save(update_fields=["file"])
        applied += 1
    return _result(matched, applied, sample)


def _delete(queryset, *, dry_run: bool, label: str) -> dict:
    matched = queryset.count()
    sample = list(queryset.values_list(label, flat=True)[:SAMPLE_SIZE])
    if dry_run or not matched:
        return _result(matched, 0, sample)

    applied = 0
    while True:
        # deleta por fatia de pks: `queryset[:N].delete()` não é permitido
        chunk = list(queryset.values_list("pk", flat=True)[:BATCH_SIZE])
        if not chunk:
            break
        deleted, _ = queryset.model.objects.filter(pk__in=chunk).delete()
        applied += len(chunk)
        if not deleted:
            break  # nada saiu: evita laço infinito se algo protege as linhas
    return _result(matched, applied, sample)


# ordem importa: conteúdo de ticket antes dos logs, para o expurgo dos logs já
# enxergar as entradas geradas pelo próprio ciclo anterior
POLICIES = {
    "ticket_content": purge_ticket_content,
    "audit_log": purge_audit_log,
    "ticket_access_log": purge_ticket_access_log,
    "notification_read": purge_read_notifications,
    "outbound_email": purge_outbound_email,
    "report_export_file": purge_export_files,
}


class PurgeNotAuthorized(Exception):
    """Expurgo efetivo pedido sem simulação revisada."""


def _blocking_reason() -> str | None:
    """Por que este expurgo efetivo não pode rodar ainda.

    Trocar `RETENTION_DRY_RUN` para 0 é uma linha de env. O que essa linha
    libera é a exclusão irreversível de anos de histórico, na madrugada
    seguinte, sem ninguém por perto. A trava exige que alguém tenha aberto um
    relatório de simulação e dito, com nome e data, "pode apagar isso".

    Depois da primeira revisão a trava não incomoda mais: qualquer simulação
    revisada mantém os ciclos seguintes liberados.
    """
    from apps.audit.models import RetentionRun

    if not settings.RETENTION_REQUIRE_REVIEWED_DRY_RUN:
        return None
    reviewed = RetentionRun.objects.filter(
        dry_run=True, reviewed_at__isnull=False
    ).order_by("-reviewed_at").first()
    if reviewed is None:
        return (
            "Nenhuma simulação de retenção foi revisada. Rode um ciclo em "
            "modo simulação, confira o relatório na aba Retenção e marque-o "
            "como revisado antes de habilitar o expurgo."
        )
    return None


def run(*, dry_run: bool | None = None, triggered_by=None, force: bool = False):
    """Executa um ciclo completo e devolve o `RetentionRun` gravado.

    Levanta `PurgeNotAuthorized` se for um expurgo efetivo sem simulação
    revisada — falhar alto é melhor que apagar em silêncio.
    """
    from apps.audit.models import RetentionRun

    if dry_run is None:
        dry_run = settings.RETENTION_DRY_RUN

    if not dry_run and not force:
        reason = _blocking_reason()
        if reason:
            raise PurgeNotAuthorized(reason)

    cycle = RetentionRun.objects.create(dry_run=dry_run, triggered_by=triggered_by)
    results = {}

    for name, policy in POLICIES.items():
        try:
            results[name] = policy(dry_run=dry_run)
        except Exception as exc:  # noqa: BLE001 - uma política não derruba as outras
            logger.exception("Política de retenção '%s' falhou", name)
            results[name] = {"matched": 0, "applied": 0, "sample": [], "error": str(exc)}

    failed = [name for name, r in results.items() if r.get("error")]
    cycle.results = results
    cycle.status = RetentionRun.Status.FAILED if failed else RetentionRun.Status.DONE
    cycle.error = "; ".join(failed)
    cycle.finished_at = timezone.now()
    cycle.save(update_fields=["results", "status", "error", "finished_at"])

    _audit(cycle)
    return cycle


def _audit(cycle) -> None:
    """Expurgo sem trilha é indistinguível de perda de dados."""
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditAction, AuditLog, RetentionRun

    modo = "simulação" if cycle.dry_run else "expurgo"
    AuditLog.objects.create(
        actor=cycle.triggered_by,
        action=AuditAction.DELETE,
        content_type=ContentType.objects.get_for_model(RetentionRun),
        object_id=str(cycle.pk),
        summary=(
            f"Retenção ({modo}): {cycle.total_matched} elegível(is), "
            f"{cycle.total_applied} aplicado(s)"
        ),
        changes=cycle.results,
    )
