"""Métricas de relatório (docs/02 §reports).

O SLA justo separa "tempo aguardando agente" (NEW/OPEN) de "tempo aguardando
cliente" (PENDING_CUSTOMER) — derivado do histórico real (`TicketStatusEvent`),
nunca estimado. CLOSED não conta para nenhum dos dois.

Em 50–500 tickets/mês isso roda em memória com folga; o ponto de virada
(materializar em TicketDailyMetric) está documentado para ~5k/mês.
"""

from __future__ import annotations

import datetime as dt

from django.utils import timezone

from apps.tickets.models import TicketStatus

# em qual "lado da mesa" o relógio corre para cada status
_WAITING_AGENT = {TicketStatus.NEW, TicketStatus.OPEN}
_WAITING_CUSTOMER = {TicketStatus.PENDING_CUSTOMER}


def waiting_times(ticket, events=None) -> dict:
    """Segundos aguardando agente × cliente, andando pelos eventos de status.

    `events` permite injetar a lista pré-buscada (evita N+1 no relatório).
    """
    if events is None:
        events = list(ticket.status_events.order_by("created_at", "id"))

    agent_s = customer_s = 0.0
    cursor = ticket.created_at
    status = TicketStatus.NEW
    now = timezone.now()

    def account(until):
        nonlocal agent_s, customer_s
        seconds = max(0.0, (until - cursor).total_seconds())
        if status in _WAITING_AGENT:
            agent_s += seconds
        elif status in _WAITING_CUSTOMER:
            customer_s += seconds

    for event in events:
        account(event.created_at)
        cursor = event.created_at
        status = event.to_status
    account(now)  # trecho aberto até agora (ou zero, se CLOSED encerrou)

    return {
        "waiting_agent_seconds": int(agent_s),
        "waiting_customer_seconds": int(customer_s),
    }


def ticket_row(ticket, events=None) -> dict:
    """Linha do relatório detalhado — uma por ticket."""
    waiting = waiting_times(ticket, events)
    first_response_s = (
        int((ticket.first_response_at - ticket.created_at).total_seconds())
        if ticket.first_response_at else None
    )
    resolution_s = (
        int((ticket.resolution_ended_at - ticket.resolution_started_at).total_seconds())
        if ticket.resolution_started_at and ticket.resolution_ended_at else None
    )
    cycle_s = (
        int((ticket.closed_at - ticket.created_at).total_seconds())
        if ticket.closed_at else None
    )
    return {
        "reference": ticket.reference,
        "subject": ticket.subject,
        "company": ticket.company.name,
        "requester": ticket.requester.full_name,
        "team": ticket.team.name,
        "status": ticket.status,
        "source": ticket.source,
        "assignee": ticket.assignee.full_name if ticket.assignee else "",
        "owner": ticket.owner.full_name if ticket.owner else "",
        "created_at": ticket.created_at,
        "first_response_seconds": first_response_s,
        "resolution_seconds": resolution_s,
        "cycle_seconds": cycle_s,
        "reopen_count": ticket.reopen_count,
        **waiting,
    }


def summarize(rows: list[dict]) -> dict:
    """Agregado do conjunto filtrado."""
    def avg(key):
        values = [r[key] for r in rows if r[key] is not None]
        return int(sum(values) / len(values)) if values else None

    return {
        "total": len(rows),
        "closed": sum(1 for r in rows if r["status"] == TicketStatus.CLOSED),
        "reopened_tickets": sum(1 for r in rows if r["reopen_count"] > 0),
        "reopen_events": sum(r["reopen_count"] for r in rows),
        "avg_first_response_seconds": avg("first_response_seconds"),
        "avg_resolution_seconds": avg("resolution_seconds"),
        "avg_cycle_seconds": avg("cycle_seconds"),
        "avg_waiting_agent_seconds": avg("waiting_agent_seconds"),
        "avg_waiting_customer_seconds": avg("waiting_customer_seconds"),
        "by_source": _count_by(rows, "source"),
        "by_status": _count_by(rows, "status"),
    }


def _count_by(rows, key) -> dict:
    out: dict = {}
    for r in rows:
        out[r[key]] = out.get(r[key], 0) + 1
    return out


def build_report(queryset, *, date_from: dt.date | None = None,
                 date_to: dt.date | None = None,
                 agent_id=None, company_id=None, requester_id=None,
                 collect_restricted: bool = False) -> dict:
    """Aplica filtros, monta linhas (com prefetch de eventos) e o resumo.

    `collect_restricted`: além do relatório, devolve em `restricted_ids` os ids
    dos tickets de equipe restrita incluídos. A exportação usa isso para
    gravar um TicketAccessLog por ticket — ler assunto e solicitante em massa é
    leitura de conteúdo restrito tanto quanto abrir um a um, e a trilha por
    ticket é o que a política de auditoria promete. Fica atrás de flag para não
    inchar o payload JSON do relatório de tela, que não precisa dos ids.
    """
    qs = queryset.select_related(
        "company", "requester", "team", "assignee", "owner"
    ).prefetch_related("status_events")

    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    if agent_id:
        qs = qs.filter(assignee_id=agent_id)
    if company_id:
        qs = qs.filter(company_id=company_id)
    if requester_id:
        qs = qs.filter(requester_id=requester_id)

    tickets = list(qs.order_by("created_at"))
    rows = [
        ticket_row(t, events=sorted(t.status_events.all(),
                                    key=lambda e: (e.created_at, e.id)))
        for t in tickets
    ]
    resultado = {"summary": summarize(rows), "rows": rows}
    if collect_restricted:
        resultado["restricted_ids"] = [t.id for t in tickets if t.is_restricted()]
    return resultado
