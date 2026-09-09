"""Settings comuns a todos os ambientes.

Nada aqui pode depender de um ambiente específico: o que varia mora em
`dev.py`, `prod.py` ou `test.py`. Segredos vêm sempre do ambiente, nunca do código.
"""

import datetime as dt
from pathlib import Path

import environ
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parents[2]

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, []),
)
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")


# --------------------------------------------------------------------------- #
# Aplicações
# --------------------------------------------------------------------------- #

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Só pelo lookup `unaccent` da busca (extensão criada em
    # tickets/0024) — nenhum campo de modelo vem daqui.
    "django.contrib.postgres",
    "django.contrib.sites",  # exigido pelo allauth
]

THIRD_PARTY_APPS = [
    "axes",  # bloqueio por força bruta no login — ver bloco "Força bruta"
    "csp",  # Content-Security-Policy nas páginas que o Django serve (admin)
    "rest_framework",
    "corsheaders",
    "drf_spectacular",
    "channels",
    "django_celery_beat",
    # Login por Google Workspace (allauth) — internos entram por aqui OU por
    # e-mail/senha em /login/cliente (a allowlist de domínio decide quem passa,
    # ver apps/accounts/adapters.py e GOOGLE_OAUTH_ALLOWED_DOMAINS abaixo).
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
]

LOCAL_APPS = [
    "apps.core",
    "apps.accounts",
    "apps.customers",
    "apps.tickets",
    "apps.chat",
    "apps.kanban",
    "apps.announcements",
    "apps.notifications",
    "apps.audit",
    "apps.reports",
    "apps.knowledge",
    "apps.notes",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS


MIDDLEWARE = [
    # primeiro de todos: o id da requisição precisa existir antes de qualquer
    # log, inclusive o do CORS recusando uma origem
    "apps.core.middleware.RequestIdMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "csp.middleware.CSPMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    # por último: só transforma a exceção de bloqueio do axes em resposta
    # (para o admin; na API quem faz isso é apps.core.exceptions)
    "axes.middleware.AxesMiddleware",
]

SITE_ID = 1  # exigido pelo allauth

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# --------------------------------------------------------------------------- #
# Banco de dados
# --------------------------------------------------------------------------- #

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["ATOMIC_REQUESTS"] = False
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", 60)

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --------------------------------------------------------------------------- #
# Autenticação
# --------------------------------------------------------------------------- #

AUTH_USER_MODEL = "accounts.User"

AUTHENTICATION_BACKENDS = [
    # PRIMEIRO: com a trava fechada ele recusa antes de o ModelBackend olhar
    # a senha — é o que impede a enumeração por tempo de resposta
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",  # e-mail/senha — cliente e interno
    "allauth.account.auth_backends.AuthenticationBackend",  # Google
]

# 12 caracteres e três classes: é o que segura ataque de dicionário sem
# empurrar a pessoa para o post-it. O `UserAttributeSimilarityValidator`
# compara com e-mail e nome — `AnaAlmeida2026!` não passa.
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
     "OPTIONS": {"user_attributes": ("email", "full_name"), "max_similarity": 0.6}},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "apps.accounts.validators.VariedadeDeCaracteresValidator"},
]

# Argon2 na frente: o hash novo é gravado com ele; os antigos (PBKDF2)
# continuam válidos e são re-hasheados no próximo login. Exige `argon2-cffi`.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

