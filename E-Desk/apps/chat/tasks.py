"""Tasks Celery do chat v2.

- `convert_unattended_chats`: o timeout de fila — ninguém pegou dentro do
  tempo configurado, vira o ticket "Chat não atendido" na equipe padrão.
  Roda a cada minuto no beat; idempotente (conversão é OneToOne no banco).
- `scan_chat_file`: varredura antivírus do anexo, mesma política de
  quarentena dos anexos de ticket (D19).
"""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

_SETTLED = {"clean", "infected", "skipped"}  # estados terminais da varredura


@shared_task
def convert_unattended_chats() -> int:
    """Fila esquecida vira ticket — o cliente não fica falando sozinho.

    Sem equipe padrão configurada (e sem nenhuma equipe ativa), o chat fica
    na fila e o problema é logado: converter para lugar nenhum não existe.
    """
    from apps.accounts.models import Team
    from apps.chat.models import Chat, ChatConfig, ChatStatus
    from apps.tickets.services import ticket_service

    config = ChatConfig.load()
    corte = timezone.now() - timezone.timedelta(minutes=config.queue_timeout_minutes)
    equipe = config.default_team or Team.objects.filter(is_active=True).first()

    esquecidos = Chat.objects.filter(status=ChatStatus.QUEUED, queued_at__lt=corte)
    convertidos = 0
    for chat in esquecidos:
        if equipe is None:
            logger.error(
                "Chat #%s estourou o timeout mas não há equipe padrão "
                "configurada — configure em Configurações do chat.", chat.pk,
            )
            continue
        ticket_service.create_from_chat(
            chat=chat, team=equipe, subject="Chat não atendido", auto=True,
        )
        convertidos += 1
        logger.info("Chat #%s não atendido em %s min — virou ticket.",
                    chat.pk, config.queue_timeout_minutes)
    return convertidos


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def scan_chat_file(self, chat_file_id: int) -> str:
    """Antivírus do anexo de chat — nasce em quarentena, só é servido depois
    de `clean`/`skipped`; daemon fora do ar é retry, nunca aprovação."""
    from apps.chat.models import ChatFile, ChatScanStatus
    from apps.tickets.services import antivirus

    chat_file = ChatFile.objects.filter(pk=chat_file_id).first()
    if chat_file is None:
        return "gone"
    if chat_file.scan_status in _SETTLED:
        return chat_file.scan_status

    chat_file.scan_attempts += 1

    try:
        with chat_file.file.open("rb") as handle:
            verdict, signature = antivirus.scan_stream(handle)

    except antivirus.ScanUnavailable as exc:
        chat_file.save(update_fields=["scan_attempts"])
        if self.request.retries >= self.max_retries:
            logger.error("Varredura esgotou as tentativas: anexo de chat %s", chat_file_id)
            return _settle(chat_file, ChatScanStatus.ERROR, error=str(exc))
        raise self.retry(exc=exc) from exc

    except antivirus.ScanRejected as exc:
        return _settle(chat_file, ChatScanStatus.ERROR, error=str(exc))

    except FileNotFoundError as exc:
        return _settle(chat_file, ChatScanStatus.ERROR, error=f"Arquivo ausente: {exc}")

    if verdict == antivirus.INFECTED:
        _settle(chat_file, ChatScanStatus.INFECTED, signature=signature)
        _report_infection(chat_file)
        return ChatScanStatus.INFECTED

    return _settle(chat_file, ChatScanStatus.CLEAN)


def _settle(chat_file, status, *, signature: str = "", error: str = "") -> str:
    chat_file.scan_status = status
    chat_file.scan_signature = signature[:200]
    chat_file.scan_error = error[:250]
    chat_file.scanned_at = timezone.now()
    chat_file.save(update_fields=[
        "scan_status", "scan_signature", "scan_error", "scan_attempts", "scanned_at",
    ])
    return status


def _report_infection(chat_file) -> None:
    """Malware não é erro silencioso: quem enviou fica sabendo, e a auditoria
    registra — mesma régua do anexo de ticket bloqueado."""
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditAction, AuditLog
    from apps.chat.models import ChatFile
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify

    AuditLog.objects.create(
        actor=chat_file.uploaded_by,
        action=AuditAction.SCAN_BLOCKED,
        content_type=ContentType.objects.get_for_model(ChatFile),
        object_id=str(chat_file.pk),
        summary=(
            f"Anexo de chat '{chat_file.filename}' bloqueado "
            f"(chat #{chat_file.message.chat_id}): {chat_file.scan_signature}"
        ),
        changes={"signature": chat_file.scan_signature, "checksum": chat_file.checksum},
    )

    if chat_file.uploaded_by_id:
        notify(
            recipient=chat_file.uploaded_by,
            kind=NotificationKind.ATTACHMENT_BLOCKED,
            title=f"Anexo bloqueado: {chat_file.filename}",
            body=(
                "A verificação antivírus identificou uma ameaça neste arquivo, "
                "que não ficará disponível para download."
            ),
            url="/app/chat",
        )
