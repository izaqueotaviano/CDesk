"""Aritmética de horário comercial para SLA (D15).

`add_business_minutes(início, minutos, calendário)` responde: "se o relógio só
anda dentro do expediente, quando vencem N minutos?" — pulando noites, fins de
semana e feriados do calendário. Sem calendário (ou sem janelas), cai em tempo
corrido: nunca é errado ter prazo, mesmo com configuração incompleta.
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

# trava de segurança: procurar expediente por no máximo 2 anos evita loop
# infinito com calendário sem nenhuma janela útil (ex.: só feriados)
_MAX_DAYS_SCAN = 730


def is_open_now(calendar=None, at: dt.datetime | None = None) -> bool:
    """O expediente está ABERTO neste instante?

    Mesma semântica de janelas/feriados do add_business_minutes: feriado de
    meio período manda no dia; feriado seco fecha o dia; dia normal usa o
    expediente da semana. Sem calendário (ou sem janelas) = sempre aberto —
    configuração incompleta não pode trancar o atendimento.
    """
    if calendar is None or not calendar.workdays:
        return True

    tz = ZoneInfo(calendar.timezone)
    agora = (at or dt.datetime.now(dt.UTC)).astimezone(tz)
    dia = agora.date()

    feriado = calendar.holidays.filter(date=dia).values(
        "start_time", "end_time"
    ).first()
    if feriado is not None:
        if not (feriado["start_time"] and feriado["end_time"]):
            return False  # feriado seco: fechado o dia inteiro
        janelas = [(feriado["start_time"], feriado["end_time"])]
    else:
        janelas = [
            (dt.time.fromisoformat(w["start"]), dt.time.fromisoformat(w["end"]))
            for w in calendar.workdays
            if int(w["weekday"]) == dia.weekday()
        ]

    hora = agora.time()
    return any(inicio <= hora < fim for inicio, fim in janelas)


def add_business_minutes(start: dt.datetime, minutes: int, calendar=None) -> dt.datetime:
    if calendar is None or not calendar.workdays:
        return start + dt.timedelta(minutes=minutes)

    tz = ZoneInfo(calendar.timezone)
    cursor = start.astimezone(tz)
    remaining = float(minutes)

    # feriado → janela do dia. Ausente do dict = dia normal; presente com None =
    # fechado o dia inteiro; presente com (início, fim) = meio período (só abre
    # nessa janela, ignorando o expediente da semana).
    holidays: dict[dt.date, tuple[dt.time, dt.time] | None] = {}
    for h in calendar.holidays.values("date", "start_time", "end_time"):
        if h["start_time"] and h["end_time"]:
            holidays[h["date"]] = (h["start_time"], h["end_time"])
        else:
            holidays[h["date"]] = None

    windows: dict[int, list[tuple[dt.time, dt.time]]] = {}
    for w in calendar.workdays:
        windows.setdefault(int(w["weekday"]), []).append(
            (dt.time.fromisoformat(w["start"]), dt.time.fromisoformat(w["end"]))
        )
    for day_windows in windows.values():
        day_windows.sort()

    for _ in range(_MAX_DAYS_SCAN):
        day = cursor.date()
        # janelas do dia: feriado de meio período manda; feriado seco fecha;
        # dia normal usa o expediente da semana
        if day in holidays:
            meio_periodo = holidays[day]
            janelas_do_dia = [meio_periodo] if meio_periodo else []
        else:
            janelas_do_dia = windows.get(day.weekday(), [])
        for win_start, win_end in janelas_do_dia:
            seg_start = max(cursor, dt.datetime.combine(day, win_start, tzinfo=tz))
            seg_end = dt.datetime.combine(day, win_end, tzinfo=tz)
            if seg_start >= seg_end:
                continue  # janela já passou
            available = (seg_end - seg_start).total_seconds() / 60
            if available >= remaining:
                return (seg_start + dt.timedelta(minutes=remaining)).astimezone(
                    start.tzinfo or tz
                )
            remaining -= available
        # próximo dia, a partir da meia-noite
        cursor = dt.datetime.combine(day + dt.timedelta(days=1), dt.time.min, tzinfo=tz)

    # calendário inutilizável: degrada para tempo corrido em vez de falhar
    return start + dt.timedelta(minutes=minutes)
