"""Teste estrutural (docs/04): o caminho único de leitura é vigiado no CI.

O isolamento multi-tenant não é imposto por um manager auto-filtrado (isso
exigiria propagar o usuário via estado global — um anti-padrão). Ele é imposto
pela convenção "toda leitura de ticket/chat que volta para um usuário passa por
`selectors.visible_tickets` / `chat_service.visible_sessions`". Este teste
transforma essa convenção numa trava: se uma view/serializer tocar o manager cru
`Ticket.objects` / `ChatSession.objects`, o CI falha antes de o vazamento existir.

A análise é por AST (não substring): não pega o nome dentro de comentário/string,
e enxerga o método real chamado logo depois de `.objects`.
"""

import ast
from pathlib import Path

APPS_DIR = Path(__file__).resolve().parents[3] / "apps"

# modelos com fronteira de tenant (empresa/equipe) que nunca podem ser
# lidos crus na camada de request
TENANT_MODELS = {"Ticket", "Chat"}

# camadas de leitura sancionadas: aqui o manager cru é o ponto de entrada legítimo
ALLOWED = {
    APPS_DIR / "tickets" / "selectors.py",
    APPS_DIR / "chat" / "services" / "chat_service.py",
    # comando de management: `./manage.py configurar_equipe_convertize` apaga
    # TUDO de propósito (ambiente de demo virando equipe real) — não é uma
    # leitura que devolve dado a cliente algum, é um `.all().delete()`
    # explícito rodado manualmente por quem administra o servidor. A trava
    # deste teste é contra vazamento entre empresas numa resposta de API; um
    # apagamento total, de linha de comando, é outra categoria de risco.
    APPS_DIR / "core" / "management" / "commands" / "configurar_equipe_convertize.py",
}

# repo inteiro: `.all()` é o "me dá tudo", o cheiro mais claro de leitura sem escopo
GLOBAL_BANNED = {"all"}
# camada de request (view/serializer): tem de vir dos selectors, então nenhum
# ponto de entrada de leitura do manager é aceito
REQUEST_BANNED = {"all", "filter", "exclude", "get", "none"}
REQUEST_FILES = {"views.py", "serializers.py"}


def _manager_reads(source):
    """(modelo, método, linha) para cada `Model.objects.<método>(...)` no arquivo."""
    tree = ast.parse(source)
    hits = []
    for node in ast.walk(tree):
        # queremos o Attribute do método logo após `.objects`:
        # Attribute(attr=<método>, value=Attribute(attr='objects', value=Name(Model)))
        if not isinstance(node, ast.Attribute):
            continue
        base = node.value
        if (
            isinstance(base, ast.Attribute)
            and base.attr == "objects"
            and isinstance(base.value, ast.Name)
            and base.value.id in TENANT_MODELS
        ):
            hits.append((base.value.id, node.attr, node.lineno))
    return hits


def _scan(banned_for):
    offenders = []
    for path in APPS_DIR.rglob("*.py"):
        if path in ALLOWED or "tests" in path.parts or "migrations" in path.parts:
            continue
        banned = banned_for(path)
        if not banned:
            continue
        for model, method, line in _manager_reads(path.read_text(encoding="utf-8")):
            if method in banned:
                offenders.append(f"{path.relative_to(APPS_DIR)}:{line} {model}.objects.{method}(")
    return offenders


def test_no_unscoped_all_reads_anywhere():
    """`Ticket.objects.all()` / `Chat.objects.all()` fora dos selectors."""
    offenders = _scan(lambda path: GLOBAL_BANNED)
    assert not offenders, (
        "Leitura sem escopo (.all) fora da camada de selectors: "
        f"{offenders} — use selectors.visible_tickets(user) / visible_sessions(user)."
    )


def test_request_layer_never_touches_raw_manager():
    """Nenhuma view/serializer pode ler o manager cru de Ticket/ChatSession.

    O request é onde o BOLA acontece: se a view não parte de `visible_tickets`,
    um id de outra empresa vaza. A camada de request só fala com os selectors.
    """
    offenders = _scan(lambda path: REQUEST_BANNED if path.name in REQUEST_FILES else set())
    assert not offenders, (
        "View/serializer lendo o manager cru (burla o isolamento multi-tenant): "
        f"{offenders} — parta de selectors.visible_tickets / chat_service.visible_chats."
    )
