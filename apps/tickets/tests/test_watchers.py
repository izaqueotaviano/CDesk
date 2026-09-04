""""+ Seguir"/remover manual de chamado (achado durante a Fase 2 de integração,
registrado em GAPS.md): só existia o efeito colateral de virar seguidor por
@menção antes disto."""

import pytest

pytestmark = pytest.mark.django_db


class TestFollowUnfollow:
    def test_agent_follows_and_appears_in_watchers(self, api, agente_suporte, make_ticket,
                                                    ana, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/follow/")
        assert resp.status_code == 200
        assert [w["id"] for w in resp.json()["watchers"]] == [agente_suporte.pk]

    def test_following_twice_does_not_duplicate(self, api, agente_suporte, make_ticket,
                                                 ana, suporte):
        ticket = make_ticket(ana, suporte)
        api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/follow/")
        resp = api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/follow/")
        assert len(resp.json()["watchers"]) == 1

    def test_unfollow_removes(self, api, agente_suporte, make_ticket, ana, suporte):
        ticket = make_ticket(ana, suporte)
        api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/follow/")
        resp = api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/unfollow/")
        assert resp.json()["watchers"] == []

    def test_client_cannot_follow(self, api, ana, make_ticket, suporte):
        ticket = make_ticket(ana, suporte)
        assert api(ana).post(f"/api/v1/tickets/{ticket.pk}/follow/").status_code == 403

    def test_mention_side_effect_still_shows_up_as_watcher(
        self, api, agente_suporte, admin, make_ticket, ana, suporte
    ):
        """Não quebra o caminho existente (mentions.py) — só some a lacuna de
        leitura/escrita manual."""
        ticket = make_ticket(ana, suporte)
        api(agente_suporte).post(f"/api/v1/tickets/{ticket.pk}/reply/", {
            "body": f"Oi @[user:{admin.pk}], dá uma olhada?", "is_public": False,
        }, format="json")
        resp = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/")
        assert admin.pk in [w["id"] for w in resp.json()["watchers"]]
