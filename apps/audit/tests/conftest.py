"""Fixtures de LGPD e retenção.

Reaproveita o elenco do conftest de tickets — duas empresas, equipe
restrita, agentes. Os cenários de anonimização e retenção precisam exatamente
do mesmo mundo, e duplicá-lo criaria uma segunda verdade sobre quem enxerga o
quê. O import é em estrela porque `pytest_plugins` só vale no conftest raiz.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.tests.conftest import *  # noqa: F403


@pytest.fixture
def dsr(db):
    """Fábrica de pedidos LGPD."""
    from apps.audit.models import DataSubjectRequest

    def _make(kind="anonymize", *, user=None, company=None, requested_by=None, **extra):
        return DataSubjectRequest.objects.create(
            kind=kind, subject_user=user, subject_company=company,
            requested_by=requested_by, **extra,
        )

    return _make


@pytest.fixture
def closed_long_ago(make_ticket, ana, suporte):
    """Ticket fechado além do prazo de retenção, pronto para o expurgo."""
    from apps.tickets.models import Ticket, TicketStatus

    def _make(years=6, **kwargs):
        ticket = make_ticket(ana, suporte, **kwargs)
        Ticket.objects.filter(pk=ticket.pk).update(
            status=TicketStatus.CLOSED,
            closed_at=timezone.now() - dt.timedelta(days=365 * years),
        )
        ticket.refresh_from_db()
        return ticket

    return _make


@pytest.fixture
def purge_authorized(db):
    """Simulação já revisada — destrava o expurgo efetivo (D20).

    Existe como fixture explícita de propósito: um teste que apaga dados de
    verdade precisa declarar que passou pela autorização, do mesmo jeito que a
    operação passa.
    """
    from apps.audit.models import RetentionRun

    return RetentionRun.objects.create(
        dry_run=True,
        status=RetentionRun.Status.DONE,
        reviewed_at=timezone.now(),
        review_note="Revisado na suíte.",
    )
