"""Cota de tickets — período civil no fuso da empresa (D3) e consumo atômico.

O "reset" da cota não existe como job: o período faz parte da chave do contador,
então a virada de mês/semana cria naturalmente um contador novo em zero (docs/05 §2.3).
"""

from __future__ import annotations

import datetime as dt
from zoneinfo import ZoneInfo

from django.utils import timezone

from apps.customers.models import (
    Company,
    LimitPeriod,
    LimitScope,
    QuotaPeriodCounter,
    TicketQuotaConsumption,
)


class QuotaExceeded(Exception):
    """Limite do período atingido. Carrega os dados da mensagem ao usuário."""

    def __init__(self, used: int, limit: int, renews_at: dt.date):
        self.used, self.limit, self.renews_at = used, limit, renews_at
        super().__init__(f"Cota esgotada: {used}/{limit}, renova em {renews_at:%d/%m/%Y}")


def current_period(company: Company, at=None) -> tuple[dt.date, dt.date]:
    """(início, fim) do período civil corrente, no fuso da empresa.

    MONTHLY: 1º ao último dia do mês. WEEKLY: segunda a domingo (semana ISO).
    """
    tz = ZoneInfo(company.timezone)
    today = (at or timezone.now()).astimezone(tz).date()

    if company.effective_limit_period == LimitPeriod.WEEKLY:
        start = today - dt.timedelta(days=today.weekday())
        return start, start + dt.timedelta(days=6)

    start = today.replace(day=1)
    next_month = (start + dt.timedelta(days=32)).replace(day=1)
    return start, next_month - dt.timedelta(days=1)


def check_and_consume(*, ticket, actor) -> bool:
    """Verifica o limite e registra o consumo — na MESMA transação do ticket.

    Deve ser chamado dentro de django.db.transaction.atomic() pelo ticket_service.
    Retorna True se consumiu, False se a fonte/plano isenta (ilimitado).
    Levanta QuotaExceeded se o período está cheio.
    """
    company = ticket.company
    limit = company.effective_ticket_limit
    if limit is None:
        return False  # ilimitado

    period_start, period_end = current_period(company)
    scope = company.limit_scope

    counter, _ = (
        QuotaPeriodCounter.objects.select_for_update().get_or_create(
            company=company,
            user=actor if scope == LimitScope.USER else None,
            period_start=period_start,
        )
    )
    if counter.used >= limit:
        raise QuotaExceeded(counter.used, limit, period_end + dt.timedelta(days=1))

    TicketQuotaConsumption.objects.create(
        company=company,
        user=actor,
        ticket=ticket,
        period_start=period_start,
        period_end=period_end,
        scope=scope,
        limit_snapshot=limit,
    )
    counter.used += 1
    counter.save(update_fields=["used"])
    return True


def usage(company: Company, user=None) -> dict:
    """Snapshot de uso para o banner do cliente ('3 de 10 usados neste mês')."""
    limit = company.effective_ticket_limit
    period_start, period_end = current_period(company)
    qs = TicketQuotaConsumption.objects.filter(company=company, period_start=period_start)
    if company.limit_scope == LimitScope.USER and user is not None:
        qs = qs.filter(user=user)
    return {
        "used": qs.count(),
        "limit": limit,
        "period_start": period_start,
        "period_end": period_end,
    }


__all__ = ["QuotaExceeded", "current_period", "check_and_consume", "usage"]