# --- Força bruta (django-axes) ---------------------------------------------
# Duas camadas, com papéis diferentes:
#   - o throttle `login` do DRF (abaixo) limita POSTs no endpoint POR IP —
#     segura quem varre uma lista de e-mails de um lugar só;
#   - o axes conta FALHAS de `authenticate()` por (e-mail, IP) e fecha a
#     trava por AXES_COOLOFF_TIME — segura quem insiste numa conta.
# A chave é o PAR de propósito: só por e-mail, qualquer um trancaria a conta
# de outra pessoa de fora (negação de serviço); só por IP, um ataque
# distribuído passa. Contagem no cache (Redis), não no banco: não cresce
# tabela e some sozinha ao expirar.
AXES_ENABLED = env.bool("AXES_ENABLED", default=True)
AXES_HANDLER = "axes.handlers.cache.AxesCacheHandler"
AXES_CACHE = "default"
AXES_FAILURE_LIMIT = env.int("AXES_FAILURE_LIMIT", 5)
AXES_COOLOFF_TIME = dt.timedelta(minutes=env.int("AXES_COOLOFF_MINUTES", 15))
AXES_LOCKOUT_PARAMETERS = [["username", "ip_address"]]
AXES_RESET_ON_SUCCESS = True
AXES_USERNAME_FORM_FIELD = "username"  # LoginView chama authenticate(username=email)
AXES_LOCKOUT_CALLABLE = "apps.accounts.axes.bloqueado"
# mesmo leitor de IP das sessões: atrás do nginx o IP real vem no X-Forwarded-For
AXES_CLIENT_IP_CALLABLE = "apps.accounts.sessions.client_ip"
AXES_VERBOSE = False  # o histórico de tentativas fica em AccessEvent, não no log

# --- allauth (Google OAuth) ---
# Clientes não se auto-cadastram (convite); internos entram por Google OAuth
# restrito à allowlist de domínios do Workspace (regras nos adapters,
# apps/accounts/adapters.py) OU por e-mail/senha, igual ao cliente — as duas
# portas ficam abertas (ver apps.accounts.views.LoginView).
ACCOUNT_ADAPTER = "apps.accounts.adapters.AccountAdapter"
SOCIALACCOUNT_ADAPTER = "apps.accounts.adapters.SocialAccountAdapter"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*"]
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
ACCOUNT_EMAIL_VERIFICATION = "none"  # internos: verificado pelo Google; clientes: convite
SOCIALACCOUNT_AUTO_SIGNUP = True
# rotas da SPA — LOGIN_URL segue em uso pelo DRF (401 -> redireciona pra cá)
LOGIN_URL = "/login"
LOGIN_REDIRECT_URL = "/inicio"
ACCOUNT_LOGOUT_REDIRECT_URL = "/login"

GOOGLE_OAUTH_CLIENT_ID = env("GOOGLE_OAUTH_CLIENT_ID", default="")
GOOGLE_OAUTH_CLIENT_SECRET = env("GOOGLE_OAUTH_CLIENT_SECRET", default="")
# allowlist de domínios aceitos no SSO — vazia bloqueia o login interno
GOOGLE_OAUTH_ALLOWED_DOMAINS = env.list("GOOGLE_OAUTH_ALLOWED_DOMAINS", default=[])

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "key": "",
        },
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
    }
}


# --------------------------------------------------------------------------- #
# Internacionalização
# --------------------------------------------------------------------------- #

LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Sao_Paulo"
USE_I18N = True
USE_TZ = True


# --------------------------------------------------------------------------- #
# Arquivos estáticos e mídia
# --------------------------------------------------------------------------- #

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# Arquivo enviado nasce legível só pelo processo da aplicação (e o grupo):
# o nginx NUNCA serve MEDIA_ROOT direto, então ele não precisa ler.
FILE_UPLOAD_PERMISSIONS = 0o640
FILE_UPLOAD_DIRECTORY_PERMISSIONS = 0o750

# D13: MEDIA_ROOT fora do webroot. Anexo NUNCA é servido por URL direta —
# o download passa por view autenticada que reavalia a permissão e grava TicketAccessLog.
MEDIA_ROOT = env("MEDIA_ROOT", default=str(BASE_DIR / "media"))
MEDIA_URL = None

