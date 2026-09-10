"""TOTP (RFC 6238) em Python puro — sem dependência nova.

O algoritmo é pequeno demais para justificar mais um pacote no requirements:
HOTP (RFC 4226) é um HMAC-SHA1 do contador com truncamento dinâmico, e TOTP
só troca o contador por `tempo // 30`. Qualquer aplicativo autenticador
(Google Authenticator, Authy, 1Password…) fala exatamente este dialeto:
SHA-1, período de 30 segundos, 6 dígitos.
"""

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

# Parâmetros padrão do ecossistema de autenticadores — mudar qualquer um
# quebraria a compatibilidade com os aplicativos que o usuário já tem.
PERIOD_SECONDS = 30
DIGITS = 6


def generate_secret() -> str:
    """Segredo novo em base32 (20 bytes, o tamanho canônico do RFC)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii")


def hotp(secret_b32: str, counter: int) -> str:
    """HOTP (RFC 4226): HMAC-SHA1 do contador + truncamento dinâmico."""
    key = base64.b32decode(secret_b32.upper().encode("ascii"), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    binary = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10 ** DIGITS)).zfill(DIGITS)


def totp_code(secret_b32: str, at: float | None = None) -> str:
    """Código da janela de 30s que contém o instante `at` (agora, se omitido)."""
    moment = time.time() if at is None else at
    return hotp(secret_b32, int(moment // PERIOD_SECONDS))


def verify_totp(secret_b32: str, code: str, at: float | None = None,
                window: int = 1) -> bool:
    """Confere aceitando ±`window` janelas — relógio de celular atrasa.

    Comparação em tempo constante: o código tem só um milhão de combinações,
    não faz sentido ainda vazar dica por timing.
    """
    if not secret_b32 or len(code) != DIGITS or not code.isdigit():
        return False
    moment = time.time() if at is None else at
    counter = int(moment // PERIOD_SECONDS)
    try:
        return any(
            hmac.compare_digest(hotp(secret_b32, counter + drift), code)
            for drift in range(-window, window + 1)
        )
    except (ValueError, TypeError):
        return False  # segredo corrompido não pode virar 500 no login


def otpauth_uri(*, secret_b32: str, email: str, issuer: str = "E-Desk") -> str:
    """URI `otpauth://` que os aplicativos autenticadores importam."""
    label = quote(f"{issuer}:{email}")
    return (
        f"otpauth://totp/{label}?secret={secret_b32}"
        f"&issuer={quote(issuer)}&algorithm=SHA1"
        f"&digits={DIGITS}&period={PERIOD_SECONDS}"
    )
