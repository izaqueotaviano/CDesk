"""Sessões vivas e leitura de user-agent — compartilhado entre a tela
"Minha conta" (sessões do próprio usuário) e o histórico de acesso do admin.

As sessões vivem na tabela `django_session`: o dono fica DENTRO do blob
assinado, então listar é varrer as vivas e decodificar. O(n) nas ativas —
para a escala deste sistema (dezenas de usuários), barato.
"""

from django.contrib.sessions.models import Session
from django.utils import timezone

from apps.accounts.models import AccessEventKind

# eventos que a aba "Acessos" mostra — entrar (ou tentar) é o que responde
# "quem esteve nesta conta"; troca de senha e 2FA são a aba "Histórico"
LOGIN_EVENTS = (AccessEventKind.LOGIN, AccessEventKind.LOGIN_FAILED)
LOGIN_PAGE_SIZE = 20


def client_ip(request) -> str:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def live_sessions(user) -> list[dict]:
    """Sessões vivas do usuário, com o carimbo (UA/IP/início) que o receiver
    de `user_logged_in` anota no login — o Django não guarda isso sozinho."""
    now = timezone.now()
    rows = []
    for s in Session.objects.filter(expire_date__gte=now):
        data = s.get_decoded()
        if str(data.get("_auth_user_id")) != str(user.pk):
            continue
        rows.append({
            "key": s.session_key,
            "user_agent": data.get("ua", ""),
            "ip": data.get("ip", ""),
            "started_at": data.get("started"),
            "expires_at": s.expire_date.isoformat(),
        })
    return rows


def browser_of(user_agent: str) -> str:
    """"Chrome · Windows" em vez do user-agent cru — é o que uma pessoa
    reconhece ao investigar uma conta. Heurística curta de propósito: cobrir
    os navegadores reais do público; o resto cai no UA truncado."""
    if not user_agent:
        return "Desconhecido"
    ua = user_agent
    browser = (
        "Edge" if "Edg" in ua
        else "Chrome" if "Chrome" in ua
        else "Firefox" if "Firefox" in ua
        else "Safari" if "Safari" in ua
        else ""
    )
    os_name = (
        "iOS" if ("iPhone" in ua or "iPad" in ua)
        else "Android" if "Android" in ua
        else "macOS" if "Mac OS X" in ua
        else "Windows" if "Windows" in ua
        else "Linux" if "Linux" in ua
        else ""
    )
    if not browser and not os_name:
        return ua[:60]
    return " · ".join(part for part in (browser, os_name) if part)


def access_history_payload(user, *, current_session_key: str | None) -> dict:
    """Histórico de acesso de UM usuário: eventos, últimos logins, sessões vivas.

    Compartilhado entre dois donos de dado diferentes com a MESMA forma:
    `GET settings/users/<id>/access-history/` (admin, sobre outro usuário) e
    `GET me/access-history/` (self-service, sobre `request.user`). Extraído
    daqui em vez de duplicado — as duas telas fazem exatamente a mesma
    pergunta ("o que aconteceu nesta conta"), só mudando de quem é a conta.

    Três recortes da mesma consulta: `events` é a linha do tempo inteira
    (login, falha, troca de senha, 2FA), `logins` são só as entradas — as
    últimas 20, sucesso ou falha — e `sessions` é onde a pessoa está logada
    AGORA. Filtrar `events` no frontend daria menos de 20 logins sempre que
    houvesse troca de senha no meio.
    """
    from django.conf import settings

    def linha(event):
        return {
            "kind": event.kind,
            "kind_label": event.get_kind_display(),
            "ip": event.ip,
            "browser": browser_of(event.user_agent),
            "created_at": event.created_at.isoformat(),
            "success": event.kind != AccessEventKind.LOGIN_FAILED,
        }

    events = [linha(event) for event in user.access_events.all()[:50]]
    logins = [
        linha(event)
        for event in user.access_events.filter(kind__in=LOGIN_EVENTS)[:LOGIN_PAGE_SIZE]
    ]
    sessions = [
        {
            # a chave é o que o botão "desconectar" manda de volta
            "key": row["key"],
            "browser": browser_of(row["user_agent"]),
            "ip": row["ip"],
            "user_agent": row["user_agent"],
            "started_at": row["started_at"],
            "expires_at": row["expires_at"],
            "current": row["key"] == current_session_key,
        }
        for row in live_sessions(user)
    ]
    sessions.sort(key=lambda r: r["started_at"] or "", reverse=True)
    return {
        "events": events,
        "logins": logins,
        "sessions": sessions,
        # o teto de sessões simultâneas é regra do sistema (a mais antiga
        # cai no login N+1); a tela mostra "2 de 3" para o número na frente
        # de quem lê ser o mesmo que o login aplica
        "session_limit": getattr(settings, "SESSION_MAX_PER_USER", 3),
    }