# Estes três são o PISO DE FALLBACK: o valor efetivo vem de `core.SystemConfig`,
# editável no admin (o limite de anexo muda com o uso, não com a infraestrutura).
# Piso de fallback do `SystemConfig` (core): 10 MB por arquivo é regra de
# produto, e o painel do cliente anuncia o mesmo número.
ATTACHMENT_MAX_BYTES = env.int("ATTACHMENT_MAX_BYTES", 10 * 1024 * 1024)
ATTACHMENT_MAX_BYTES_PER_MESSAGE = env.int(
    "ATTACHMENT_MAX_BYTES_PER_MESSAGE", 100 * 1024 * 1024
)
ATTACHMENT_MAX_FILES_PER_MESSAGE = env.int("ATTACHMENT_MAX_FILES_PER_MESSAGE", 10)

# Folga acima do teto por mensagem (100 MB) para o corpo da requisição inteiro.
# Isso ultrapassa o default do Django e do nginx — ambos precisam acompanhar,
# senão o upload morre com 413 antes de chegar na validação (ver docs/04 D13).
# O número velho aqui ("20 MB × 10 arquivos") ficou para trás quando o piso caiu
# para 10 MB, e foi de um comentário desatualizado como este que a tela de
# abertura tirou o 20 MB que prometia errado.
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int("DATA_UPLOAD_MAX_MEMORY_SIZE", 210 * 1024 * 1024)
DATA_UPLOAD_MAX_NUMBER_FILES = env.int("DATA_UPLOAD_MAX_NUMBER_FILES", 20)
# nenhum formulário do sistema chega perto disso; o teto é contra payload
# forjado para estourar memória no parse
DATA_UPLOAD_MAX_NUMBER_FIELDS = 500
ATTACHMENT_ALLOWED_MIME = [
    "image/png", "image/jpeg", "image/gif", "image/webp",
    "application/pdf", "text/plain", "text/csv",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]

# --------------------------------------------------------------------------- #
# D19: antivírus (ClamAV)
# --------------------------------------------------------------------------- #
# Magic bytes provam que o arquivo é mesmo um PDF; não provam que é um PDF
# inofensivo. O anexo nasce em quarentena e só é servido quando a varredura
# libera. Ligado por padrão: desligar é uma escolha explícita e fica registrada
# no próprio anexo como `skipped` ("não verificado"), nunca como "limpo".
CLAMAV_ENABLED = env.bool("CLAMAV_ENABLED", default=True)
CLAMAV_HOST = env("CLAMAV_HOST", default="clamav")
CLAMAV_PORT = env.int("CLAMAV_PORT", default=3310)
CLAMAV_TIMEOUT = env.int("CLAMAV_TIMEOUT", default=60)

# Um antivírus que não respondeu não é um antivírus que aprovou: se a varredura
# falhou de forma definitiva, o download continua bloqueado (fail-closed).
ATTACHMENT_BLOCK_ON_SCAN_ERROR = env.bool("ATTACHMENT_BLOCK_ON_SCAN_ERROR", default=True)

# Arquivo infectado NÃO é apagado — fica como evidência, inacessível para
# download. O expurgo de retenção (D18) leva embora junto com o ticket.


# --------------------------------------------------------------------------- #
# GAPS.md item 5: Base de conhecimento (cache local da Central de Ajuda no
# WordPress). Desligada por padrão: exige alguém confirmar o `rest_base` do
# post type contra o site real antes de ligar (ver docstring de
# apps/knowledge/services/wordpress_sync.py) — auditoria não teve como
# confirmar isso a partir desta sessão (egress bloqueado para o domínio).
# --------------------------------------------------------------------------- #
WORDPRESS_KB_ENABLED = env.bool("WORDPRESS_KB_ENABLED", default=False)
WORDPRESS_KB_BASE_URL = env(
    "WORDPRESS_KB_BASE_URL", default="https://convertizecombr.wpcomstaging.com"
)
WORDPRESS_KB_POST_TYPE = env("WORDPRESS_KB_POST_TYPE", default="suporte")


