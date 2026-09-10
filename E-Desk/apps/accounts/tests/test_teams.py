"""Equipes: cadastro pelo admin, slug derivado, desativação preserva os vínculos.

Excluir DESATIVA em vez de apagar: a equipe carrega o histórico de tickets
(`Ticket.team` é PROTECT) e os vínculos de quem a atende — um DELETE de verdade
ou explodiria no banco ou desfaria a lotação de todo mundo em silêncio.
"""

import pytest

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind

pytestmark = pytest.mark.django_db

URL = "/api/v1/settings/teams/"


class TestTeamAdmin:
    def test_admin_creates_with_derived_slug(self, api, admin):
        resp = api(admin).post(URL, {"name": "Suporte Nível 2"}, format="json")
        assert resp.status_code == 201
        assert resp.json()["slug"] == "suporte-nivel-2"

    def test_slug_stays_unique(self, api, admin):
        a = api(admin).post(URL, {"name": "Plantão"}, format="json").json()
        b = api(admin).post(URL, {"name": "Plantão!"}, format="json").json()
        assert a["slug"] != b["slug"]

    def test_rename_keeps_slug(self, api, admin):
        """Renomear não rederiva o slug: é identidade interna."""
        created = api(admin).post(URL, {"name": "Triagem"}, format="json").json()
        api(admin).patch(f"{URL}{created['id']}/", {"name": "Triagem N1"},
                         format="json")
        team = Team.objects.get(pk=created["id"])
        assert team.name == "Triagem N1"
        assert team.slug == "triagem"

    def test_supervisor_can_be_set(self, api, admin, supervisor):
        created = api(admin).post(URL, {"name": "Campo"}, format="json").json()
        resp = api(admin).patch(f"{URL}{created['id']}/",
                                {"supervisor": supervisor.pk}, format="json")
        assert resp.status_code == 200
        assert resp.json()["supervisor_name"] == supervisor.full_name

    def test_delete_deactivates_and_keeps_members(self, api, admin, agente_suporte):
        team = Team.objects.create(name="Antiga", slug="antiga")
        AgentTeam.objects.create(user=agente_suporte, team=team)

        assert api(admin).delete(f"{URL}{team.pk}/").status_code == 204

        team.refresh_from_db()
        assert team.is_active is False
        # vínculo intacto: desativar tira a equipe do seletor, não da história
        assert agente_suporte.team_links.filter(team=team).exists()


class TestRoster:
    """`roster` é a tela "Equipes e agentes" inteira: cada equipe com quem a
    atende, mais quem não está em equipe nenhuma."""

    def test_agent_appears_in_every_team_he_serves(self, api, admin,
                                                   agente_suporte, suporte,
                                                   financeiro):
        AgentTeam.objects.create(user=agente_suporte, team=financeiro)

        body = api(admin).get(f"{URL}roster/").json()
        grupos = {t["name"]: [a["id"] for a in t["agents"]] for t in body["teams"]}
        assert agente_suporte.pk in grupos[suporte.name]
        assert agente_suporte.pk in grupos[financeiro.name]
        # e é o MESMO registro nos dois lugares, não uma cópia por equipe
        assert set(
            a["id"] for t in body["teams"] for a in t["agents"]
            if a["id"] == agente_suporte.pk
        ) == {agente_suporte.pk}

    def test_agent_without_team_lands_in_unassigned(self, api, admin):
        """Quem não tem vínculo não pode sumir da administração: é exatamente
        quem não enxerga ticket nenhum."""
        solto = User.objects.create_user(
            email="solto@x.test", full_name="Solto", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        body = api(admin).get(f"{URL}roster/").json()
        assert solto.pk in [a["id"] for a in body["unassigned"]]
        assert solto.pk not in [
            a["id"] for t in body["teams"] for a in t["agents"]
        ]

    def test_client_user_never_shows_up(self, api, admin, ana):
        body = api(admin).get(f"{URL}roster/").json()
        pessoas = [a["id"] for t in body["teams"] for a in t["agents"]]
        pessoas += [a["id"] for a in body["unassigned"]]
        assert ana.pk not in pessoas

    def test_client_cannot_read_the_roster(self, api, ana):
        assert api(ana).get(f"{URL}roster/").status_code == 403


class TestAddAgent:
    def test_creates_the_agent_already_in_the_team(self, api, admin, suporte):
        resp = api(admin).post(f"{URL}{suporte.pk}/agents/", {
            "full_name": "Izaque", "email": "izaque@x.test",
            "internal_role": "agent", "job_title": "designer",
        }, format="json")
        assert resp.status_code == 201

        novo = User.objects.get(email="izaque@x.test")
        assert novo.kind == UserKind.INTERNAL
        assert list(novo.teams.values_list("pk", flat=True)) == [suporte.pk]
        # interno entra por Google: nunca nasce com senha
        assert not novo.has_usable_password()

    def test_links_an_existing_agent(self, api, admin, agente_financeiro, suporte):
        resp = api(admin).post(f"{URL}{suporte.pk}/agents/",
                               {"user": agente_financeiro.pk}, format="json")
        assert resp.status_code == 201
        # ganhou a equipe nova sem perder a antiga — o vínculo é N:N
        assert set(
            agente_financeiro.teams.values_list("name", flat=True)
        ) == {"Financeiro", "Suporte"}

    def test_linking_twice_is_harmless(self, api, admin, agente_suporte, suporte):
        api(admin).post(f"{URL}{suporte.pk}/agents/",
                        {"user": agente_suporte.pk}, format="json")
        assert agente_suporte.team_links.filter(team=suporte).count() == 1

    def test_client_user_is_refused(self, api, admin, ana, suporte):
        resp = api(admin).post(f"{URL}{suporte.pk}/agents/",
                               {"user": ana.pk}, format="json")
        assert resp.status_code == 400
        assert "user" in resp.json()

    def test_only_admin_adds(self, api, agente_suporte, suporte):
        resp = api(agente_suporte).post(f"{URL}{suporte.pk}/agents/",
                                        {"user": agente_suporte.pk}, format="json")
        assert resp.status_code == 403


class TestPermissions:
    def test_agent_reads_but_cannot_write(self, api, agente_suporte):
        assert api(agente_suporte).get(URL).status_code == 200
        assert api(agente_suporte).post(URL, {"name": "X"},
                                        format="json").status_code == 403

    def test_client_cannot_reach_it(self, api, ana):
        assert api(ana).get(URL).status_code == 403
