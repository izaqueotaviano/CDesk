"""Chats atendidos por agente, ao longo do tempo — leitura gerencial do chat.

Companheiro de `indicators.py` (aquele é de ticket): aqui a unidade também é
o período, mas a fonte é `Chat`. Reaproveita de lá o vocabulário de janela e
variação (`PERIODS`, `build_windows`, `variation`) — o dilema de "3 dias
deste mês contra os 3 primeiros do anterior" é o mesmo, então cabe reusar em
vez de duplicar o dataclass e a fórmula. O que este módulo NÃO reaproveita é
a leitura em memória: as duas tabelas daqui (por agente e série temporal)
cabem inteiras em consultas agregadas no banco (`annotate` + `Count`) — o
volume de `Chat` não pede a mesma cautela que levou `indicators` a puxar
tudo pra memória numa consulta só.

Duas notas de honestidade sustentam a leitura:

1. **"Atendido" é medido por `accepted_at`, não por quando o chat nasceu ou
   fechou.** Um chat ainda na fila (`agent` nulo) nunca conta — ninguém
   pegou. ACTIVE e CLOSED contam os dois: o que importa é "o agente já
   pegou", não se a conversa já terminou.

2. **Reabrir apaga o rastro da aceitação anterior.** `chat_service.reopen()`
   zera `agent` e `accepted_at` do chat encerrado — ele volta pra fila
   geral, não necessariamente pro mesmo agente. Não existe hoje, para o
   chat, um evento histórico de "quem atendeu quando" (ao contrário do
   ticket, que tem `TicketStatusEvent` — ver o comentário sobre
   `last_reopened_at` em `indicators.build_indicators`). Então um chat
   reaberto e pego de novo entra no relatório só pela ÚLTIMA aceitação: a
   primeira desaparece sem deixar sinal nenhum. Isso é limitação conhecida,
   não bug — resolver exigiria um log de eventos novo, fora do escopo
   daqui.

Proteção da série temporal: sem `?from=`/`?to=`, cada granularidade tem uma
janela padrão (48h, 30 dias, 12 meses, 5 anos). Com `?from=`/`?to=`
informados, a janela pode crescer à vontade — e por isso existe um teto
absoluto de `MAX_BUCKETS` baldes: um pedido que o estoure não vira erro, é
cortado silenciosamente para os `MAX_BUCKETS` baldes mais recentes (o
comportamento existe para blindar contra algo como
"?from=2000-01-01&granularity=hour", não para o uso normal da tela).
"""

from __future__ import annotations

import datetime as dt

from django.db.models import Count, QuerySet
from django.db.models.functions import TruncDay, TruncHour, TruncMonth, TruncYear
from django.utils import timezone

from apps.chat.models import Chat
from apps.reports.services.indicators import PERIODS, Window, build_windows, variation

SEM_RESPONSAVEL = "Sem responsável"

MAX_BUCKETS = 400

_TRUNC = {"hour": TruncHour, "day": TruncDay, "month": TruncMonth, "year": TruncYear}

# tamanho da janela padrão quando não vem `?from=`/`?to=`, em número de baldes
_DEFAULT_BUCKETS = {"hour": 48, "day": 30, "month": 12, "year": 5}


# --------------------------------------------------------------------------- #
# aritmética de balde
# --------------------------------------------------------------------------- #

def _bucket_start(moment: dt.datetime, granularity: str) -> dt.datetime:
    """Início do balde que contém `moment`, no fuso corrente — mesmo fuso que
    o `TruncHour`/`TruncDay`/... do banco usa para agrupar (América/São Paulo,
    sem horário de verão desde 2019: somar/subtrair balde não atravessa
    salto de relógio)."""
    local = timezone.localtime(moment)
    if granularity == "hour":
        return local.replace(minute=0, second=0, microsecond=0)
    if granularity == "day":
        return local.replace(hour=0, minute=0, second=0, microsecond=0)
    if granularity == "month":
        return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return local.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)  # year


def _shift(moment: dt.datetime, granularity: str, n: int) -> dt.datetime:
    """`moment` deslocado `n` baldes (pode ser negativo). Espera `moment` já
    alinhado a um início de balde — é sempre assim que é chamado aqui."""
    if granularity == "hour":
        return moment + dt.timedelta(hours=n)
    if granularity == "day":
        return moment + dt.timedelta(days=n)
    if granularity == "month":
        total = moment.year * 12 + (moment.month - 1) + n
        year, month = divmod(total, 12)
        return moment.replace(year=year, month=month + 1)
    return moment.replace(year=moment.year + n)  # year