# --------------------------------------------------------------------------- #
# DRF (D14: backend API-first, frontend SPA)
# --------------------------------------------------------------------------- #

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        # A de índice 0 é quem decide 401 vs 403 pro backend inteiro — ver o
        # docstring de `SessionAuthenticationComCabecalho`. Trocar a ordem
        # aqui muda esse comportamento global, não só para quem usa sessão.
        "apps.core.authentication.SessionAuthenticationComCabecalho",
        # Só entra em jogo quando a requisição NÃO trouxe cookie de sessão —
        # é o caso do mini chat embutido em outra plataforma (docs/14 §10).
        # Depois da de sessão de propósito: o app autenticado de sempre nem
        # chega a tentar esta.
        "apps.customers.embed_auth.EmbedTokenAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Com teto em `?limit=`: sem ele um inteiro maior que o bigint dá 500 em
    # todo endpoint paginado — ver apps/core/pagination.py.
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.LimitOffsetComTeto",
    "PAGE_SIZE": 25,
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # `Http404` do get_object_or_404 vaza uma frase em inglês; ver
    # apps/core/exceptions.py.
    "EXCEPTION_HANDLER": "apps.core.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "user": "1000/hour",
        "anon": "30/hour",
        "login": "20/hour",  # força bruta no login de sessão
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "Resolv API",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # Nomes ESTÁVEIS para os enums do schema.
    #
    # Sem isto o gerador batiza cada enum pelo nome do CAMPO, e campos com o
    # mesmo nome em models diferentes colidem: ele desempata com um hash do
    # conjunto de valores e produz `Source7c7Enum`, `Kind0d9Enum`,
    # `StatusBe3Enum` nos tipos que a SPA gera. Dois estragos: o nome não diz
    # nada a quem lê, e o hash MUDA quando alguém acrescenta um valor — um
    # status novo renomearia o tipo e mexeria em todas as referências dele
    # no código gerado do frontend — que costuma ser arquivo versionado.
    #
    # O mesmo conjunto também aparecia com nomes diferentes conforme o campo
    # (`TicketStatus` virava `CategoryEnum` em `TicketStage.category`,
    # `ToStatusEnum` em `TicketStatusEvent.to_status` e `StatusBe3Enum` na
    # listagem). Um conjunto, um nome.
    "ENUM_NAME_OVERRIDES": {
        "TicketStatusEnum": "apps.tickets.models.TicketStatus.choices",
        "TicketSourceEnum": "apps.tickets.models.TicketSource.choices",
        "UserKindEnum": "apps.accounts.models.UserKind.choices",
        "LimitPeriodEnum": "apps.customers.models.LimitPeriod.choices",
        # RBAC: o mesmo conjunto aparece em `User.internal_role` e em
        # `CustomRole.base_role` — um conjunto, um nome (ver acima).
        "InternalRoleEnum": "apps.accounts.models.InternalRole.choices",
        "TicketScopeEnum": "apps.accounts.rbac.TicketScope.choices",
        # `status` do chat aparece em ChatSerializer e no resumo de sessão da
        # linha do tempo. Sem este nome o gerador resolve a colisão sozinho e
        # batiza de "Status997Enum" — um número derivado do conjunto, que muda
        # quando alguém acrescenta um status e renomeia o tipo do front sem
        # ninguém pedir.
        "ChatStatusEnum": "apps.chat.models.ChatStatus.choices",
    },
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS", default=[])
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS", default=[])
# a sessão vai no cookie, então o CORS precisa de credenciais — e por isso
# mesmo `CORS_ALLOW_ALL_ORIGINS` nunca pode ser True aqui
CORS_ALLOW_CREDENTIALS = True

