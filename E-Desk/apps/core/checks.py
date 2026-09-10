"""System checks de deploy.

Rodam com `manage.py check --deploy`. A intenção é que uma configuração que
enfraquece a segurança precise ser uma decisão *escrita*, não um esquecimento
que ninguém percebe até o incidente.
"""

from urllib.parse import urlparse

from django.conf import settings
from django.core.checks import Error, Tags, Warning, register


@register(Tags.security, deploy=True)
def antivirus_configured(app_configs, **kwargs):
    """D19: anexo sem varredura é um upload de arquivo arbitrário servido de
    volta para outros usuários. Em produção isso não é um default aceitável."""
    problems = []

    if not settings.CLAMAV_ENABLED:
        problems.append(
            Error(
                "CLAMAV_ENABLED=False em produção: anexos não passam por "
                "varredura antivírus e são gravados como 'não verificado'.",
                hint="Suba o serviço clamav e defina CLAMAV_ENABLED=True.",
                id="resolv.E001",
            )
        )
        return problems

    try:
        import clamd  # noqa: F401
    except ImportError:
        problems.append(
            Error(
                "CLAMAV_ENABLED=True mas o pacote 'clamd' não está instalado; "
                "toda varredura vai falhar e todo anexo ficará bloqueado.",
                hint="pip install '.[antivirus]'",
                id="resolv.E002",
            )
        )

    if not settings.ATTACHMENT_BLOCK_ON_SCAN_ERROR:
        problems.append(
            Warning(
                "ATTACHMENT_BLOCK_ON_SCAN_ERROR=False: anexos cuja varredura "
                "falhou são servidos mesmo assim (fail-open).",
                hint="Só mantenha assim enquanto durar uma janela de operação.",
                id="resolv.W001",
            )
        )

    return problems


@register(Tags.security, deploy=True)
def endurecimento_de_producao(app_configs, **kwargs):
    """O que `prod.py` promete e o `.env` pode desfazer.

    O `check --deploy` do Django cobre DEBUG, HSTS e cookies. Estes são os
    itens próprios deste sistema: papel de banco, TLS no Postgres, senha no
    Redis, força bruta ligada, docs da API desligadas, host sem curinga.
    Cada um vira Error porque cada um, sozinho, já é um incidente esperando.
    """
    problemas = []

    if "*" in settings.ALLOWED_HOSTS:
        problemas.append(Error(
            "ALLOWED_HOSTS aceita qualquer Host ('*').",
            hint="Liste só os domínios reais em DJANGO_ALLOWED_HOSTS.",
            id="resolv.E010",
        ))

    if len(settings.SECRET_KEY) < 50:
        problemas.append(Error(
            "SECRET_KEY curta demais (< 50 caracteres).",
            hint='python -c "import secrets; print(secrets.token_urlsafe(64))"',
            id="resolv.E011",
        ))

    db = settings.DATABASES["default"]
    sslmode = db.get("OPTIONS", {}).get("sslmode", "")
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        problemas.append(Error(
            f"Conexão com o PostgreSQL sem TLS (sslmode={sslmode or 'prefer'}).",
            hint="DB_SSLMODE=verify-full (e DB_SSLROOTCERT com a CA do servidor).",
            id="resolv.E012",
        ))
    elif sslmode == "require":
        problemas.append(Warning(
            "sslmode=require cifra a conexão mas não confere o certificado do servidor.",
            hint="Prefira verify-full; require só em rede privada sem CA.",
            id="resolv.W010",
        ))

    usuario_db = db.get("USER", "")
    if usuario_db in {"postgres", "resolv_owner"}:
        problemas.append(Error(
            f"A aplicação conecta ao banco como '{usuario_db}', que pode alterar o schema.",
            hint="Use o papel resolv_app (deploy/postgres/01_papeis.sql); "
                 "o owner é só do migrate.",
            id="resolv.E013",
        ))

    redis = urlparse(settings.REDIS_URL)
    if not redis.password:
        problemas.append(Error(
            "REDIS_URL sem senha: qualquer processo na rede lê sessões, cache e fila.",
            hint="requirepass no Redis e REDIS_URL=redis://:senha@host:6379 (ou rediss://).",
            id="resolv.E014",
        ))

    if not getattr(settings, "AXES_ENABLED", False):
        problemas.append(Error(
            "AXES_ENABLED=False: sem bloqueio de força bruta no login.",
            id="resolv.E015",
        ))

    if getattr(settings, "API_DOCS_ENABLED", False):
        problemas.append(Warning(
            "API_DOCS_ENABLED=True: o schema descreve todos os endpoints, "
            "inclusive os administrativos.",
            hint="Desligue em produção; ligue só em homologação.",
            id="resolv.W011",
        ))

    if getattr(settings, "ADMIN_URL", "admin/") == "admin/":
        problemas.append(Warning(
            "O admin está em /admin/, o caminho que toda varredura tenta primeiro.",
            hint="DJANGO_ADMIN_URL=um-caminho-que-nao-se-adivinha",
            id="resolv.W012",
        ))

    if str(settings.MEDIA_ROOT).startswith(str(settings.BASE_DIR)):
        problemas.append(Warning(
            "MEDIA_ROOT dentro do diretório do projeto.",
            hint="MEDIA_ROOT=/var/lib/resolv/media (fora do webroot, 0750).",
            id="resolv.W013",
        ))

    if "unsafe-inline" in " ".join(
        settings.CONTENT_SECURITY_POLICY["DIRECTIVES"].get("script-src", ())
    ):
        problemas.append(Error(
            "CSP permite script inline ('unsafe-inline' em script-src): XSS passa.",
            id="resolv.E016",
        ))

    return problemas
