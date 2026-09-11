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
import math

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


def _tamanho_legivel(quantidade_bytes: int, *, para_cima: bool = False) -> str:
    """Tamanho em texto para o usuário final.

    A razão de existir é a mensagem de recusa: ela sai da API como
    `{"files": "..."}` (apps/tickets/views.py) e é exibida crua na tela, então
    precisa dizer QUANTO veio e QUAL é o teto. A divisão inteira fixa em KB/MB
    que estava aqui escrevia "tem 0 KB; o limite é 0 MB" sempre que os números
    não caíam na unidade escolhida — verdadeiro e inútil.

    `para_cima` existe porque arredondar tudo do mesmo jeito produz uma recusa
    que se contradiz: um arquivo de 10 MB + 1 byte contra um limite de 10 MB
    virava "tem 10 MB; o limite por arquivo é 10 MB". Quem estoura o limite
    normalmente estoura por pouco, então essa era justamente a faixa mais
    provável. O TAMANHO ENVIADO arredonda para cima e o LIMITE para baixo: cada
    um erra para o lado que mantém a frase verdadeira, e os dois números nunca
    colidem quando o arquivo de fato passou do teto.
    """
    for unidade, fator in (("MB", 1024 * 1024), ("KB", 1024)):
        if quantidade_bytes >= fator:
            decimos = quantidade_bytes / fator * 10
            decimos = math.ceil(decimos) if para_cima else math.floor(decimos)
            valor = f"{decimos / 10:.1f}".rstrip("0").rstrip(".")
            return f"{valor.replace('.', ',')} {unidade}"
    return f"{quantidade_bytes} bytes"


def validate_upload(upload, *, already_uploaded_bytes: int = 0) -> str:
    """Valida e devolve o MIME detectado. Levanta AttachmentRejected."""
    max_file, max_msg, _ = limits()

    if upload.size > max_file:
        raise AttachmentRejected(
            f"'{upload.name}' tem {_tamanho_legivel(upload.size, para_cima=True)}; "
            f"o limite por arquivo é {_tamanho_legivel(max_file)}."
        )
    if already_uploaded_bytes + upload.size > max_msg:
        raise AttachmentRejected(
            f"O total de anexos "
            f"({_tamanho_legivel(already_uploaded_bytes + upload.size, para_cima=True)}) "
            f"ultrapassa o limite de {_tamanho_legivel(max_msg)} por mensagem."
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


def validar_uploads(uploads) -> list[tuple]:
    """Confere o lote INTEIRO — contagem, tamanho somado e tipo — sem gravar nada.

    Devolve os pares `(upload, mime)` já com o MIME real farejado e levanta
    `AttachmentRejected` no primeiro problema.

    Está separada de `attach_to_message` porque `apps/tickets/views.py` precisa
    recusar o anexo ANTES de criar o chamado ou a mensagem: `create_ticket` abre
    e fecha a própria transação (ATOMIC_REQUESTS=False,
    config/settings/base.py), então o 400 que só vinha na hora de gravar o anexo
    deixava o chamado nascido; a tela lia 400 como "não criou", o agente
    reenviava e nascia um chamado duplicado.

    Chamar isto é de graça e sem efeito colateral — a varredura antivírus só é
    agendada em `attach_to_message`, pós-commit —, por isso a view pode conferir
    antes e deixar `attach_to_message` conferir de novo na hora de gravar.
    """
    _, _, max_files = limits()
    if len(uploads) > max_files:
        raise AttachmentRejected(
            f"Máximo de {max_files} arquivo(s) por mensagem; você enviou {len(uploads)}."
        )

    total = 0
    validados = []
    for upload in uploads:
        mime = validate_upload(upload, already_uploaded_bytes=total)
        total += upload.size
        validados.append((upload, mime))
    return validados


def attach_to_message(*, message, uploads, uploaded_by) -> list[TicketAttachment]:
    """Valida o lote inteiro antes de gravar qualquer arquivo.

    Validar tudo primeiro evita a mensagem ficar com metade dos anexos quando
    o terceiro arquivo é recusado. A regra em si mora em `validar_uploads`, que
    a view chama antes de criar o chamado — aqui ela é reaplicada porque este
    serviço continua sendo a única porta de gravação (é chamado direto por
    testes e pela importação, sem passar por view nenhuma).

    D19: o anexo nasce em quarentena (`pending`) e a varredura é agendada
    **após o commit** — antes disso o worker poderia buscar uma linha que ainda
    não existe. Com o antivírus desligado o registro nasce `skipped`, que é a
    verdade ("não verificado"), e não `clean`.
    """
    validated = validar_uploads(uploads)

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