# --- Content-Security-Policy (django-csp) ----------------------------------
# Vale para o que ESTE processo serve em HTML: o admin do Django e o
# navegador da API. A SPA é servida pelo nginx e recebe a própria CSP lá
# (deploy/nginx/resolv.conf). `unsafe-inline` só em estilo: o admin ainda
# escreve `style=""` em alguns widgets; script inline ele não usa.
CONTENT_SECURITY_POLICY = {
    "DIRECTIVES": {
        "default-src": ("'self'",),
        "script-src": ("'self'",),
        "style-src": ("'self'", "'unsafe-inline'"),
        "img-src": ("'self'", "data:"),
        "font-src": ("'self'",),
        "connect-src": ("'self'",),
        "object-src": ("'none'",),
        "base-uri": ("'self'",),
        "form-action": ("'self'",),
        "frame-ancestors": ("'none'",),
    }
}


# --------------------------------------------------------------------------- #
# Redis, Channels e Celery
# --------------------------------------------------------------------------- #

# Base SEM índice de banco: cada uso abaixo escolhe o seu.
# 1=cache · 2=channels · 3=celery broker · 4=celery result
REDIS_URL = env("REDIS_URL", default="redis://redis:6379").rstrip("/")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": env("CACHE_URL", default=f"{REDIS_URL}/1"),
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [env("CHANNELS_REDIS_URL", default=f"{REDIS_URL}/2")]},
    }
}

CELERY_BROKER_URL = env("CELERY_BROKER_URL", default=f"{REDIS_URL}/3")
CELERY_RESULT_BACKEND = env("CELERY_RESULT_BACKEND", default=f"{REDIS_URL}/4")
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_TASK_TIME_LIMIT = 600
CELERY_TASK_SOFT_TIME_LIMIT = 540
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    "apps.reports.tasks.*": {"queue": "reports"},
}
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_BEAT_SCHEDULE = {
    "convert-unattended-chats": {
        # timeout de fila do chat: ninguém pegou → ticket "Chat não atendido"
        "task": "apps.chat.tasks.convert_unattended_chats",
        "schedule": 60.0,
    },
    # chat esquecido na fila (ninguém pegou ainda) → sino + e-mail pros
    # agentes com vaga, sempre ANTES do timeout acima converter em ticket —
    # frequente pelo mesmo motivo do timeout: janela curta de reação
    "chat-incoming-notify": {
        "task": "apps.chat.tasks.notify_queued_chats",
        "schedule": 30.0,
    },
    # inatividade DURANTE o atendimento (avisa e depois encerra) — desligada
    # por padrão no ChatConfig; a cada minuto porque os tempos são em minutos
    "chat-inactivity": {
        "task": "apps.chat.tasks.close_inactive_chats",
        "schedule": 60.0,
    },
    "sla-scan": {
        "task": "apps.notifications.tasks.sla_scan",
        "schedule": 300.0,  # docs/01 §5
    },
    # D5: fecha "aguardando o cliente" sem resposta além do prazo (SystemConfig).
    # o aviso roda um pouco ANTES do fechamento no mesmo ciclo horário —
    # senão os dois disparariam juntos e o aviso nunca chegaria antes do fim
    "warn-pending": {
        "task": "apps.tickets.tasks.warn_stale_pending",
        "schedule": crontab(minute=0),  # de hora em hora
    },
    "auto-close-pending": {
        "task": "apps.tickets.tasks.auto_close_stale_pending",
        "schedule": crontab(minute=5),  # de hora em hora, 5min depois do aviso
    },
    # prazo interno do quadro: digitável desde sempre, agora também AVISA
    "warn-overdue-cards": {
        "task": "apps.kanban.tasks.warn_overdue_cards",
        "schedule": crontab(minute=10),  # de hora em hora
    },
    # D18: ciclo diário de retenção, fora do horário de atendimento.
    # Em dry-run por padrão — grava um RetentionRun com o que *seria* apagado.
    "retention-policy": {
        "task": "apps.audit.tasks.apply_retention_policy",
        "schedule": crontab(hour=3, minute=30),
    },
    # Prazo legal de 15 dias (LGPD art. 19) dos pedidos de titular.
    "lgpd-deadline-scan": {
        "task": "apps.audit.tasks.scan_lgpd_deadlines",
        "schedule": crontab(hour=8, minute=0),
    },
    # GAPS.md item 5: cache local dos artigos da Central de Ajuda (WordPress).
    # De hora em hora — conteúdo editorial não muda a ponto de precisar de
    # tempo real; minute=15 só espalha a carga em relação aos outros jobs
    # horários (warn-pending em :00, auto-close em :05).
    "sync-knowledge-base": {
        "task": "apps.knowledge.tasks.sync_knowledge_base",
        "schedule": crontab(minute=15),
    },
    # aviso do mural (docs/02 §announcements) → sino + e-mail pra audiência
    # que ainda não sabe. Não precisa da cadência do chat: mural muda pouco.
    "announcement-notify": {
        "task": "apps.announcements.tasks.notify_announcements",
        "schedule": 300.0,
    },
}


