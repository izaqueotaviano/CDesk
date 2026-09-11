"""Cliente da API pública do Movidesk — só o que a exportação completa precisa.

Regras da API que este módulo encarna (docs: atendimento.movidesk.com/kb,
artigo 256 "Movidesk Ticket API"):

- `GET /tickets` só devolve o que teve `lastUpdate` nos últimos 90 dias;
  `GET /tickets/past` é o mesmo layout para o resto. A base inteira exige
  varrer os DOIS e deduplicar por `id` — um ticket antigo que recebeu uma
  ação recente aparece nos dois.
- 10 requisições por minuto. Três erros seguidos bloqueiam por 60s, mais três
  por 120s, mais três por 300s — e a resposta traz `retry-after` com o tempo
  restante. Este módulo espera EXATAMENTE o que o header manda, nunca um
  chute fixo, e mantém 6s entre chamadas bem-sucedidas pra nem chegar perto
  do teto.
- Paginação por `$top`/`$skip` com `$orderby` fixo, senão a página 3 pode
  repetir ou pular registros que mudaram durante a varredura.

O token vai como query param `token` em toda chamada — por isso NENHUMA
mensagem de erro ou linha de log deste módulo repete a URL crua: `_sem_token`
limpa antes.

`http` e `sleep` são injetáveis pra teste; o padrão é urllib e time.sleep.
Sem dependência do Django: o mesmo módulo serve a task e um script de linha
de comando.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

BASE = "https://api.movidesk.com/public/v1"
TOP = 200
INTERVALO_ENTRE_CHAMADAS = 6.0  # 10 req/min com folga
TENTATIVAS_POR_PAGINA = 6
TIMEOUT = 120

# Export completo — o que o spec da migração pede. `$expand` traz as coleções
# aninhadas dentro de cada ticket (ações com apontamentos/despesas/anexos,
# clientes, históricos, campos customizados).
SELECT = ",".join(
    [
        "id",
        "protocol",
        "type",
        "subject",
        "category",
        "urgency",
        "status",
        "baseStatus",
        "justification",
        "origin",
        "createdDate",
        "originEmailAccount",
        "owner",
        "ownerTeam",
        "createdBy",
        "serviceFull",
        "serviceFirstLevelId",
        "serviceFirstLevel",
        "serviceSecondLevel",
        "serviceThirdLevel",
        "contactForm",
        "tags",
        "cc",
        "resolvedIn",
        "reopenedIn",
        "closedIn",
        "lastActionDate",
        "actionCount",
        "lastUpdate",
        "lifetimeWorkingTime",
        "stoppedTime",
        "stoppedTimeWorkingTime",
        "resolvedInFirstCall",
        "sequence",
        "slaAgreement",
        "slaAgreementRule",
        "slaSolutionTime",
        "slaResponseTime",
        "jiraIssueKey",
        "redmineIssueId",
        "clients",
        "actions",
        "parentTickets",
        "childrenTickets",
        "ownerHistories",
        "statusHistories",
        "customFieldValues",
        "assets",
    ]
)
EXPAND = (
    "clients,actions($expand=timeAppointments,expenses,attachments),parentTickets,"
    "childrenTickets,ownerHistories,statusHistories,customFieldValues,assets"
)

# Pessoas (artigo "Movidesk Person API"): empresas, contatos e agentes vêm
# da mesma rota `/persons` — `personType` separa (1 pessoa, 2 empresa,
# 3 departamento) e `profileType` diz o papel (1 agente, 2 cliente, 3 os dois).
SELECT_PESSOAS = ",".join(
    [
        "id",
        "codeReferenceAdditional",
        "isActive",
        "personType",
        "profileType",
        "accessProfile",
        "businessName",
        "corporateName",
        "cpfCnpj",
        "userName",
        "role",
        "bossId",
        "bossName",
        "classification",
        "cultureId",
        "timeZoneId",
        "createdDate",
        "changedDate",
        "observations",
        "addresses",
        "contacts",
        "emails",
        "teams",
        "relationships",
        "customFieldValues",
    ]
)
EXPAND_PESSOAS = "addresses,contacts,emails,relationships,customFieldValues"

# Se a rota de pessoas recusar um parâmetro OData (HTTP 400 logo na primeira
# página), tenta de novo mais simples — sem ordenação, depois sem projeção —
# e o log diz qual forma funcionou. É o que dá pra fazer sem a documentação
# ao alcance: "só baixar" na tela mostra o que veio antes de gravar.
VARIANTES_PESSOAS = (
    {"ordem": "id asc", "select": SELECT_PESSOAS, "expand": EXPAND_PESSOAS},
    {"ordem": "", "select": SELECT_PESSOAS, "expand": EXPAND_PESSOAS},
    {"ordem": "", "select": "", "expand": ""},
)

Http = Callable[[str], tuple[int, dict, bytes]]
Progresso = Callable[[dict], None]


class ErroMovidesk(Exception):
    """Falha ao falar com a API — a mensagem já vem sem o token."""


class TokenInvalido(ErroMovidesk):
    pass


class RequisicaoRecusada(ErroMovidesk):
    """HTTP 4xx que não adianta repetir (400, 404…) — leva o status junto."""

    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status


_TOKEN_RE = re.compile(r"token=[^&\s]+")


def _sem_token(texto: str) -> str:
    return _TOKEN_RE.sub("token=***", texto)


def _http_urllib(url: str) -> tuple[int, dict, bytes]:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310 — https fixo em BASE
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:  # noqa: S310 — https fixo em BASE
            return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
    except urllib.error.HTTPError as exc:
        # erro HTTP também é resposta: é nela que vem o retry-after
        return exc.code, {k.lower(): v for k, v in exc.headers.items()}, exc.read()


def montar_url(
    token: str,
    rota: str,
    *,
    top: int,
    skip: int,
    ordem: str,
    select: str = SELECT,
    expand: str = EXPAND,
) -> str:
    params: dict[str, object] = {"token": token}
    if select:
        params["$select"] = select
    if expand:
        params["$expand"] = expand
    params["$top"] = top
    params["$skip"] = skip
    if ordem:
        params["$orderby"] = ordem
    return f"{BASE}/{rota}?{urllib.parse.urlencode(params)}"


def _segundos_de_retry_after(cabecalhos: dict) -> float | None:
    valor = cabecalhos.get("retry-after")
    if valor is None:
        return None
    try:
        return max(1.0, float(valor))
    except ValueError:
        return None


def _pagina(
    url: str,
    *,
    http: Http,
    sleep: Callable[[float], None],
    log: Callable[[str], None],
) -> list[dict]:
    """Uma página, com as tentativas e as esperas que a API pede."""
    for tentativa in range(1, TENTATIVAS_POR_PAGINA + 1):
        status, cabecalhos, corpo = http(url)
        if status == 200:
            try:
                dados = json.loads(corpo or b"[]")
            except json.JSONDecodeError as exc:
                raise ErroMovidesk("A API respondeu algo que não é JSON.") from exc
            if not isinstance(dados, list):
                raise ErroMovidesk("A API respondeu um objeto onde se esperava uma lista.")
            return dados
        if status in (401, 403):
            raise TokenInvalido("Token recusado pelo Movidesk (401/403) — confira a chave.")

        espera = _segundos_de_retry_after(cabecalhos)
        trecho = _sem_token(corpo[:200].decode("utf-8", "replace")) if corpo else ""
        if espera is not None:
            log(f"API pediu pausa (HTTP {status}, retry-after={espera:.0f}s) — aguardando.")
        elif status == 429 or status >= 500:
            espera = 15.0 * tentativa
            log(
                f"HTTP {status} sem retry-after — tentativa {tentativa}/{TENTATIVAS_POR_PAGINA}, "
                f"aguardando {espera:.0f}s. {trecho}".rstrip()
            )
        else:
            raise RequisicaoRecusada(status, f"HTTP {status} do Movidesk: {trecho or 'sem corpo'}")
        if tentativa == TENTATIVAS_POR_PAGINA:
            break
        sleep(espera)
    raise ErroMovidesk(f"Desisti depois de {TENTATIVAS_POR_PAGINA} tentativas na mesma página.")


def baixar_tudo(
    token: str,
    *,
    limite: int | None = None,
    http: Http | None = None,
    sleep: Callable[[float], None] = time.sleep,
    on_progresso: Progresso | None = None,
    cancelado: Callable[[], bool] = lambda: False,
) -> list[dict]:
    """Varre `/tickets` e `/tickets/past`, dedupe por `id`, devolve a lista.

    Sem `limite`: ordem `id asc` (estável entre páginas, como o spec pede) e
    vai até a última página das duas rotas. Com `limite`: ordem `id desc`
    (os mais recentes primeiro — é o que se quer numa amostra) e para assim
    que juntar o suficiente. Devolve sempre ordenado por id.
    """
    if not token:
        raise TokenInvalido("Sem token da API do Movidesk.")
    http = http or _http_urllib
    avisar = on_progresso or (lambda evento: None)

    def log(msg: str) -> None:
        avisar({"tipo": "log", "msg": msg})

    por_id: dict[int, dict] = {}
    ordem = "id desc" if limite else "id asc"
    primeira_chamada = True

    for rota in ("tickets", "tickets/past"):
        skip = 0
        pagina = 1
        while True:
            if cancelado():
                raise ErroMovidesk("Cancelado.")
            if limite and len(por_id) >= limite:
                break
            if not primeira_chamada:
                sleep(INTERVALO_ENTRE_CHAMADAS)
            primeira_chamada = False

            url = montar_url(token, rota, top=TOP, skip=skip, ordem=ordem)
            dados = _pagina(url, http=http, sleep=sleep, log=log)

            novos = 0
            for t in dados:
                tid = t.get("id")
                if tid in (None, ""):
                    continue
                if int(tid) not in por_id:
                    novos += 1
                por_id[int(tid)] = t
            avisar(
                {
                    "tipo": "pagina",
                    "rota": rota,
                    "pagina": pagina,
                    "recebidos": len(dados),
                    "novos": novos,
                    "total": len(por_id),
                    "msg": f"/{rota}: página {pagina} — {len(dados)} recebidos, "
                    f"{novos} novos ({len(por_id)} no total)",
                }
            )
            if len(dados) < TOP:
                break
            skip += TOP
            pagina += 1

    tickets = sorted(por_id.values(), key=lambda t: int(t["id"]))
    if limite:
        tickets = tickets[-limite:]
    return tickets


def baixar_pessoas(
    token: str,
    *,
    limite: int | None = None,
    http: Http | None = None,
    sleep: Callable[[float], None] = time.sleep,
    on_progresso: Progresso | None = None,
    cancelado: Callable[[], bool] = lambda: False,
) -> list[dict]:
    """Varre `/persons` inteira (ou até `limite`), dedupe por `id`.

    Mesmo ritmo e mesmas esperas de `baixar_tudo` — é o mesmo limite de
    10/min da conta, por isso a tela não deixa as duas rodarem juntas.
    """
    if not token:
        raise TokenInvalido("Sem token da API do Movidesk.")
    http = http or _http_urllib
    avisar = on_progresso or (lambda evento: None)

    def log(msg: str) -> None:
        avisar({"tipo": "log", "msg": msg})

    por_id: dict[str, dict] = {}
    variante = 0
    skip = 0
    pagina = 1
    primeira_chamada = True

    while True:
        if cancelado():
            raise ErroMovidesk("Cancelado.")
        if limite and len(por_id) >= limite:
            break
        if not primeira_chamada:
            sleep(INTERVALO_ENTRE_CHAMADAS)
        primeira_chamada = False

        url = montar_url(token, "persons", top=TOP, skip=skip, **VARIANTES_PESSOAS[variante])
        try:
            dados = _pagina(url, http=http, sleep=sleep, log=log)
        except RequisicaoRecusada as exc:
            if exc.status == 400 and skip == 0 and variante + 1 < len(VARIANTES_PESSOAS):
                variante += 1
                log(
                    f"{exc} — tentando a rota de pessoas "
                    + ("sem $orderby." if variante == 1 else "sem $select/$expand.")
                )
                continue
            raise

        novos = 0
        for p in dados:
            pid = str(p.get("id") or "").strip()
            if not pid:
                continue
            if pid not in por_id:
                novos += 1
            por_id[pid] = p
        avisar(
            {
                "tipo": "pagina",
                "rota": "persons",
                "pagina": pagina,
                "recebidos": len(dados),
                "novos": novos,
                "total": len(por_id),
                "msg": f"/persons: página {pagina} — {len(dados)} recebidos, "
                f"{novos} novos ({len(por_id)} no total)",
            }
        )
        if len(dados) < TOP:
            break
        skip += TOP
        pagina += 1

    pessoas = sorted(por_id.values(), key=lambda p: str(p.get("id")))
    return pessoas[:limite] if limite else pessoas
