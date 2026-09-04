"""Ambiente de demonstração — um contêiner só, para o Railway.

Diferente de `prod.py`, que assume front e back separados, aqui o objetivo é
uma URL única que qualquer pessoa abre e testa: o Django serve a SPA já buildada
e a API no mesmo domínio (sem CORS, sem cookie cross-site), e um `entrypoint`
migra e semeia dados de demonstração na primeira subida.

Não é para dado real de cliente. É uma vitrine: senha de demo pública, e-mail
no console, sem antivírus. Para produção de verdade, use `prod.py`.
"""

from django.core.management.utils import get_random_secret_key

from .base import *  # noqa: F403
from .base import env

DEBUG = False

# Railway injeta o domínio público; aceitamos ele e qualquer *.railway.app, mais
# o que for passado à mão. Sem host casando, o Django recusa tudo com 400.
_railway_host = env("RAILWAY_PUBLIC_DOMAIN", default="")
ALLOWED_HOSTS = [
    h for h in [
        _railway_host,
        ".railway.app",
        *env.list("DJANGO_ALLOWED_HOSTS", default=[]),
    ] if h
] or ["*"]  # fallback só para o primeiro boot antes de configurar o host

CSRF_TRUSTED_ORIGINS = [
    o for o in [
        f"https://{_railway_host}" if _railway_host else "",
        "https://*.railway.app",
        *env.list("CSRF_TRUSTED_ORIGINS", default=[]),
    ] if o
]

# SECRET_KEY não pode faltar e derrubar o primeiro deploy. Se não vier do
# ambiente, geramos uma efêmera — o custo é que as sessões caem a cada
# redeploy, aceitável numa demo. Em uso sério, defina DJANGO_SECRET_KEY.
SECRET_KEY = env("DJANGO_SECRET_KEY", default=None) or get_random_secret_key()

# Railway encerra o TLS e encaminha em HTTP com este header.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SESSION_COOKIE_SAMESITE = "Lax"
# SEM SECURE_SSL_REDIRECT: o proxy do Railway já entrega HTTPS, e forçar o
# redirect aqui arrisca laço quando o health check bate em HTTP interno.

# --- API pura -------------------------------------------------------------- #
# Este backend não serve frontend nenhum. O front é um deploy separado e fala
# com esta API por CORS — preencha `CORS_ALLOWED_ORIGINS` e
# `CSRF_TRUSTED_ORIGINS` com a origem dele (ver .env.example).
#
# A documentação do contrato fica ligada aqui porque este ambiente é vitrine:
# quem está construindo o front abre /api/docs/ e lê o schema.
API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=True)

# --- demo: sem dependências externas pesadas ------------------------------- #
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
# libera o seed de demonstração (senha pública) fora do DEBUG — este ambiente
# é vitrine, não produção real
DEMO_SEED_ALLOWED = True
# sem daemon de antivírus na demo — senão todo anexo fica em quarentena
CLAMAV_ENABLED = env.bool("CLAMAV_ENABLED", default=False)
# um contêiner só: as tarefas rodam no próprio processo, sem worker/beat.
# O custo é que varreduras periódicas (SLA, chats abandonados) não disparam
# sozinhas — irrelevante para um ambiente de teste.
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