# --------------------------------------------------------------------------- #
# E-mail
# --------------------------------------------------------------------------- #

DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="Resolv <no-reply@example.com>")

# Endereço PÚBLICO da aplicação — base de todo link que sai por e-mail
# (pesquisa de satisfação, convite de senha). Link relativo em e-mail não é
# clicável; sem esta base, a pesquisa "enviada" nunca chegava de verdade.
SITE_URL = env("SITE_URL", default="http://localhost:5174").rstrip("/")
# Aviso de novo ticket. Não existe ingestão por e-mail — o Reply-To é no-reply de propósito.
SUPPORT_NOTIFICATION_EMAIL = env("SUPPORT_NOTIFICATION_EMAIL", default="")
EMAIL_REPLY_TO = env("EMAIL_REPLY_TO", default="no-reply@example.com")


# --------------------------------------------------------------------------- #
# Regras de negócio (defaults — ver docs/04-decisoes-tomadas.md)
# --------------------------------------------------------------------------- #

# D18: a task de expurgo nasce em dry-run. Um default de retenção errado destrói dado;
# em dry-run ele apenas registra o que apagaria.
# D18/D20. `RETENTION_DRY_RUN=0` habilita o expurgo real — mas só depois que
# alguém tiver revisado um relatório de simulação (ver `services.retention`).
# A trava existe porque a alternativa é uma linha de env apagando anos de
# histórico na madrugada seguinte, sem ninguém por perto.
RETENTION_DRY_RUN = env.bool("RETENTION_DRY_RUN", default=True)
RETENTION_REQUIRE_REVIEWED_DRY_RUN = env.bool(
    "RETENTION_REQUIRE_REVIEWED_DRY_RUN", default=True
)

# Janela de rotação dos backups. Apagar do banco não apaga das cópias de
# segurança: a exclusão só se completa quando o último backup que continha o
# dado sai da rotação. É o prazo que informamos ao titular — e é o prazo dentro
# do qual um restore pode ressuscitar dado já anonimizado (ver
# `manage.py reapply_lgpd`).
BACKUP_ROTATION_DAYS = env.int("BACKUP_ROTATION_DAYS", default=30)
RETENTION_DAYS = {
    "ticket_after_close": 365 * 5,
    # Mesmo prazo do ticket: a conversa de chat é o mesmo tipo de registro de
    # atendimento, e dois prazos diferentes para a mesma coisa seriam uma
    # pergunta a mais para quem audita ("por que aquela sumiu e esta não?").
    "chat_after_close": 365 * 5,
    "audit_log": 365 * 2,
    "ticket_access_log": 365,
    "notification_read": 90,
    "report_export_file": 7,
    "lgpd_export_file": 7,
    "outbound_email": 180,
}

