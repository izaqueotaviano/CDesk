"""Painel de indicadores — a leitura gerencial do mesmo dado do relatório.

Diferença para `metrics.build_report`: lá a unidade é **o ticket** (uma linha
por chamado, para exportar); aqui a unidade é **o período** (contagens,
distribuições e séries, para olhar de longe). Por isso vivem em módulos
separados mesmo consultando a mesma tabela.

Três decisões que sustentam o resto do arquivo:

1. **Escopo.** Tudo parte de `selectors.visible_tickets(user)`. O painel não
   tem uma consulta própria: se o agente não enxerga o ticket na listagem, ele
   também não entra em nenhuma contagem — inclusive nas fatias "Total".

2. **Uma leitura, não cinquenta.** As três tabelas de resumo sozinhas seriam 54
   `COUNT(*)` (3 métricas × 3 escopos × 3 janelas × atual/anterior). Em vez
   disso o módulo faz UMA consulta `values()` cobrindo a janela mais antiga
   necessária e conta em memória. Em 50–500 tickets/mês (docs/02) isso é
   trivial; o ponto de virada para materializar em tabela é o mesmo já
   documentado em `metrics`.

3. **Comparação é com a MESMA FATIA do período anterior**, não com o período
   anterior inteiro: no dia 3 do mês, "Mês" compara os 3 primeiros dias deste
   mês com os 3 primeiros do anterior. Comparar 3 dias com 31 produziria uma
   queda de 90% todo início de mês — número que assusta e não informa.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from django.db.models import Q
from django.utils import timezone

from apps.tickets.models import SatisfactionSurvey, TicketPriority, TicketStatus, TicketStatusEvent

# quantas fatias nomeadas os gráficos de rosca mostram antes de agrupar o resto
TOP_SLICES = 8
OTHERS_LABEL = "Outros"
UNSET_LABEL = "Não informada"

OPEN_STATUSES = (TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.PENDING_CUSTOMER)

PERIODS = {
    "today": "Hoje",
    "week": "Esta semana",
    "month": "Este mês",
}

# Intervalo livre (`?from=&to=`) — não é um dos atalhos acima, e por isso não
# entra em `PERIODS` (as tabelas de resumo continuam com as três colunas fixas).
CUSTOM_PERIOD = "custom"
# Teto do intervalo livre: a linha do tempo tem um ponto por dia, e um ano já
# é mais do que um gráfico diário consegue mostrar.
MAX_CUSTOM_DAYS = 366

# campos lidos na consulta única — nada além do que algum widget consome
ROW_FIELDS = (
    "id",
    "created_at",
    "closed_at",
    "status",
    "priority",
    "assignee_id",
    "assignee__full_name",
    "team_id",
    "team__name",
    "requester__full_name",
    "company__name",
    "category__name",
    "first_response_at",
    "sla_first_response_due_at",
    "sla_first_response_breached",
    "sla_resolution_due_at",
    "sla_resolution_breached",
)


@dataclass(frozen=True)
class Window:
    """Janela do período e a fatia equivalente do período anterior."""

    start: dt.datetime
    end: dt.datetime
    prev_start: dt.datetime
    prev_end: dt.datetime

    def holds(self, moment) -> bool:
        return moment is not None and self.start <= moment < self.end

    def held(self, moment) -> bool:
        """Mesmo teste, na fatia anterior."""
        return moment is not None and self.prev_start <= moment < self.prev_end


def _midnight(moment):
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def build_windows(now=None) -> dict[str, Window]:
    """Hoje, semana (a partir de segunda) e mês, cada uma com sua fatia anterior."""
    now = now or timezone.now()
    local = timezone.localtime(now)

    today = _midnight(local)
    week = today - dt.timedelta(days=today.weekday())  # segunda-feira
    month = today.replace(day=1)

    # mês anterior: o dia 1 do mês que termina um dia antes deste
    prev_month = (month - dt.timedelta(days=1)).replace(day=1)

    return {
        "today": Window(today, local, today - dt.timedelta(days=1), local - dt.timedelta(days=1)),
        "week": Window(week, local, week - dt.timedelta(days=7), local - dt.timedelta(days=7)),
        # a fatia anterior do mês tem o MESMO comprimento decorrido, não o mês
        # inteiro — ver decisão 3 no topo do arquivo
        "month": Window(month, local, prev_month, prev_month + (local - month)),
    }


def custom_window(date_from: dt.date | None, date_to: dt.date | None, now=None) -> Window:
    """Janela de um intervalo livre, com a fatia anterior de MESMO comprimento.

    `to` é o dia inteiro informado (a janela fecha na meia-noite seguinte),
    mas nunca passa de agora: um intervalo que termina hoje compara o que já
    aconteceu hoje com o mesmo tanto de tempo antes do início — a mesma regra
    de "mesma fatia" dos atalhos (decisão 3 no topo do arquivo).

    Sem `to`, vale hoje; sem `from`, os 30 dias que terminam em `to`.
    """
    now = timezone.localtime(now or timezone.now())
    date_to = date_to or now.date()
    date_from = date_from or (date_to - dt.timedelta(days=29))

    start = timezone.make_aware(dt.datetime.combine(date_from, dt.time.min))
    end_of_day = timezone.make_aware(
        dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min)
    )
    end = max(start, min(end_of_day, now))
    length = end - start
    return Window(start, end, start - length, start)


def variation(current: float | None, previous: float | None) -> float | None:
    """Variação percentual. Nula quando não há o que comparar — dos dois lados.

    Devolver 0 quando o período anterior foi zero seria mentira ("estável"), e
    devolver +100% para qualquer coisa saindo do zero também.

    `current is None` também zera a conta, e isso é sutil: uma MÉDIA nula quer
    dizer "não houve amostra", não "caiu para zero". Sem esta linha, o painel
    mostrava o tempo médio de primeira resposta como "—" e, logo abaixo,
    "-100,00%" — visto ao vivo no dia em que ninguém tinha respondido ainda.
    """
    if current is None or not previous:
        return None
    return round((current - previous) / previous * 100, 2)


def _cell(current: int | float | None, previous: int | float | None) -> dict:
    return {"value": current, "variation": variation(current, previous)}


# --------------------------------------------------------------------------- #
# leitura
# --------------------------------------------------------------------------- #

def _team_ids(user) -> set[int]:
    """Equipes do usuário: as que ele atende mais as que supervisiona."""
    ids = set(user.teams.values_list("id", flat=True))
    ids |= set(user.supervised_teams.values_list("id", flat=True))
    return {i for i in ids if i}


def _colleague_ids(teams: set[int]) -> set[int]:
    """Quem mais atende essas equipes.

    A fatia "Equipe" sempre significou "o que a minha turma está tocando", e
    isso tem dois lados: o ticket que É de uma equipe minha e o ticket que um
    colega meu está atendendo, mesmo tendo entrado por outra equipe. Antes da
    fusão o segundo lado vinha de graça (`assignee__team_id`, a lotação única
    do agente); agora que a lotação é N:N, o conjunto de colegas se resolve numa
    consulta só, em vez de um JOIN por linha de ticket.
    """
    if not teams:
        return set()
    from apps.accounts.models import AgentTeam

    return set(
        AgentTeam.objects.filter(team_id__in=teams).values_list("user_id", flat=True)
    )


def _scopes(user, teams: set[int]):
    """(chave, rótulo, predicado) de cada fatia das tabelas de resumo.

    "Equipe" só aparece para quem está em alguma equipe: para um interno solto
    ela seria uma linha idêntica a "Meus" ou a "Total", dependendo do caso —
    número repetido com nome diferente é pior do que campo ausente.
    """
    scopes = [("mine", "Meus", lambda r: r["assignee_id"] == user.id)]
    if teams:
        colegas = _colleague_ids(teams)
        scopes.append((
            "team",
            "Equipe",
            lambda r: r["team_id"] in teams or r["assignee_id"] in colegas,
        ))
    scopes.append(("total", "Total", lambda r: True))
    return scopes


def _rows(queryset, floor: dt.datetime) -> list[dict]:
    """A consulta única: tickets que TOCAM a janela mais antiga que será usada.

    `created_at >= floor` não bastaria: um ticket aberto no mês passado e
    fechado hoje precisa entrar para contar como resolvido.
    """
    return list(
        queryset.filter(Q(created_at__gte=floor) | Q(closed_at__gte=floor)).values(*ROW_FIELDS)
    )


# --------------------------------------------------------------------------- #
# widgets
# --------------------------------------------------------------------------- #

def _summaries(rows, windows, scopes) -> list[dict]:
    """As três tabelas do topo: aberto / pendente / resolvido."""
    metrics = [
        ("opened", "Resumo de tickets abertos", "created_at", None),
        # pendente = aberto no período e AINDA não fechado. É uma foto de agora
        # recortada pelo período de abertura, que é o que a tabela do material
        # mostra: quanto do que entrou continua na mesa.
        ("pending", "Resumo de tickets pendentes", "created_at", "open_only"),
        ("resolved", "Resumo de tickets resolvidos", "closed_at", None),
    ]

    out = []
    for key, label, field, extra in metrics:
        table = {"key": key, "label": label, "rows": []}
        for scope_key, scope_label, matches in scopes:
            cells = {}
            for period_key, window in windows.items():
                current = previous = 0
                for row in rows:
                    if not matches(row):
                        continue
                    if extra == "open_only" and row["status"] == TicketStatus.CLOSED:
                        continue
                    moment = row[field]
                    if window.holds(moment):
                        current += 1
                    elif window.held(moment):
                        previous += 1
                cells[period_key] = _cell(current, previous)
            table["rows"].append({"key": scope_key, "label": scope_label, "cells": cells})
        out.append(table)
    return out


def _distribution(rows, key, *, fallback=UNSET_LABEL, top=TOP_SLICES) -> list[dict]:
    """Contagem por rótulo, do maior para o menor, com cauda agrupada."""
    counts: dict[str, int] = {}
    for row in rows:
        label = row[key] or fallback
        counts[label] = counts.get(label, 0) + 1

    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    head, tail = ordered[:top], ordered[top:]
    slices = [{"label": label, "value": value} for label, value in head]
    if tail:
        slices.append({"label": OTHERS_LABEL, "value": sum(v for _, v in tail)})
    return slices


def _by_choice(rows, key, choices) -> list[dict]:
    """Distribuição em ordem de enum (status, prioridade) — inclusive os zerados.

    Barra que some quando a contagem é zero engana: "não há ticket novo" e "a
    barra não existe" viram a mesma imagem.

    Cada fatia leva a `key` do enum além do rótulo, como os baldes de SLA já
    levam: é por ela que a tela escolhe a cor da barra (urgente em vermelho,
    aguardando em âmbar) — rótulo é texto traduzível, chave é contrato.
    """
    counts: dict[str, int] = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return [
        {"key": value, "label": str(label), "value": counts.get(value, 0)}
        for value, label in choices
    ]


def _first_response(rows) -> list[dict]:
    """Cumprimento do SLA de primeira resposta, dos tickets abertos no período.

    O material tem três fatias; aqui são quatro. A que falta lá é "aguardando":
    ticket sem resposta e ainda dentro do prazo não é "no prazo" — ele ainda
    pode estourar, e somá-lo aos cumpridos infla o indicador todo dia.
    """
    buckets = {"no_sla": 0, "on_time": 0, "late": 0, "waiting": 0}
    for row in rows:
        if not row["sla_first_response_due_at"]:
            buckets["no_sla"] += 1
        elif row["sla_first_response_breached"]:
            buckets["late"] += 1
        elif row["first_response_at"]:
            buckets["on_time"] += 1
        else:
            buckets["waiting"] += 1
    labels = {
        "no_sla": "Sem SLA", "on_time": "No prazo",
        "late": "Fora do prazo", "waiting": "Aguardando resposta",
    }
    return [{"key": k, "label": labels[k], "value": v} for k, v in buckets.items()]


def _resolution(rows) -> list[dict]:
    """Cumprimento do SLA de solução, dos tickets FECHADOS no período."""
    buckets = {"undefined": 0, "on_time": 0, "late": 0}
    for row in rows:
        if not row["sla_resolution_due_at"]:
            buckets["undefined"] += 1
        elif row["sla_resolution_breached"]:
            buckets["late"] += 1
        else:
            buckets["on_time"] += 1
    labels = {"undefined": "Não definido", "on_time": "No prazo", "late": "Fora do prazo"}
    return [{"key": k, "label": labels[k], "value": v} for k, v in buckets.items()]


def _agent_list(rows, previous_rows, surveys=(), window=None) -> list[dict]:
    """Listagem por agente responsável: resolvidos (com variação), equipe, taxa
    de cumprimento de SLA, primeira resposta média e nota média recebida.

    Cada coluna tem seu próprio denominador e por isso pode ser nula sozinha:
    um agente sem nenhum ticket com SLA definido não tem taxa (não é 0%), e um
    sem pesquisa respondida não tem nota (não é 0). Zero e "não há" são coisas
    diferentes — a tela mostra travessão, não número inventado.
    """
    def tally(source):
        counts: dict[str, int] = {}
        for row in source:
            name = row["assignee__full_name"] or "Sem responsável"
            counts[name] = counts.get(name, 0) + 1
        return counts

    current, previous = tally(rows), tally(previous_rows)

    # equipes onde o agente resolveu, mais frequente primeiro: um agente pode
    # atender por mais de uma, e escolher só uma sem dizer seria esconder isso
    equipes: dict[str, dict[str, int]] = {}
    prazo: dict[str, list[int]] = {}
    resposta: dict[str, list[int]] = {}
    for row in rows:
        name = row["assignee__full_name"] or "Sem responsável"
        if row["team__name"]:
            por_agente = equipes.setdefault(name, {})
            por_agente[row["team__name"]] = por_agente.get(row["team__name"], 0) + 1
        if row["sla_resolution_due_at"]:
            prazo.setdefault(name, []).append(0 if row["sla_resolution_breached"] else 1)
        segundos = _seconds_between(row["created_at"], row["first_response_at"])
        if segundos is not None:
            resposta.setdefault(name, []).append(segundos)

    # nota é do agente que era RESPONSÁVEL pelo ticket avaliado; a pesquisa não
    # tem campo de agente próprio
    notas: dict[int, list[int]] = {}
    for s in surveys:
        if window is not None and not window.holds(s["responded_at"]):
            continue
        if s.get("ticket__assignee_id") is not None:
            notas.setdefault(s["ticket__assignee_id"], []).append(s["score"])
    notas_por_nome: dict[str, list[int]] = {}
    ids_por_nome = {
        (row["assignee__full_name"] or "Sem responsável"): row["assignee_id"] for row in rows
    }
    for name, agent_id in ids_por_nome.items():
        if agent_id in notas:
            notas_por_nome[name] = notas[agent_id]

    names = sorted(set(current) | set(previous), key=lambda n: (-current.get(n, 0), n))
    out = []
    for name in names:
        marcas = prazo.get(name, [])
        out.append({
            "label": name,
            **_cell(current.get(name, 0), previous.get(name, 0)),
            "teams": [
                {"name": t, "value": v}
                for t, v in sorted(equipes.get(name, {}).items(), key=lambda kv: (-kv[1], kv[0]))
            ],
            "on_time_rate": round(sum(marcas) / len(marcas), 4) if marcas else None,
            "first_response_seconds": _average(resposta.get(name, [])),
            "score": _average(notas_por_nome.get(name, [])),
        })

    todas_marcas = [m for lista in prazo.values() for m in lista]
    todas_respostas = [s for lista in resposta.values() for s in lista]
    todas_notas = [n for lista in notas_por_nome.values() for n in lista]
    out.append({
        "label": "Total", "is_total": True,
        **_cell(sum(current.values()), sum(previous.values())),
        "teams": [],
        "on_time_rate": round(sum(todas_marcas) / len(todas_marcas), 4) if todas_marcas else None,
        "first_response_seconds": _average(todas_respostas),
        "score": _average(todas_notas),
    })
    return out


def _timeline(rows, window, reopens_by_day) -> list[dict]:
    """Série diária: abertos, resolvidos, resolvidos no prazo e reabertos.

    "Resolvido no prazo" anda junto de "resolvido" de propósito: a distância
    entre as duas linhas É o cumprimento do SLA ao longo do período, e ler isso
    numa comparação vale mais do que um segundo gráfico com o mesmo dado.
    """
    days: dict[dt.date, dict] = {}
    day = timezone.localtime(window.start).date()
    # `end` é exclusivo: num intervalo livre ele cai na meia-noite do dia
    # seguinte ao último, e sem o recuo de 1µs a série ganhava um dia vazio
    # a mais no fim
    last = max(day, timezone.localtime(window.end - dt.timedelta(microseconds=1)).date())
    while day <= last:
        days[day] = {
            "date": day.isoformat(),
            "opened": 0, "resolved": 0, "resolved_on_time": 0, "reopened": 0,
        }
        day += dt.timedelta(days=1)

    for row in rows:
        if window.holds(row["created_at"]):
            bucket = days.get(timezone.localtime(row["created_at"]).date())
            if bucket:
                bucket["opened"] += 1
        if window.holds(row["closed_at"]):
            bucket = days.get(timezone.localtime(row["closed_at"]).date())
            if bucket:
                bucket["resolved"] += 1
                if row["sla_resolution_due_at"] and not row["sla_resolution_breached"]:
                    bucket["resolved_on_time"] += 1

    for date, count in reopens_by_day.items():
        if date in days:
            days[date]["reopened"] = count

    return list(days.values())


def _average(values) -> float | None:
    values = [v for v in values if v is not None]
    return sum(values) / len(values) if values else None


def _seconds_between(start, end) -> int | None:
    if not start or not end:
        return None
    return int((end - start).total_seconds())


def _kpis(opened, closed, prev_opened, prev_closed, csat, prev_csat) -> list[dict]:
    """Bloco "Principais indicadores": valor, descrição e variação."""
    def on_time(source):
        return sum(
            1 for r in source
            if r["sla_resolution_due_at"] and not r["sla_resolution_breached"]
        )

    def first_response_seconds(source):
        return _average([
            _seconds_between(r["created_at"], r["first_response_at"]) for r in source
        ])

    def resolution_seconds(source):
        return _average([
            _seconds_between(r["created_at"], r["closed_at"]) for r in source
        ])

    # `direction` diz PARA QUE LADO a variação é boa — é o que decide a cor da
    # seta na tela. Volume aberto fica NEUTRO de propósito: mais chamados é
    # contexto (a base cresceu, teve incidente), não desempenho do time; pintar
    # de vermelho seria a tela emitindo um juízo que o dado não sustenta.
    spec = [
        ("opened", "Tickets abertos", "Total de tickets abertos no período.",
         "count", None, len(opened), len(prev_opened)),
        ("resolved", "Tickets resolvidos", "Tickets que foram fechados dentro do período.",
         "count", "up", len(closed), len(prev_closed)),
        ("resolved_on_time", "Tickets resolvidos no prazo",
         "Fechados antes do vencimento do SLA de solução.",
         "count", "up", on_time(closed), on_time(prev_closed)),
        ("first_response", "Tempo médio de primeira resposta",
         "Da abertura até a primeira resposta pública de um agente.",
         "seconds", "down", first_response_seconds(opened), first_response_seconds(prev_opened)),
        ("resolution", "Tempo médio de resolução",
         "Da abertura ao fechamento, dos tickets fechados no período.",
         "seconds", "down", resolution_seconds(closed), resolution_seconds(prev_closed)),
        ("csat", "Nota média de satisfação",
         "Média das respostas da pesquisa recebidas no período (0 a 10).",
         "score", "up", csat, prev_csat),
    ]
    return [
        {"key": key, "label": label, "description": description,
         "unit": unit, "direction": direction, **_cell(current, previous)}
        for key, label, description, unit, direction, current, previous in spec
    ]


def _satisfaction(surveys, window, closed_count) -> dict:
    """Bloco da pesquisa: quantos foram resolvidos, quantos responderam e a curva 0–10."""
    answered = [s for s in surveys if window.holds(s["responded_at"])]
    counts = [0] * 11
    for survey in answered:
        score = survey["score"]
        if score is not None and 0 <= score <= 10:
            counts[score] += 1

    total = len(answered)
    return {
        "resolved": closed_count,
        "answers": total,
        "average": _average([s["score"] for s in answered]),
        "distribution": [
            {"score": score, "count": count,
             "percent": (count / total * 100) if total else 0.0}
            for score, count in enumerate(counts)
        ],
    }


# --------------------------------------------------------------------------- #
# entrada
# --------------------------------------------------------------------------- #

def build_indicators(queryset, user, *, period: str = "month",
                     team_id=None, date_from: dt.date | None = None,
                     date_to: dt.date | None = None, now=None) -> dict:
    """Monta o painel inteiro. `queryset` já vem de `visible_tickets(user)`.

    `date_from`/`date_to` (qualquer um dos dois) trocam o atalho por um
    intervalo livre: KPIs, distribuições, linha do tempo, SLA, satisfação e a
    lista por agente passam a olhar para ele. As três tabelas de resumo não —
    elas SÃO a comparação hoje × semana × mês, e continuam iguais.
    """
    if period not in PERIODS:
        period = "month"

    windows = build_windows(now)
    if date_from or date_to:
        period = CUSTOM_PERIOD
        window = custom_window(date_from, date_to, now)
        inicio = timezone.localtime(window.start).date()
        # `end` é exclusivo: o último dia coberto é o anterior à meia-noite
        # de fechamento (ou hoje, quando a janela foi cortada em agora)
        fim = timezone.localtime(window.end - dt.timedelta(microseconds=1)).date()
        label = f"{inicio:%d/%m/%Y} a {max(inicio, fim):%d/%m/%Y}"
    else:
        window = windows[period]
        label = PERIODS[period]
    floor = min([w.prev_start for w in windows.values()] + [window.prev_start])

    # o filtro de equipe vale para TODO o painel — inclusive reaberturas e
    # pesquisas, que não passam por `rows`
    if team_id:
        queryset = queryset.filter(team_id=team_id)

    rows = _rows(queryset, floor)

    opened = [r for r in rows if window.holds(r["created_at"])]
    prev_opened = [r for r in rows if window.held(r["created_at"])]
    closed = [r for r in rows if window.holds(r["closed_at"])]
    prev_closed = [r for r in rows if window.held(r["closed_at"])]

    # reaberturas vêm do histórico de status, não de `last_reopened_at`: aquele
    # campo guarda só a ÚLTIMA reabertura, e um ticket reaberto três vezes no
    # mês apareceria uma vez só na série.
    reopens = TicketStatusEvent.objects.filter(
        ticket__in=queryset, is_reopen=True,
        created_at__gte=window.start, created_at__lt=window.end,
    ).values_list("created_at", flat=True)
    reopens_by_day: dict[dt.date, int] = {}
    for moment in reopens:
        date = timezone.localtime(moment).date()
        reopens_by_day[date] = reopens_by_day.get(date, 0) + 1

    surveys = list(
        SatisfactionSurvey.objects.filter(ticket__in=queryset, responded_at__isnull=False)
        .filter(responded_at__gte=window.prev_start)
        .values("score", "responded_at", "ticket__assignee_id")
    )
    csat = _satisfaction(surveys, window, len(closed))
    prev_csat = _average([
        s["score"] for s in surveys if window.held(s["responded_at"])
    ])

    return {
        "period": {
            "key": period,
            "label": label,
            "start": window.start,
            "end": window.end,
            "previous_start": window.prev_start,
            "previous_end": window.prev_end,
        },
        "periods": [{"key": k, "label": v} for k, v in PERIODS.items()],
        "summaries": _summaries(rows, windows, _scopes(user, _team_ids(user))),
        "kpis": _kpis(opened, closed, prev_opened, prev_closed,
                      csat["average"], prev_csat),
        "by_requester": _distribution(opened, "requester__full_name"),
        "by_company": _distribution(opened, "company__name"),
        "by_category": _distribution(opened, "category__name"),
        "resolved_by_agent": _distribution(closed, "assignee__full_name",
                                           fallback="Sem responsável"),
        "by_priority": _by_choice(opened, "priority", TicketPriority.choices),
        "by_status": _by_choice(opened, "status", TicketStatus.choices),
        "first_response": _first_response(opened),
        "resolution": _resolution(closed),
        "agent_list": _agent_list(closed, prev_closed, surveys, window),
        "timeline": _timeline(rows, window, reopens_by_day),
        "satisfaction": csat,
    }
