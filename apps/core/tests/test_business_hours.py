"""Aritmética de horário comercial: os casos de borda que quebram SLA."""

import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from apps.core.business_hours import add_business_minutes
from apps.core.models import BusinessCalendar, Holiday

TZ = ZoneInfo("America/Sao_Paulo")


@pytest.fixture
def calendar(db):
    cal = BusinessCalendar.objects.create(
        name="Comercial", timezone="America/Sao_Paulo",
        workdays=[{"weekday": d, "start": "09:00", "end": "18:00"} for d in range(5)],
    )
    Holiday.objects.create(calendar=cal, date=dt.date(2026, 9, 7), name="Independência")
    return cal


def _at(year, month, day, hour, minute=0):
    return dt.datetime(year, month, day, hour, minute, tzinfo=TZ)


def test_within_same_day(calendar):
    # terça 10h + 120min = terça 12h
    assert add_business_minutes(_at(2026, 8, 4, 10), 120, calendar) == _at(2026, 8, 4, 12)

def test_overflows_to_next_morning(calendar):
    # terça 17:30 + 60min = 30min hoje + 30min amanhã → quarta 09:30
    assert add_business_minutes(_at(2026, 8, 4, 17, 30), 60, calendar) == \
        _at(2026, 8, 5, 9, 30)

def test_friday_evening_lands_monday(calendar):
    # sexta 17:00 + 120min = 60min sexta + 60min segunda → segunda 10:00
    assert add_business_minutes(_at(2026, 8, 7, 17), 120, calendar) == \
        _at(2026, 8, 10, 10)

def test_start_before_opening_counts_from_opening(calendar):
    # 6h da manhã: o relógio só começa às 9h
    assert add_business_minutes(_at(2026, 8, 4, 6), 60, calendar) == _at(2026, 8, 4, 10)

def test_holiday_skipped(calendar):
    # sexta 04/09 17:30 + 60min: sábado/domingo fora, segunda 07/09 é feriado
    # → 30min sexta + 30min terça 08/09 → terça 09:30
    assert add_business_minutes(_at(2026, 9, 4, 17, 30), 60, calendar) == \
        _at(2026, 9, 8, 9, 30)

def test_no_calendar_wall_clock():
    start = _at(2026, 8, 4, 22)
    assert add_business_minutes(start, 90, None) == start + dt.timedelta(minutes=90)

def test_unusable_calendar_degrades_to_wall_clock(db):
    cal = BusinessCalendar.objects.create(name="Vazio", workdays=[])
    start = _at(2026, 8, 4, 10)
    assert add_business_minutes(start, 60, cal) == start + dt.timedelta(minutes=60)


# --------------------------------------------------------------------------- #
# Expediente partido (09-12 / 13-18): o intervalo de almoço não conta como SLA
# --------------------------------------------------------------------------- #

@pytest.fixture
def split_calendar(db):
    """Manhã 09-12, tarde 13-18, de segunda a sexta."""
    return BusinessCalendar.objects.create(
        name="Partido", timezone="America/Sao_Paulo",
        workdays=[
            w for d in range(5) for w in (
                {"weekday": d, "start": "09:00", "end": "12:00"},
                {"weekday": d, "start": "13:00", "end": "18:00"},
            )
        ],
    )


def test_split_shift_skips_lunch(split_calendar):
    # terça 11:30 + 60min: 30min antes do almoço, 30min depois → 13:30
    assert add_business_minutes(_at(2026, 8, 4, 11, 30), 60, split_calendar) == \
        _at(2026, 8, 4, 13, 30)


def test_start_during_lunch_counts_from_afternoon(split_calendar):
    # 12:30 está no intervalo: o relógio só começa às 13:00
    assert add_business_minutes(_at(2026, 8, 4, 12, 30), 60, split_calendar) == \
        _at(2026, 8, 4, 14)


def test_split_shift_day_is_shorter_than_straight_day(split_calendar):
    # o dia tem 8h úteis (3 + 5), não 9: 8h a partir das 09:00 fecham às 18:00
    assert add_business_minutes(_at(2026, 8, 4, 9), 8 * 60, split_calendar) == \
        _at(2026, 8, 4, 18)
    # e 9h transbordam para o dia seguinte
    assert add_business_minutes(_at(2026, 8, 4, 9), 9 * 60, split_calendar) == \
        _at(2026, 8, 5, 10)


def test_partial_holiday_opens_only_in_its_window(calendar):
    """Feriado de meio período: naquele dia o expediente é só a janela do
    feriado, ignorando o horário normal da semana."""
    # 24/12/2026 é quinta; feriado que só abre das 09h às 12h
    Holiday.objects.create(
        calendar=calendar, date=dt.date(2026, 12, 24), name="Véspera de Natal",
        start_time=dt.time(9, 0), end_time=dt.time(12, 0),
    )
    # quinta 24/12 10h + 60min = 11h (dentro da janela do meio período)
    assert add_business_minutes(_at(2026, 12, 24, 10), 60, calendar) == \
        _at(2026, 12, 24, 11)


def test_partial_holiday_overflow_skips_to_next_day(calendar):
    """Estourando a janela do meio período, o resto vai para o próximo dia útil."""
    Holiday.objects.create(
        calendar=calendar, date=dt.date(2026, 12, 24), name="Véspera de Natal",
        start_time=dt.time(9, 0), end_time=dt.time(12, 0),
    )
    # quinta 24/12 11h + 120min: 60min até 12h (fim da janela) + 60min sexta 25
    assert add_business_minutes(_at(2026, 12, 24, 11), 120, calendar) == \
        _at(2026, 12, 25, 10)
