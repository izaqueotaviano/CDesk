"""Resolução e aplicação de política de SLA.

A política mais específica vence: (plano × equipe) > (plano) >
(equipe) > global. Prazos em minutos de horário comercial quando
`use_business_hours` (D15), usando o calendário da empresa ou o padrão.
"""

from django.utils import timezone

from apps.core.business_hours import add_business_minutes
from apps.core.models import BusinessCalendar
from apps.tickets.models import SLAPolicy


def resolve_policy(company, team) -> SLAPolicy | None:
    base = SLAPolicy.objects.filter(is_active=True)
    return (
        base.filter(plan=company.plan, team=team).first()
        or base.filter(plan=company.plan, team__isnull=True).first()
        or base.filter(plan__isnull=True, team=team).first()
        or base.filter(plan__isnull=True, team__isnull=True).first()
    )


def _calendar_for(company, policy):
    if not policy.use_business_hours:
        return None
    return company.business_calendar or BusinessCalendar.objects.filter(
        is_default=True
    ).first()


def apply_sla(ticket) -> None:
    """Na criação: define política e os dois prazos a partir de created_at."""
    policy = resolve_policy(ticket.company, ticket.team)
    if policy is None:
        return
    calendar = _calendar_for(ticket.company, policy)
    ticket.sla_policy = policy
    ticket.sla_first_response_due_at = add_business_minutes(
        ticket.created_at, policy.first_response_minutes, calendar
    )
    ticket.sla_resolution_due_at = add_business_minutes(
        ticket.created_at, policy.resolution_minutes, calendar
    )
    ticket.save(update_fields=[
        "sla_policy", "sla_first_response_due_at", "sla_resolution_due_at",
    ])


def restart_resolution_sla(ticket) -> None:
    """D5: reabertura reinicia SÓ o prazo de resolução, a partir de agora.

    O prazo de primeira resposta pertence ao ciclo original e não é tocado.
    """
    policy = ticket.sla_policy or resolve_policy(ticket.company, ticket.team)
    if policy is None:
        return
    calendar = _calendar_for(ticket.company, policy)
    ticket.sla_resolution_due_at = add_business_minutes(
        timezone.now(), policy.resolution_minutes, calendar
    )
    ticket.save(update_fields=["sla_resolution_due_at"])