def _bucket_count(start: dt.datetime, end: dt.datetime, granularity: str) -> int:
    """Quantos baldes cabem entre dois inícios de balde já alinhados."""
    if granularity == "hour":
        return int((end - start).total_seconds() // 3600)
    if granularity == "day":
        return (end.date() - start.date()).days
    if granularity == "month":
        return (end.year - start.year) * 12 + (end.month - start.month)
    return end.year - start.year  # year


def _bucket_label(granularity: str, moment: dt.datetime) -> str:
    """Rótulo ISO do balde — a resolução do texto acompanha a granularidade,
    não só o valor: "2026-09" não vira "2026-09-01" para não sugerir um dia
    que a consulta não distinguiu."""
    local = timezone.localtime(moment)
    if granularity == "hour":
        return local.strftime("%Y-%m-%dT%H:00:00")
    if granularity == "month":
        return local.strftime("%Y-%m")
    if granularity == "year":
        return local.strftime("%Y")
    return local.date().isoformat()


def _bucket_starts(start: dt.datetime, end: dt.datetime, granularity: str):
    cur = start
    while cur < end:
        yield cur
        cur = _shift(cur, granularity, 1)


def _bucket_ceil(moment: dt.datetime, granularity: str) -> dt.datetime:
    """Início do balde >= `moment`. Usado para fechar a janela em `to` sem
    cortar o balde (mês, ano...) em que aquele instante cai no meio."""
    floor = _bucket_start(moment, granularity)
    return floor if floor == moment else _shift(floor, granularity, 1)


def _as_datetime(date_value: dt.date | None) -> dt.datetime | None:
    """Meia-noite local do dia informado — `from`/`to` chegam como data."""
    if date_value is None:
        return None
    return timezone.make_aware(dt.datetime.combine(date_value, dt.time.min))


def _resolve_window(granularity: str, *, date_from: dt.date | None,
                     date_to: dt.date | None, now: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    """Início/fim (fim exclusivo) da série, já cortados pelo teto de baldes."""
    if date_to is not None:
        # "to" é o dia INTEIRO informado: a meia-noite do dia seguinte fecha
        # a janela — `_bucket_ceil` evita que ela caia no meio do balde
        # (mês/ano) em que esse instante está, cortando o resto fora
        fim_do_dia = _shift(_bucket_start(_as_datetime(date_to), "day"), "day", 1)
        end = _bucket_ceil(fim_do_dia, granularity)
    else:
        # o balde corrente entra inteiro mesmo sem ter fechado — mesmo
        # espírito de "hoje" no painel de indicadores (Window.end = agora)
        end = _shift(_bucket_start(now, granularity), granularity, 1)

    if date_from is not None:
        start = _bucket_start(_as_datetime(date_from), granularity)
    else:
        start = _shift(end, granularity, -_DEFAULT_BUCKETS[granularity])

    if _bucket_count(start, end, granularity) > MAX_BUCKETS:
        # protege contra algo como "?from=2000-01-01&granularity=hour": corta
        # para os baldes mais recentes em vez de devolver erro
        start = _shift(end, granularity, -MAX_BUCKETS)

    return start, end


# --------------------------------------------------------------------------- #
# widgets
# --------------------------------------------------------------------------- #

def _by_agent(base: QuerySet[Chat], window: Window) -> list[dict]:
    """Quantos chats cada agente atendeu no período, com variação contra a
    mesma fatia do anterior (ver `indicators.variation`). Sempre TODOS os
    agentes — o recorte por `?agent=` é só da série temporal."""
    def tally(qs):
        linhas = qs.values("agent_id", "agent__full_name").annotate(total=Count("id"))
        return {(r["agent_id"], r["agent__full_name"]): r["total"] for r in linhas}

    atual = tally(base.filter(accepted_at__gte=window.start, accepted_at__lt=window.end))
    anterior = tally(
        base.filter(accepted_at__gte=window.prev_start, accepted_at__lt=window.prev_end)
    )

    linhas = []
    for chave in set(atual) | set(anterior):
        agent_id, agent_name = chave
        current, previous = atual.get(chave, 0), anterior.get(chave, 0)
        linhas.append({
            "agent_id": agent_id,
            "agent_name": agent_name or SEM_RESPONSAVEL,
            "value": current,
            "variation": variation(current, previous),
        })
    linhas.sort(key=lambda linha: (-linha["value"], linha["agent_name"]))

    total_atual, total_anterior = sum(atual.values()), sum(anterior.values())
    linhas.append({
        "agent_id": None,
        "label": "Total",
        "value": total_atual,
        "variation": variation(total_atual, total_anterior),
        "is_total": True,
    })
    return linhas


def _timeline(qs: QuerySet[Chat], granularity: str,
              start: dt.datetime, end: dt.datetime) -> list[dict]:
    """Série por `accepted_at`. Balde sem chat entra com `count=0` — mesma
    razão do `_by_choice` de indicators.py: um buraco no gráfico não pode
    significar "sem dado" e "zero" ao mesmo tempo."""
    baldes = {_bucket_label(granularity, cur): 0 for cur in _bucket_starts(start, end, granularity)}

    linhas = (
        qs.filter(accepted_at__gte=start, accepted_at__lt=end)
        .annotate(bucket=_TRUNC[granularity]("accepted_at"))
        .values("bucket")
        .annotate(count=Count("id"))
        .order_by("bucket")
    )
    for linha in linhas:
        rotulo = _bucket_label(granularity, linha["bucket"])
        if rotulo in baldes:  # sempre deveria estar; defesa contra borda de fuso
            baldes[rotulo] = linha["count"]

    return [{"bucket": rotulo, "count": total} for rotulo, total in baldes.items()]


# --------------------------------------------------------------------------- #
# entrada
# --------------------------------------------------------------------------- #

def build_chat_stats(*, period: str = "month", granularity: str = "day",
                      agent_id: int | None = None,
                      date_from: dt.date | None = None, date_to: dt.date | None = None,
                      now=None) -> dict:
    """Monta o relatório inteiro: tabela por agente + série temporal.

    Escopo gerencial — TODOS os chats do sistema, sem recorte por empresa
    (mesmo espírito de `IndicatorsView`: quem chega até aqui já passou pelo
    `IsInternal` da view).
    """
    if period not in PERIODS:
        period = "month"
    if granularity not in _TRUNC:
        granularity = "day"

    now = now or timezone.now()
    window = build_windows(now)[period]

    atendidos = Chat.objects.filter(agent__isnull=False)

    start, end = _resolve_window(granularity, date_from=date_from, date_to=date_to, now=now)
    serie = atendidos.filter(agent_id=agent_id) if agent_id is not None else atendidos

    return {
        "period": {"key": period, "label": PERIODS[period]},
        "by_agent": _by_agent(atendidos, window),
        "granularity": granularity,
        "timeline": _timeline(serie, granularity, start, end),
    }
