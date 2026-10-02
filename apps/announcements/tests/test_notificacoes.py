"""Notificação de aviso (sino + e-mail) — `NotificationKind.ANNOUNCEMENT` não
tinha NENHUM emissor até esta rodada; `notify_announcements` é o único lugar
do sistema que chama `notify()`/`queue_email()` para este tipo."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.announcements.models import Announcement, AnnouncementKind, AudienceKind
from apps.announcements.tasks import notify_announcements
from apps.customers.models import Company, Plan
from apps.notifications.models import Notification, NotificationKind, OutboundEmail

pytestmark = pytest.mark.django_db


@pytest.fixture
def team(db):
    return Team.objects.create(name="Atendimento", slug="atendimento")


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(team):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=team)
    return user


@pytest.fixture
def outro_agente(db):
    """Interno sem vínculo com `team` — fora da audiência de `teams`."""
    return User.objects.create_user(
        email="outro@x.test", full_name="Outro", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def cliente(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    company = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT, company=company,
    )


def _make(creator, **kw):
    defaults = {
        "title": "Manutenção programada", "body": "O sistema ficará fora do ar.",
        "kind": AnnouncementKind.INFO,
        "starts_at": timezone.now() - dt.timedelta(hours=1),
        "audience_kind": AudienceKind.ALL_INTERNAL,
        "created_by": creator,
    }
    defaults.update(kw)
    return Announcement.objects.create(**defaults)


class TestAudienciaCerta:
    def test_notifica_quem_esta_na_audiencia(self, admin, agente):
        ann = _make(admin)

        notify_announcements()

        aviso = Notification.objects.get(recipient=agente, kind=NotificationKind.ANNOUNCEMENT)
        assert aviso.title == "Manutenção programada"
        assert aviso.url == f"/avisos?aviso={ann.pk}"  # agente é interno
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="announcement",
        ).exists()

    def test_nao_notifica_cliente_fora_da_audiencia_interna(self, admin, agente, cliente):
        _make(admin, audience_kind=AudienceKind.ALL_INTERNAL)

        notify_announcements()

        assert not Notification.objects.filter(
            recipient=cliente, kind=NotificationKind.ANNOUNCEMENT,
        ).exists()

    def test_team_targeting_exclui_quem_nao_e_da_equipe(
        self, admin, agente, outro_agente, team,
    ):
        ann = _make(admin, audience_kind=AudienceKind.TEAMS)
        ann.target_teams.add(team)

        notify_announcements()

        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.ANNOUNCEMENT,
        ).exists()
        assert not Notification.objects.filter(
            recipient=outro_agente, kind=NotificationKind.ANNOUNCEMENT,
        ).exists()

    def test_ignora_aviso_futuro_ou_expirado(self, admin, agente):
        _make(admin, starts_at=timezone.now() + dt.timedelta(days=1))
        _make(admin, starts_at=timezone.now() - dt.timedelta(days=10),
              ends_at=timezone.now() - dt.timedelta(days=1))

        notify_announcements()

        assert not Notification.objects.filter(kind=NotificationKind.ANNOUNCEMENT).exists()

    def test_cliente_recebe_url_do_portal(self, admin, cliente):
        ann = _make(admin, audience_kind=AudienceKind.ALL_CLIENTS)

        notify_announcements()

        aviso = Notification.objects.get(recipient=cliente, kind=NotificationKind.ANNOUNCEMENT)
        assert aviso.url == f"/portal?aviso={ann.pk}"


class TestDedupe:
    def test_rodar_duas_vezes_seguidas_nao_duplica(self, admin, agente):
        _make(admin)

        notify_announcements()
        notify_announcements()

        assert Notification.objects.filter(
            recipient=agente, kind=NotificationKind.ANNOUNCEMENT,
        ).count() == 1
        assert OutboundEmail.objects.filter(
            to_email=agente.email, template="announcement",
        ).count() == 1
