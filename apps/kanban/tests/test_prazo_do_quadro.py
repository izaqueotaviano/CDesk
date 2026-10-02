"""O alarme do prazo interno do card — antes o prazo vencia em silêncio."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.kanban.models import Board, Card
from apps.kanban.tasks import warn_overdue_cards
from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Agente",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )
    user.team_links.create(team=suporte)
    return user


@pytest.fixture
def ana(db):
    plan = Plan.objects.create(slug="basic", name="Basic", rank=1,
                               default_ticket_limit=50)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT, company=acme,
    )


@pytest.fixture
def board(db):
    return Board.objects.create(name="Geral", slug="geral")


def _ticket(ana, suporte):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject="Assunto", body="Corpo",
    )


def _card(board, ticket, horas_atras):
    return Card.objects.create(
        board=board, ticket=ticket,
        due_at=timezone.now() - dt.timedelta(hours=horas_atras),
    )


def test_prazo_vencido_avisa_o_responsavel(board, ana, suporte, agente):
    ticket = _ticket(ana, suporte)
    ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
    _card(board, ticket, horas_atras=2)

    assert warn_overdue_cards() == 1
    aviso = Notification.objects.get(kind=NotificationKind.KANBAN_DUE)
    assert aviso.recipient == agente
    assert ticket.reference in aviso.title


def test_um_aviso_so_por_vencimento(board, ana, suporte, agente):
    ticket = _ticket(ana, suporte)
    ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
    _card(board, ticket, horas_atras=2)

    assert warn_overdue_cards() == 1
    assert warn_overdue_cards() == 0  # segunda varredura não repete


def test_sem_responsavel_cai_no_supervisor(board, ana, suporte):
    chefe = User.objects.create_user(
        email="chefe@x.test", full_name="Chefe",
        kind=UserKind.INTERNAL, internal_role=InternalRole.SUPERVISOR,
    )
    suporte.supervisor = chefe
    suporte.save(update_fields=["supervisor"])
    ticket = _ticket(ana, suporte)
    _card(board, ticket, horas_atras=1)

    assert warn_overdue_cards() == 1
    assert Notification.objects.get(kind=NotificationKind.KANBAN_DUE).recipient == chefe


def test_ticket_fechado_nao_alarma(board, ana, suporte, agente):
    ticket = _ticket(ana, suporte)
    ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
    ticket_service.close_ticket(
        ticket=ticket, actor=agente,
        resolution_started_at=ticket.created_at,
        resolution_ended_at=timezone.now(),
    )
    _card(board, ticket, horas_atras=3)

    assert warn_overdue_cards() == 0


class TestEmailDoPrazo:
    """KANBAN_DUE só avisava in-app — o toggle de e-mail existia na tela e
    não tinha efeito nenhum. Respeita a preferência PESSOAL de quem recebe
    (agente, dono técnico ou supervisor), não uma preferência institucional."""

    def test_prazo_vencido_envia_email_ao_responsavel(self, board, ana, suporte, agente):
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        _card(board, ticket, horas_atras=2)

        warn_overdue_cards()
        email = OutboundEmail.objects.get(to_email=agente.email, template="kanban_due")
        assert email.ticket_id == ticket.pk

    def test_email_desligado_nao_envia(self, board, ana, suporte, agente):
        NotificationPreference.objects.create(user=agente, email={"kanban_due": False})
        ticket = _ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente, actor=agente)
        _card(board, ticket, horas_atras=2)

        warn_overdue_cards()
        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.KANBAN_DUE
        ).exists()  # sino continua ligado
        assert not OutboundEmail.objects.filter(template="kanban_due").exists()

    def test_supervisor_sem_responsavel_tambem_recebe_email(self, board, ana, suporte):
        chefe = User.objects.create_user(
            email="chefe@x.test", full_name="Chefe",
            kind=UserKind.INTERNAL, internal_role=InternalRole.SUPERVISOR,
        )
        suporte.supervisor = chefe
        suporte.save(update_fields=["supervisor"])
        ticket = _ticket(ana, suporte)
        _card(board, ticket, horas_atras=1)

        warn_overdue_cards()
        assert OutboundEmail.objects.filter(
            to_email=chefe.email, template="kanban_due"
        ).exists()
