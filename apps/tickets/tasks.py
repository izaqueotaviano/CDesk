"""Tasks de tickets: varredura antivírus dos anexos (D19).

Política de quarentena, num lugar só:

- o anexo nasce `pending` e **não é servido** até a varredura liberar;
- `infected` bloqueia para sempre e **não apaga o arquivo** — ele é a evidência
  de que aquele upload aconteceu, e apagar destrói a trilha de auditoria;
- daemon fora do ar é retry, nunca aprovação: um antivírus que não respondeu
  não é um antivírus que aprovou.
"""

import logging

from celery import shared_task
from django.utils import timezone

from apps.tickets.models import ScanStatus, TicketAttachment
from apps.tickets.services import antivirus

logger = logging.getLogger(__name__)

# estados terminais: rescan não faz nada (idempotência no retry do broker)
_SETTLED = {ScanStatus.CLEAN, ScanStatus.INFECTED, ScanStatus.SKIPPED}


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def scan_attachment(self, attachment_id: int) -> str:
    attachment = TicketAttachment.objects.filter(pk=attachment_id).first()
    if attachment is None:
        return "gone"  # anexo removido antes da varredura: nada a fazer
    if attachment.scan_status in _SETTLED:
        return attachment.scan_status

    attachment.scan_attempts += 1

    try:
        with attachment.file.open("rb") as handle:
            verdict, signature = antivirus.scan_stream(handle)

    except antivirus.ScanUnavailable as exc:
        # transitório: tenta de novo. Só desiste depois de esgotar as tentativas,
        # e desistir significa BLOQUEAR (fail-closed), não liberar.
        attachment.save(update_fields=["scan_attempts"])
        if self.request.retries >= self.max_retries:
            logger.error("Varredura esgotou as tentativas: anexo %s", attachment_id)
            return _settle(attachment, ScanStatus.ERROR, error=str(exc))
        raise self.retry(exc=exc) from exc

    except antivirus.ScanRejected as exc:
        return _settle(attachment, ScanStatus.ERROR, error=str(exc))

    except FileNotFoundError as exc:
        return _settle(attachment, ScanStatus.ERROR, error=f"Arquivo ausente: {exc}")

    if verdict == antivirus.INFECTED:
        _settle(attachment, ScanStatus.INFECTED, signature=signature)
        _report_infection(attachment)
        return ScanStatus.INFECTED

    return _settle(attachment, ScanStatus.CLEAN)


def _settle(attachment, status, *, signature: str = "", error: str = "") -> str:
    attachment.scan_status = status
    attachment.scan_signature = signature[:200]
    attachment.scan_error = error[:250]
    attachment.scanned_at = timezone.now()
    attachment.save(update_fields=[
        "scan_status", "scan_signature", "scan_error", "scan_attempts", "scanned_at",
    ])
    return status


def _report_infection(attachment) -> None:
    """Malware não é um erro silencioso: quem enviou precisa saber que o anexo
    não chegou, e a auditoria precisa do registro."""
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditAction, AuditLog
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email, ticket_url

    ticket = attachment.message.ticket

    AuditLog.objects.create(
        actor=attachment.uploaded_by,
        action=AuditAction.SCAN_BLOCKED,
        content_type=ContentType.objects.get_for_model(TicketAttachment),
        object_id=str(attachment.pk),
        summary=(
            f"Anexo '{attachment.filename}' bloqueado no ticket "
            f"{ticket.reference}: {attachment.scan_signature}"
        ),
        changes={"signature": attachment.scan_signature, "checksum": attachment.checksum},
    )

    if attachment.uploaded_by_id:
        titulo = f"Anexo bloqueado: {attachment.filename}"
        corpo = (
            "A verificação antivírus identificou uma ameaça neste arquivo, "
            "que não ficará disponível para download."
        )
        url = ticket_url(ticket, attachment.uploaded_by)
        notify(
            recipient=attachment.uploaded_by,
            kind=NotificationKind.ATTACHMENT_BLOCKED,
            title=titulo,
            body=corpo,
            url=url,
            ticket=ticket,
        )
        if attachment.uploaded_by.email and quer_email(
            attachment.uploaded_by, NotificationKind.ATTACHMENT_BLOCKED
        ):
            from django.conf import settings

            queue_email(
                to=attachment.uploaded_by.email,
                subject=titulo,
                template="attachment_blocked",
                context={
                    "user_name": attachment.uploaded_by.full_name,
                    "filename": attachment.filename,
                    "link": f"{settings.SITE_URL}{url}",
                },
                ticket=ticket,
                dedupe_key=f"attachment-blocked:{attachment.pk}",
            )


@shared_task
def auto_close_stale_pending() -> int:
    """Fecha tickets 'aguardando o cliente' sem resposta além do prazo (D5).

    O prazo e a mensagem vêm do SystemConfig; prazo zero desliga a regra. Roda
    de hora em hora (ver CELERY_BEAT_SCHEDULE)."""
    from apps.tickets.services import ticket_service

    fechados = ticket_service.auto_close_stale_pending()
    if fechados:
        logger.info("Fechamento automático: %s ticket(s) sem resposta do cliente.", fechados)
    return fechados


@shared_task
def warn_stale_pending() -> int:
    """Avisa o cliente antes do fechamento automático por falta de resposta.

    Roda de hora em hora, sempre ANTES de `auto_close_stale_pending` no mesmo
    ciclo (ver CELERY_BEAT_SCHEDULE) — o aviso vale a pena só se chegar antes
    do fechamento que ele anuncia."""
    from apps.tickets.services import ticket_service

    avisados = ticket_service.warn_stale_pending()
    if avisados:
        logger.info("Aviso de fechamento: %s ticket(s) avisado(s).", avisados)
    return avisados
