"""Testes automatizados.

A suíte de isolamento entre empresas (docs/04) roda contra estas settings.
"""

from .base import *  # noqa: F403

DEBUG = False
ALLOWED_HOSTS = ["*"]

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# Bloqueio por força bruta desligado na suíte: os testes de login erram a
# senha de propósito dezenas de vezes contra o mesmo e-mail e IP. Quem
# exercita a trava liga com override_settings (test_forca_bruta).
AXES_ENABLED = False

# Antivírus desligado por padrão na suíte: os testes que exercitam a
# quarentena ligam com override_settings e mockam o daemon (test_antivirus).
CLAMAV_ENABLED = False

# Login por Google desligado por padrão na suíte, mesmo que o `.env` local
# de quem roda os testes tenha um domínio de verdade configurado (developer
# machine) — sem isto, `login_por_google_ativo()` mudava de resultado
# dependendo de QUEM rodava a suíte, não do teste. Quem quer exercitar
# "Google ativo" liga com o fixture `settings` (ver test_google_adapter.py,
# test_admin_api.py::test_refused_for_google_only_account).
GOOGLE_OAUTH_ALLOWED_DOMAINS = []

# Expurgo real jamais roda em teste por acidente.
RETENTION_DRY_RUN = True

# anexos de teste vão para um diretório descartável
import tempfile  # noqa: E402

MEDIA_ROOT = tempfile.mkdtemp(prefix="resolv-test-media-")

# O WhiteNoise avisa "No directory at: staticfiles/" a cada requisição da
# suíte, porque `collectstatic` não roda em teste — eram ~400 linhas de aviso
# por execução, o bastante para enterrar um aviso de verdade. A suíte não
# serve estático: o armazenamento simples não procura manifesto nem diretório.
STATIC_ROOT = tempfile.mkdtemp(prefix="resolv-test-static-")
STORAGES = {
    **STORAGES,  # noqa: F405 — vem do base
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
