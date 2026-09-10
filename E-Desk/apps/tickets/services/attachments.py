"""Anexos (D13): validação no upload e download sempre autenticado.

Regras:
- tamanho máximo por arquivo e por mensagem;
- allowlist por *magic bytes* — nunca pela extensão nem pelo Content-Type
  enviado pelo cliente, que são controlados por quem faz o upload;
- sha256 gravado para deduplicação e conferência de integridade;
- o arquivo NUNCA tem URL pública: quem serve é uma view que reavalia
  `ticket.is_content_visible_to(user)` a cada download;
- D19: o anexo nasce em quarentena e só é servido depois que a varredura
  antivírus liberou — magic bytes provam que o arquivo é mesmo um PDF, não
  que é um PDF inofensivo.
"""

from __future__ import annotations

import hashlib

import magic
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.tickets.models import ScanStatus, TicketAttachment

# Extensões perigosas independentemente do que o magic disser.
BLOCKED_SUFFIXES = {
    ".exe", ".dll", ".so", ".bat", ".cmd", ".com", ".scr", ".msi",
    ".sh", ".ps1", ".jar", ".app", ".deb", ".rpm",
}


class AttachmentRejected(Exception):
    """Upload recusado — a view devolve 400 com a razão."""


def _sniff(upload) -> str:
    """MIME real pelos primeiros bytes. Não confia no cliente."""
    head = upload.read(2048)
    upload.seek(0)
    return magic.from_buffer(head, mime=True)


def limits():
    """Limites correntes, do `SystemConfig` (admin) com fallback nas settings.

    Fallback existe para banco recém-migrado: sem ele, um erro de leitura de
    configuração viraria "nenhum anexo é aceito".
    """
    from apps.core.models import SystemConfig

    try:
        config = SystemConfig.load()
        return (
            config.attachment_max_bytes,
            config.attachment_max_bytes_per_message,
            config.attachment_max_files_per_message,
        )
    except Exception:  # noqa: BLE001 - configuração nunca derruba o upload
        return (
            settings.ATTACHMENT_MAX_BYTES,
            settings.ATTACHMENT_MAX_BYTES_PER_MESSAGE,
            settings.ATTACHMENT_MAX_FILES_PER_MESSAGE,
        )


def validate_upload(upload, *, already_uploaded_bytes: int = 0) -> str:
    """Valida e devolve o MIME detectado. Levanta AttachmentRejected."""
    max_file, max_msg, _ = limits()

    if upload.size > max_file:
        raise AttachmentRejected(
            f"'{upload.name}' tem {upload.size // 1024} KB; o limite por arquivo "
            f"é {max_file // 1024 // 1024} MB."
        )
    if already_uploaded_bytes + upload.size > max_msg:
        raise AttachmentRejected(
            f"O total de anexos ultrapassa {max_msg // 1024 // 1024} MB por mensagem."
        )

    name = (upload.name or "").lower()
    if any(name.endswith(suffix) for suffix in BLOCKED_SUFFIXES):
        raise AttachmentRejected(f"Tipo de arquivo não permitido: '{upload.name}'.")

    detected = _sniff(upload)
    if detected not in settings.ATTACHMENT_ALLOWED_MIME:
        raise AttachmentRejected(
            f"'{upload.name}' é do tipo {detected}, que não é aceito."
        )
    return detected


def checksum(upload) -> str:
    digest = hashlib.sha256()
    for chunk in upload.chunks():
        digest.update(chunk)
    upload.seek(0)
    return digest.hexdigest()


def attach_to_message(*, message, uploads, uploaded_by) -> list[TicketAttachment]:
    """Valida o lote inteiro antes de gravar qualquer arquivo.

    Validar tudo primeiro evita a mensagem ficar com metade dos anexos quando
    o terceiro arquivo é recusado.

    D19: o anexo nasce em quarentena (`pending`) e a varredura é agendada
    **após o commit** — antes disso o worker poderia buscar uma linha que ainda
    não existe. Com o antivírus desligado o registro nasce `skipped`, que é a
    verdade ("não verificado"), e não `clean`.
    """
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
    initial = ScanStatus.PENDING if scanning else ScanStatus.SKIPPED

    created = []
    for upload, mime in validated:
        created.append(
            TicketAttachment.objects.create(
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
        for attachment in created:
            _schedule_scan(attachment.pk)

    return created


def _schedule_scan(attachment_id: int) -> None:
    from apps.tickets.tasks import scan_attachment

    transaction.on_commit(lambda: scan_attachment.delay(attachment_id))


def purge_blob(attachment) -> bool:
    """Apaga o arquivo mantendo a linha.

    Usado pela retenção (D18) e pela anonimização LGPD (D11). A linha fica com
    nome, tamanho, checksum e autor: a thread continua legível ("houve um anexo
    aqui, removido em DD/MM") e o histórico das outras empresas não muda.

    Não dá para "anonimizar" o conteúdo de um binário — ou o blob sai, ou fica.
    Idempotente: chamar de novo num anexo já expurgado não faz nada.
    """
    if attachment.purged_at:
        return False

    if attachment.file:
        attachment.file.delete(save=False)
    attachment.file = ""
    attachment.purged_at = timezone.now()
    attachment.save(update_fields=["file", "purged_at"])
    return True