# D12: prefixo da numeração interna (`TD-00001`). Configurável porque é rótulo
# de negócio, não regra de código; a sequência atrás dele é a mesma.
TICKET_REFERENCE_PREFIX = env("TICKET_REFERENCE_PREFIX", default="TD")

# Máximo de sessões (navegadores/dispositivos) vivas por usuário. Ao logar a
# N+1, a mais antiga cai. Zero desliga o limite.
SESSION_MAX_PER_USER = env.int("SESSION_MAX_PER_USER", 3)

# janela de antecedência do aviso de SLA (notificação in-app ao responsável)
SLA_WARNING_MINUTES = env.int("SLA_WARNING_MINUTES", 30)


# --------------------------------------------------------------------------- #
# Logging
# --------------------------------------------------------------------------- #

# Tudo para o stdout, uma linha por evento, com o `request_id` que o
# middleware devolve no header X-Request-ID — é o que liga o relato de um
# usuário à linha certa. Quem coleta (journald, Docker, um agregador) faz o
# resto. Sem arquivo de log gravado pelo Django: arquivo em disco é mais um
# lugar com dado pessoal para proteger e expurgar (D18).
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {
        "request_id": {"()": "apps.core.middleware.RequestIdFilter"},
        "require_debug_false": {"()": "django.utils.log.RequireDebugFalse"},
    },
    "formatters": {
        "verbose": {
            "format": "%(levelname)s %(asctime)s %(name)s rid=%(request_id)s %(message)s"
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
            "filters": ["request_id"],
        },
        # erro 500 por e-mail aos ADMINS (só fora do DEBUG)
        "mail_admins": {
            "class": "django.utils.log.AdminEmailHandler",
            "level": "ERROR",
            "filters": ["require_debug_false"],
            "include_html": False,
        },
    },
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL", default="INFO")},
    "loggers": {
        "django.db.backends": {"level": "WARNING", "handlers": ["console"], "propagate": False},
        "django.request": {"handlers": ["console", "mail_admins"], "level": "WARNING",
                           "propagate": False},
        # host inválido, CSRF recusado, IP suspeito: são sinal, não ruído
        "django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False},
        "axes": {"handlers": ["console"], "level": "WARNING", "propagate": False},
    },
}


# --------------------------------------------------------------------------- #
# Sentry (observabilidade de erro, opcional)
# --------------------------------------------------------------------------- #
# Hoje o único destino de um 500 é o `mail_admins` acima (ou quem estiver
# olhando o stdout) — sem captura estruturada, sem stack trace agregado,
# sem alerta fora do e-mail. Igual a CLAMAV_ENABLED/WORDPRESS_KB_ENABLED
# acima: uma env var liga a integração, o código nunca assume que ela existe.
# Sem SENTRY_DSN (o padrão), é no-op completo — nem o pacote precisa estar
# instalado (extra `.[monitoring]`); com o pacote ausente e a env var vazia
# também não faz nada, então o boot não quebra num ambiente que não o tem.
# FALTA: setar SENTRY_DSN no ambiente real (produção/homologação) para ativar.
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    try:
        import sentry_sdk
    except ImportError:
        pass
    else:
        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=env("SENTRY_ENVIRONMENT", default="production"),
            # dado de cliente sob LGPD (ver docstring de prod.py): nada de PII
            # nos eventos de erro — cookies e usuário autenticado ficam de fora.
            send_default_pii=False,
            # `send_default_pii` NÃO cobre o corpo da requisição: quem manda
            # nele é este parâmetro, e o padrão do SDK ("medium") anexa até
            # 10 KB do payload a cada evento de erro. Um 500 num PATCH de nota
            # pessoal ou numa mensagem de chat mandaria o texto inteiro para o
            # Sentry. "never" é o que o comentário acima sempre prometeu.
            max_request_body_size="never",
            traces_sample_rate=env.float("SENTRY_TRACES_SAMPLE_RATE", default=0.0),
        )
