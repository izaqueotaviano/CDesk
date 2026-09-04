"""Mural: CRUD restrito a admin, audiência, vigência, fixados e dispensa."""

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    User,
    UserKind,
)
from apps.announcements.models import Announcement, AnnouncementKind, AudienceKind
from apps.customers.models import Company, Plan

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
def cliente(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    company = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=company, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _make(creator, **kw):
    defaults = {
        "title": "Aviso", "body": "Texto", "kind": AnnouncementKind.INFO,
        "starts_at": timezone.now() - dt.timedelta(hours=1),
        "audience_kind": AudienceKind.ALL,
        "created_by": creator,
    }
    defaults.update(kw)
    return Announcement.objects.create(**defaults)


class TestCrudPermissions:
    def test_admin_creates(self, api, admin):
        resp = api(admin).post("/api/v1/announcements/", {
            "title": "Recesso", "body": "Horário reduzido.",
            "kind": "holiday", "starts_at": timezone.now().isoformat(),
            "audience_kind": "all", "is_pinned": True,
        }, format="json")
        assert resp.status_code == 201
        assert Announcement.objects.get().created_by == admin

    def test_agent_cannot_create(self, api, agente):
        resp = api(agente).post("/api/v1/announcements/", {
            "title": "x", "body": "y", "starts_at": timezone.now().isoformat(),
        }, format="json")
        assert resp.status_code == 403

    def test_delete_deactivates_keeping_history(self, api, admin):
        ann = _make(admin)
        resp = api(admin).delete(f"/api/v1/announcements/{ann.pk}/")
        assert resp.status_code == 204
        ann.refresh_from_db()
        assert ann.is_active is False  # histórico preservado

    def test_validity_validation(self, api, admin):
        now = timezone.now()
        resp = api(admin).post("/api/v1/announcements/", {
            "title": "x", "body": "y",
            "starts_at": now.isoformat(),
            "ends_at": (now - dt.timedelta(days=1)).isoformat(),
        }, format="json")
        assert resp.status_code == 400

    def test_admin_edits_existing(self, api, admin):
        ann = _make(admin, title="Antigo")
        resp = api(admin).patch(f"/api/v1/announcements/{ann.pk}/", {
            "title": "Novo título", "is_pinned": True,
        }, format="json")
        assert resp.status_code == 200
        ann.refresh_from_db()
        assert ann.title == "Novo título"
        assert ann.is_pinned is True

    def test_agent_cannot_edit(self, api, admin, agente):
        ann = _make(admin, title="Intacto")
        resp = api(agente).patch(f"/api/v1/announcements/{ann.pk}/", {
            "title": "Hackeado",
        }, format="json")
        assert resp.status_code == 403
        ann.refresh_from_db()
        assert ann.title == "Intacto"

    def test_write_team_targeting_via_api(self, api, admin, agente, team):
        """O front manda a segmentação nos campos M2M — o endpoint tem de gravar."""
        resp = api(admin).post("/api/v1/announcements/", {
            "title": "Só a equipe", "body": "y",
            "starts_at": timezone.now().isoformat(),
            "audience_kind": "teams", "target_teams": [team.pk],
        }, format="json")
        assert resp.status_code == 201
        ann = Announcement.objects.get(title="Só a equipe")
        assert list(ann.target_teams.values_list("pk", flat=True)) == [team.pk]
        # e a audiência realmente alcança quem está na equipe
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 1

    def test_manage_shows_other_audience_to_admin(self, api, admin):
        """Sem manage, admin não vê aviso mirado em cliente; com manage, vê."""
        _make(admin, audience_kind=AudienceKind.ALL_CLIENTS)
        assert api(admin).get("/api/v1/announcements/").json()["count"] == 0
        managed = api(admin).get("/api/v1/announcements/?manage=1").json()
        assert managed["count"] == 1

    def test_manage_history_includes_deactivated(self, api, admin):
        ann = _make(admin)
        api(admin).delete(f"/api/v1/announcements/{ann.pk}/")  # desativa
        # vigentes de gestão não mostram o inativo
        assert api(admin).get("/api/v1/announcements/?manage=1").json()["count"] == 0
        # histórico de gestão mostra
        hist = api(admin).get("/api/v1/announcements/?manage=1&history=1").json()
        assert hist["count"] == 1
        assert hist["results"][0]["is_active"] is False

    def test_manage_ignored_for_non_admin(self, api, agente, admin):
        """manage=1 não pode virar bypass de audiência para não-admin."""
        _make(admin, audience_kind=AudienceKind.ALL_CLIENTS)
        assert api(agente).get("/api/v1/announcements/?manage=1").json()["count"] == 0

    def test_switching_audience_clears_stale_targets(self, api, admin, team):
        """Trocar para 'todos' e zerar target_teams desliga a segmentação antiga."""
        ann = _make(admin, audience_kind=AudienceKind.TEAMS)
        ann.target_teams.add(team)
        resp = api(admin).patch(f"/api/v1/announcements/{ann.pk}/", {
            "audience_kind": "all_internal", "target_teams": [],
        }, format="json")
        assert resp.status_code == 200
        ann.refresh_from_db()
        assert ann.target_teams.count() == 0


class TestAudience:
    def test_internal_only_hidden_from_clients(self, api, admin, agente, cliente):
        _make(admin, audience_kind=AudienceKind.ALL_INTERNAL)
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 1
        assert api(cliente).get("/api/v1/announcements/").json()["count"] == 0

    def test_team_targeting(self, api, admin, agente, team):
        ann = _make(admin, audience_kind=AudienceKind.TEAMS)
        ann.target_teams.add(team)
        other = User.objects.create_user(
            email="outro@x.test", full_name="Outro", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,  # sem equipe
        )
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 1
        assert api(other).get("/api/v1/announcements/").json()["count"] == 0

    def test_role_targeting(self, api, admin, agente):
        _make(admin, audience_kind=AudienceKind.ROLES, target_roles=["supervisor"])
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 0

    def test_plan_targeting(self, api, admin, cliente):
        ann = _make(admin, audience_kind=AudienceKind.PLANS)
        ann.target_plans.add(cliente.company.plan)
        assert api(cliente).get("/api/v1/announcements/").json()["count"] == 1

    def test_client_cannot_dismiss_internal_announcement(self, api, admin, cliente):
        """`dismiss` fora da audiência confirmaria por id a existência de um
        aviso interno. 404 é a resposta certa: não se dispensa o que não se vê."""
        ann = _make(admin, audience_kind=AudienceKind.ALL_INTERNAL)

        resp = api(cliente).post(f"/api/v1/announcements/{ann.pk}/dismiss/")

        assert resp.status_code == 404
        from apps.announcements.models import AnnouncementRead
        assert not AnnouncementRead.objects.filter(
            announcement=ann, user=cliente
        ).exists()

    def test_client_dismisses_own_announcement(self, api, admin, cliente):
        ann = _make(admin, audience_kind=AudienceKind.ALL)
        resp = api(cliente).post(f"/api/v1/announcements/{ann.pk}/dismiss/")
        assert resp.status_code == 200


class TestValidityAndPinning:
    def test_expired_hidden_but_in_admin_history(self, api, admin, agente):
        _make(admin, starts_at=timezone.now() - dt.timedelta(days=10),
              ends_at=timezone.now() - dt.timedelta(days=1))
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 0
        assert api(admin).get("/api/v1/announcements/?history=1").json()["count"] == 1

    def test_future_start_hidden(self, api, admin, agente):
        _make(admin, starts_at=timezone.now() + dt.timedelta(days=1))
        assert api(agente).get("/api/v1/announcements/").json()["count"] == 0

    def test_pinned_first(self, api, admin, agente):
        _make(admin, title="normal")
        _make(admin, title="fixado", is_pinned=True,
              starts_at=timezone.now() - dt.timedelta(days=5))
        titles = [a["title"] for a in
                  api(agente).get("/api/v1/announcements/").json()["results"]]
        assert titles[0] == "fixado"  # fixado vence mesmo sendo mais antigo


class TestDismiss:
    def test_dismiss_is_per_user(self, api, admin, agente):
        ann = _make(admin)
        api(agente).post(f"/api/v1/announcements/{ann.pk}/dismiss/")
        rows = api(agente).get("/api/v1/announcements/").json()["results"]
        assert rows[0]["dismissed"] is True
        rows = api(admin).get("/api/v1/announcements/").json()["results"]
        assert rows[0]["dismissed"] is False
