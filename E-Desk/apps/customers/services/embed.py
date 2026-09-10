"""Chat embutido (o "mini chat" na console do cliente) — a confiança de
identidade, num lugar só (docs/14-seguranca.md §10).

Duas assinaturas diferentes, dois propósitos diferentes — não confunda uma
com a outra:

1. **Assinatura da identidade declarada** (`compute_signature`/
   `verify_signature`): a página que hospeda o widget (algo no Vtex/Tray)
   diz "esta pessoa é ana@acme.com" e prova isso com a `secret` DAQUELA
   empresa. É o que substitui o login dentro do iframe.

2. **Token de acesso do widget** (`issue_access_token`/`verify_access_token`):
   depois que a identidade acima foi aceita, a mini-janela precisa se
   autenticar sozinha nas próximas chamadas (REST e WebSocket) — SEM
   cookie, de propósito (cookie de sessão em iframe entre domínios
   diferentes é bloqueado por padrão no Safari, "SameSite" ou não). Este
   token é assinado com `SECRET_KEY` do Django (não com a `secret` da
   empresa — são famílias de segredo diferentes: uma é por empresa e sai
   pro cliente configurar em algum backend dele, a outra é nossa e nunca
   sai daqui) e vale por poucas horas.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from django.core import signing


def generate_secret() -> str:
    """64 caracteres hex (256 bits) — o mesmo tamanho de uma chave de API.
    `secrets`, não `random`: precisa ser imprevisível o bastante pra
    resistir a quem tenta adivinhar assinaturas HMAC. Usada tanto no
    `default` do model quanto em "regenerar chave" (apps/customers/admin_api.py)
    — uma função só, pra nunca haver dois jeitos de gerar segredo no sistema."""
    return secrets.token_hex(32)

# Janela de tolerância da assinatura de identidade: uma URL assinada capturada
# (print de tela, log de proxy, histórico do navegador) só serve por isto.
# 5 minutos é folgado o bastante pro carregamento da página + a rede, e curto
# o bastante pra não virar um link permanente.
SIGNATURE_WINDOW_SECONDS = 5 * 60

# O token de acesso do widget dura um turno de atendimento — mais que isso e
# uma aba esquecida aberta vira sessão indefinida; menos, e a pessoa perderia
# a conversa no meio por causa de um detalhe de implementação.
ACCESS_TOKEN_MAX_AGE_SECONDS = 8 * 60 * 60

_IDENTITY_SALT = "customers.embed.identity"
_ACCESS_TOKEN_SALT = "customers.embed.access-token"  # noqa: S105 — salt de assinatura, não senha


def compute_signature(*, secret: str, company_slug: str, email: str, ts: int) -> str:
    """HMAC-SHA256 hex da declaração `(empresa, e-mail, quando)`.

    `\n` como separador (impossível de aparecer em slug ou timestamp, e um
    e-mail com `\n` já não passaria na validação de e-mail de ninguém) —
    junção por `+` ou `|` sem isso permitiria ambiguidade tipo
    `"ab"+"c"` == `"a"+"bc"`.
    """
    mensagem = f"{company_slug}\n{email.strip().lower()}\n{ts}".encode()
    return hmac.new(secret.encode(), mensagem, hashlib.sha256).hexdigest()


def verify_signature(
    *, secret: str, company_slug: str, email: str, ts: int, signature: str
) -> bool:
    """Confere a assinatura E a janela de tempo. `compare_digest`: comparação
    em tempo constante — comparar hex com `==` vaza, por quanto tempo a
    função demora, ONDE a assinatura recebida difere da certa, e um
    atacante com acesso à rede consegue reconstruir o hash byte a byte
    medindo isso (ataque de timing, conhecido e prático contra HMAC)."""
    if abs(time.time() - ts) > SIGNATURE_WINDOW_SECONDS:
        return False
    esperada = compute_signature(secret=secret, company_slug=company_slug, email=email, ts=ts)
    return hmac.compare_digest(esperada, signature.lower())


def issue_access_token(user_id: int) -> str:
    """Token opaco e assinado (não é um JWT — não precisa ser lido por
    ninguém além de nós, então nada de payload em Base64 legível à toa).
    `django.core.signing` já cuida de assinatura + expiração; o `salt`
    separa este uso de qualquer outro `signing.dumps` do projeto (link de
    redefinição de senha, por exemplo) — mesma chave-mestra, domínios
    diferentes, uma assinatura de um não serve pro outro."""
    return signing.dumps({"uid": user_id}, salt=_ACCESS_TOKEN_SALT)


def verify_access_token(token: str) -> int | None:
    """`None` pra qualquer motivo de falha (expirado, adulterado, chave
    errada) — quem chama não precisa (nem deve) saber qual foi."""
    try:
        payload = signing.loads(
            token, salt=_ACCESS_TOKEN_SALT, max_age=ACCESS_TOKEN_MAX_AGE_SECONDS
        )
    except signing.BadSignature:
        return None
    uid = payload.get("uid")
    return uid if isinstance(uid, int) else None


def resolve_trusted_origin(request, *, company) -> str | None:
    """A origem confiável que bate com a requisição — `None` se nenhuma.

    Confere contra `Origin` primeiro (é o que os navegadores mandam num
    `fetch`/carregamento de iframe moderno) e cai pro `Referer` só como
    fallback (alguns navegadores antigos, ou a primeira navegação de
    endereço direto na barra, não mandam `Origin`). Nunca aceita "sem
    nenhum dos dois" — page sem Origin nem Referer não prova nada.
    """
    from urllib.parse import urlsplit

    cabecalho = request.META.get("HTTP_ORIGIN") or request.META.get("HTTP_REFERER")
    if not cabecalho:
        return None
    partes = urlsplit(cabecalho)
    origem = f"{partes.scheme}://{partes.netloc}".lower()

    if not hasattr(company, "chat_embed"):
        return None
    autorizadas = {o.lower() for o in company.chat_embed.origins.values_list("origin", flat=True)}
    return origem if origem in autorizadas else None
