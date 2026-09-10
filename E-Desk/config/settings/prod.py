"""Produção.

O sistema trafega dado de cliente sob LGPD: nada aqui é opcional. Cada
bloco diz o que protege; `manage.py check --deploy` (apps/core/checks.py)
recusa subir quando algo daqui foi afrouxado por engano.

Topologia assumida: nginx na frente (TLS, rate limit, SPA estática) →
uvicorn/gunicorn neste processo → PostgreSQL e Redis em rede privada.
"""

from .base import *  # noqa: F403
from .base import DATABASES, env

DEBUG = False

# Vazio derruba o boot com erro claro (environ levanta ImproperlyConfigured):
# é o comportamento certo — um `*` aqui aceitaria qualquer Host e abriria
# cache poisoning e link de redefinição apontando para domínio de terceiro.
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS")

# --------------------------------------------------------------------------- #
# HTTPS
# --------------------------------------------------------------------------- #
# O TLS termina no nginx; o Django confia no X-Forwarded-Proto SÓ porque o
# nginx sobrescreve o header (deploy/nginx/resolv.conf) — um cliente não
# consegue forjá-lo. O redirect fica ligado como cinto: se alguém expuser a
# porta 8000 direto, a resposta é 301 para https, não a página.
SECURE_SSL_REDIRECT = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_REDIRECT_EXEMPT = [r"^health/?$"]  # o health check do orquestrador é HTTP interno
# HSTS: 1 ano, subdomínios e preload. Só ligue o preload depois de UM ciclo
# com HSTS válido em todos os subdomínios — na lista do navegador não há
# desfazer rápido.
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", 60 * 60 * 24 * 365)
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=True)

# --------------------------------------------------------------------------- #
# Cookies e sessão
# --------------------------------------------------------------------------- #
# Prefixo `__Host-`: o navegador só aceita o cookie se vier de HTTPS, sem
# `Domain` e com `Path=/` — um subdomínio comprometido não consegue
# sobrescrever a sessão de app.empresa.com.br.
SESSION_COOKIE_NAME = "__Host-resolv_sessao"
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"  # Strict quebraria o link do e-mail que abre o ticket
SESSION_EXPIRE_AT_BROWSER_CLOSE = False
SESSION_COOKIE_AGE = 60 * 60 * 12  # 12h — um turno; o 2FA cobra de novo no dia seguinte
# sessão no banco com cache na frente: revogar ("Minha conta → Desconectar")
# continua valendo na hora, e a leitura por requisição não bate no Postgres
SESSION_ENGINE = "django.contrib.sessions.backends.cached_db"

CSRF_COOKIE_NAME = "__Host-resolv_csrf"
CSRF_COOKIE_SECURE = True
CSRF_COOKIE_HTTPONLY = False  # a SPA lê o token para mandar no header X-CSRFToken
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_USE_SESSIONS = False
CSRF_FAILURE_VIEW = "apps.core.views.csrf_recusado"

# --------------------------------------------------------------------------- #
# Headers
# --------------------------------------------------------------------------- #
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"

# --------------------------------------------------------------------------- #
# Banco (PostgreSQL com TLS)
# --------------------------------------------------------------------------- #
# `verify-full` confere o certificado E o hostname do servidor: sem isso um
# MITM na rede do provedor lê a conexão. `require` (cifra sem verificar) só
# quando o banco está no mesmo host/rede privada e não há CA disponível —
# e aí é decisão escrita no .env, não default.
DATABASES["default"]["OPTIONS"] = {
    **DATABASES["default"].get("OPTIONS", {}),
    "sslmode": env("DB_SSLMODE", default="verify-full"),
    **({"sslrootcert": env("DB_SSLROOTCERT")} if env("DB_SSLROOTCERT", default="") else {}),
    # um statement preso não segura um worker para sempre
    "options": "-c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000",
    "application_name": "resolv",
}
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

# --------------------------------------------------------------------------- #
# Redis
# --------------------------------------------------------------------------- #
# Senha obrigatória: a URL precisa vir como redis://:senha@host:6379 (ou
# rediss:// com TLS). O check de deploy recusa URL sem credencial.

# --------------------------------------------------------------------------- #
# Admin e documentação
# --------------------------------------------------------------------------- #
# O caminho do admin sai do óbvio: `/admin/` recebe varredura automática o
# dia inteiro. Não é segurança por si (o login continua sendo a tranca), só
# tira o ruído do log e o alvo fácil.
ADMIN_URL = env("DJANGO_ADMIN_URL", default="admin/").strip("/") + "/"
API_DOCS_ENABLED = env.bool("API_DOCS_ENABLED", default=False)

# --------------------------------------------------------------------------- #
# E-mail
# --------------------------------------------------------------------------- #
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = env("EMAIL_HOST")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_TIMEOUT = 15

ADMINS = [tuple(pair.split(":", 1)) for pair in env.list("DJANGO_ADMINS", default=[])]
SERVER_EMAIL = env(
    "SERVER_EMAIL",
    default=env("DEFAULT_FROM_EMAIL", default="Resolv <no-reply@example.com>"),
)
