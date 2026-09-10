"""Varredura antivírus de anexos (D19) — cliente ClamAV.

Este módulo é fino de propósito: fala com o daemon e traduz a resposta em um
veredito. Quem decide o que fazer com o veredito é a task (`tickets.tasks`), e
quem decide o que entregar é a view — a política não mora aqui.

Por que ClamAV via daemon e não uma biblioteca em processo: assinaturas mudam
todo dia (`freshclam`), e carregar a base (~200 MB) em cada worker Celery é
desperdício. O daemon mantém a base em memória e responde por socket.

Contrato de erro:
- `ScanUnavailable` → falha *transitória* (daemon fora do ar, timeout). A task
  faz retry. Nunca vira "limpo".
- `ScanRejected` → falha *definitiva* para este arquivo (maior que o
  `StreamMaxLength` do daemon). Retry não ajuda; vira `error`.
"""

from __future__ import annotations

import logging

from django.conf import settings

logger = logging.getLogger(__name__)

CLEAN = "clean"
INFECTED = "infected"


class ScanUnavailable(Exception):
    """O antivírus não respondeu. Transitório — cabe retry."""


class ScanRejected(Exception):
    """O antivírus recusou este arquivo. Definitivo — não cabe retry."""


def _client():
    """Importa `clamd` só quando vai usar.

    O pacote é um extra (`.[antivirus]`); ambientes que rodam com
    `CLAMAV_ENABLED=False` não precisam dele instalado.
    """
    try:
        import clamd
    except ImportError as exc:  # pragma: no cover - ambiente sem o extra
        raise ScanUnavailable(
            "Pacote 'clamd' não instalado (instale o extra .[antivirus])."
        ) from exc

    return clamd, clamd.ClamdNetworkSocket(
        host=settings.CLAMAV_HOST,
        port=settings.CLAMAV_PORT,
        timeout=settings.CLAMAV_TIMEOUT,
    )


def scan_stream(fileobj) -> tuple[str, str]:
    """Varre um arquivo já aberto em binário.

    Devolve `(CLEAN, "")` ou `(INFECTED, "<assinatura>")`.
    O arquivo é enviado por stream: nada é copiado para disco no worker.
    """
    clamd, client = _client()

    try:
        result = client.instream(fileobj)
    except clamd.BufferTooLongError as exc:
        raise ScanRejected(
            "Arquivo maior que o limite de varredura do daemon "
            "(StreamMaxLength precisa ser >= ATTACHMENT_MAX_BYTES)."
        ) from exc
    except (clamd.ConnectionError, OSError) as exc:
        raise ScanUnavailable(f"ClamAV indisponível: {exc}") from exc

    # {'stream': ('OK', None)} | {'stream': ('FOUND', 'Eicar-Test-Signature')}
    status, signature = result.get("stream", (None, None))

    if status == "OK":
        return CLEAN, ""
    if status == "FOUND":
        return INFECTED, signature or "desconhecida"
    # ERROR do próprio daemon: trata como indisponível, não como aprovação
    raise ScanUnavailable(f"Resposta inesperada do ClamAV: {result!r}")


def ping() -> bool:
    """Health check — usado pelo system check de deploy."""
    try:
        _, client = _client()
        return client.ping() == "PONG"
    except Exception:  # noqa: BLE001 - health check nunca derruba quem chama
        return False
