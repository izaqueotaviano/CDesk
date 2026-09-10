"""Desenvolvimento local."""

from .base import *  # noqa: F403
from .base import INSTALLED_APPS, env  # noqa: F401

DEBUG = True
# a lista fixa cobre o uso normal (localhost); quem compartilha a instância
# (`./resolv compartilhar`) acrescenta o próprio IP de rede ou o domínio do
# túnel por uma variável de ambiente, sem editar código — ver .env.example
ALLOWED_HOSTS = [
    "localhost", "127.0.0.1", "0.0.0.0", "web",  # noqa: S104 — dev/container
    *env.list("DJANGO_ALLOWED_HOSTS_EXTRA", default=[]),
]

# E-mail em dev: por padrão o código de login (2FA obrigatório) sai no
# TERMINAL do backend — suficiente pra desenvolver sozinho. Para testar com
# outras pessoas (que precisam RECEBER o código), configure o SMTP no .env
# (EMAIL_HOST, EMAIL_HOST_USER, EMAIL_HOST_PASSWORD…) que o dev passa a
# enviar de verdade, igual à produção.
if env("EMAIL_HOST", default=""):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = env("EMAIL_HOST")
    EMAIL_PORT = env.int("EMAIL_PORT", default=587)
    EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
    EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
else:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Código-mestre do 2FA — mora SÓ neste arquivo, que só é carregado em dev.
#
# Com ele, `123456` entra em qualquer conta de desenvolvimento sem caçar o
# código no terminal. A trava que torna isso seguro está em
# `apps/accounts/views.py::_codigo_mestre_de_dev`: ela exige `DEBUG=True`
# ALÉM desta variável, e produção carrega `config.settings.prod` (DEBUG=False,
# sem esta linha). Para exigir o código real mesmo em dev, ponha vazio no .env.
TWO_FACTOR_DEV_CODE = env("TWO_FACTOR_DEV_CODE", default="123456")

# O frontend roda à parte, em outra origem.
#
# A origem dele TEM de estar aqui. Quando não está, o sintoma engana: o login
# funciona e todo o resto dá 403.
#
# O motivo de enganar assim é que a SessionAuthentication do DRF só exige CSRF
# para requisição AUTENTICADA. O login sai anônimo, passa sem token; a partir
# do segundo POST existe sessão, o CSRF passa a valer, o Origin não está na
# lista e volta 403 — inclusive no logout, que é onde a pessoa percebe.
#
# Os valores de fábrica são as portas usuais do Vite; troque pela do seu front
# (ou defina CORS_ALLOWED_ORIGINS no .env).
CORS_ALLOWED_ORIGINS = env.list(
    "CORS_ALLOWED_ORIGINS",
    default=[
        "http://localhost:5174", "http://127.0.0.1:5174",
        "http://localhost:5173", "http://127.0.0.1:5173",   # default do Vite
    ],
)
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

INTERNAL_IPS = ["127.0.0.1"]

# O Swagger (/api/docs/) carrega script e estilo de CDN; só em dev ele existe.
CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        **CONTENT_SECURITY_POLICY["DIRECTIVES"],  # noqa: F405
        "script-src": ("'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"),
        "style-src": ("'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"),
        "img-src": ("'self'", "data:", "https://cdn.jsdelivr.net"),
    }
}

# Executa tasks no processo, sem worker, quando CELERY_TASK_ALWAYS_EAGER=1
CELERY_TASK_ALWAYS_EAGER = env.bool("CELERY_TASK_ALWAYS_EAGER", default=False)
CELERY_TASK_EAGER_PROPAGATES = True
