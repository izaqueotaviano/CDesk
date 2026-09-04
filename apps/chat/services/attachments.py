"""Anexo de chat: mesma política de segurança do anexo de ticket (D13/D19).

A checagem de magic bytes, a lista de extensões bloqueadas e os limites de
tamanho vêm por IMPORT de `tickets.services.attachments` — a política de
"o que pode ser enviado" não pode divergir entre os dois lugares que aceitam
upload. O que É próprio do chat (o modelo `ChatFile`, a varredura agendada)
mora aqui. Cobre também o print colado (Ctrl+V): o front o transforma num
arquivo comum antes de enviar, então a validação é a mesma.
"""

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.chat.models import ChatFile, ChatScanStatus
from apps.tickets.services.attachments import (  # noqa: F401 — reexportado
    AttachmentRejected,
    checksum,
    limits,
    validate_upload,
)

__all__ = ["AttachmentRejected", "attach_to_chat_message"]


def attach_to_chat_message(*, message, uploads, uploaded_by) -> list[ChatFile]:
    """Valida o lote inteiro antes de gravar qualquer arquivo — recusar o 3º
    não pode deixar os 2 primeiros presos numa mensagem pela metade."""
    _, _, max_files = limits()
    if len(uploads) > max_files:
        raise AttachmentRejected(
            f"Máximo de {max_files} arquivo(s) por mensagem; você enviou {len(uploads)}."
        )

    total = 0
    validated = []
    for upload in uploads:
        mime = validate_upload(upload, already_uploaded_bytes=total)
        total += upload.size
        validated.append((upload, mime))

    scanning = settings.CLAMAV_ENABLED
    initial = ChatScanStatus.PENDING if scanning else ChatScanStatus.SKIPPED

    created = []
    for upload, mime in validated:
        created.append(
            ChatFile.objects.create(
                message=message,
                file=upload,
                filename=upload.name[:255],
                content_type=mime,
                size_bytes=upload.size,
                checksum=checksum(upload),
                uploaded_by=uploaded_by,
                scan_status=initial,
                scanned_at=None if scanning else timezone.now(),
            )
        )

    if scanning:
        for chat_file in created:
            _schedule_scan(chat_file.pk)

    return created


def _schedule_scan(chat_file_id: int) -> None:
    from apps.chat.tasks import scan_chat_file

    transaction.on_commit(lambda: scan_chat_file.delay(chat_file_id))
