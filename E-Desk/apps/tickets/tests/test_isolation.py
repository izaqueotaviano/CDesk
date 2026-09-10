"""Suíte de isolamento — o teste de segurança central do sistema (docs/04).

Duas empresas, uma equipe restrita, matriz de papéis: afirma quem vê o
quê em cada endpoint. Se um destes testes quebrar, é vazamento de dado.
"""

import pytest

from apps.audit.models import TicketAccessLog
from apps.tickets.models import Ticket
from apps.tickets.serializers import MASKED_REQUESTER
from apps.tickets.services.references import next_reference

pytestmark = pytest.mark.django_db


class TestCompanyIsolation:
    """Usuário de uma empresa jamais alcança ticket de outra."""

    def test_client_list_only_own_company(self, api, make_ticket, ana, carla, suporte):
        make_ticket(ana, suporte)
        make_ticket(carla, suporte)
        data = api(ana).get("/api/v1/tickets/").json()
        assert data["count"] == 1
        data = api(carla).get("/api/v1/tickets/").json()
        assert data["count"] == 1

    def test_cross_company_retrieve_is_404(self, api, make_ticket, ana, carla, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(carla).get(f"/api/v1/tickets/{ticket.pk}/")
        # 404, não 403: a existência do ticket também é informação
        assert resp.status_code == 404

    def test_cross_company_reply_is_404(self, api, make_ticket, ana, carla, suporte):
        ticket = make_ticket(ana, suporte)
        resp = api(carla).post(
            f"/api/v1/tickets/{ticket.pk}/reply/", {"body": "invasão"}, format="json"
        )
        assert resp.status_code == 404
        assert ticket.messages.count() == 1  # nada foi gravado

    def test_tabs_reject_and_drop_foreign_ticket(self, api, make_ticket, ana, carla, suporte):
        own = make_ticket(carla, suporte)
        foreign = make_ticket(ana, suporte)
        resp = api(carla).put(
            "/api/v1/tickets/tabs/",
            {"ticket_ids": [own.pk, foreign.pk], "active_ticket_id": foreign.pk},
            format="json",
        )
        assert resp.status_code == 200
        ids = [t["id"] for t in resp.json()["tabs"]]
        assert ids == [own.pk]  # o alheio foi descartado em silêncio
        assert resp.json()["active_ticket_id"] is None


class TestInternalScope:
    """D1: interno enxerga pelos vínculos de equipe; admin vê tudo."""

    def test_agent_scope_excludes_unlinked_team(
        self, api, make_ticket, ana, suporte, financeiro,
        admin, supervisor, agente_suporte, agente_financeiro,
    ):
        make_ticket(ana, suporte)
        make_ticket(ana, financeiro)
        counts = {
            "admin": api(admin).get("/api/v1/tickets/").json()["count"],
            "supervisor": api(supervisor).get("/api/v1/tickets/").json()["count"],
            "agente_suporte": api(agente_suporte).get("/api/v1/tickets/").json()["count"],
            "agente_financeiro": api(agente_financeiro).get("/api/v1/tickets/").json()["count"],
        }
        assert counts == {
            "admin": 2, "supervisor": 2, "agente_suporte": 1, "agente_financeiro": 1
        }

    def test_unlinked_agent_cannot_retrieve_restricted(
        self, api, make_ticket, ana, financeiro, agente_suporte
    ):
        ticket = make_ticket(ana, financeiro)
        resp = api(agente_suporte).get(f"/api/v1/tickets/{ticket.pk}/")
        assert resp.status_code == 404

    def test_agent_cannot_open_in_unlinked_team(
        self, api, ana, financeiro, agente_suporte
    ):
        """Abrir em nome do cliente é só nas equipes que o agente atende.

        Sem isto, o agente de Suporte abriria chamado no Financeiro (restrito) —
        escrita fora do escopo que ele nem enxerga depois."""
        resp = api(agente_suporte).post(
            "/api/v1/tickets/",
            {"team_id": financeiro.pk, "subject": "x", "body": "y",
             "requester_id": ana.pk},
            format="json",
        )
        assert resp.status_code == 400
        assert not ana.company.tickets.filter(team=financeiro).exists()

    def test_agent_opens_in_own_team(self, api, ana, suporte, agente_suporte):
        resp = api(agente_suporte).post(
            "/api/v1/tickets/",
            {"team_id": suporte.pk, "subject": "x", "body": "y",
             "requester_id": ana.pk},
            format="json",
        )
        assert resp.status_code == 201

    def test_agent_in_two_teams_sees_both_and_only_those(
        self, api, make_ticket, ana, suporte, financeiro, comercial, agente_suporte
    ):
        """O vínculo é N:N: o mesmo agente atende Suporte E Financeiro.

        A soma é união, não interseção — e para nas equipes que ele atende.
        Este é o caso que a lotação única (`User.team`) não sabia representar
        e que o vínculo de departamento representava em paralelo; agora há um
        caminho só, e ele é o que `visible_to` lê.
        """
        from apps.accounts.models import AgentTeam

        AgentTeam.objects.create(user=agente_suporte, team=financeiro)

        no_suporte = make_ticket(ana, suporte)
        no_financeiro = make_ticket(ana, financeiro)
        # terceira equipe, sem vínculo: continua invisível. Vai pelo ORM porque
        # o próprio serviço já barraria a abertura fora das equipes dele — o que
        # está sob teste aqui é a LEITURA, e ela não pode depender disso.
        no_comercial = Ticket.objects.create(
            reference=next_reference(), company=ana.company, requester=ana,
            team=comercial, subject="Fora do alcance",
        )

        visiveis = {
            t["id"] for t in api(agente_suporte).get("/api/v1/tickets/").json()["results"]
        }
        assert visiveis == {no_suporte.pk, no_financeiro.pk}
        assert (
            api(agente_suporte).get(f"/api/v1/tickets/{no_comercial.pk}/").status_code
            == 404
        )


class TestRestrictedTeam:
    """Financeiro: linha na listagem para colegas, conteúdo só para o solicitante."""

    def test_requester_sees_full_content(self, api, make_ticket, ana, financeiro):
        ticket = make_ticket(ana, financeiro, subject="Fatura duplicada")
        data = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert data["subject"] == "Fatura duplicada"
        assert data["requester_display"] == "ana"
        assert data["is_restricted"] is True
        assert data["content_hidden"] is False
        assert len(data["messages"]) == 1

    def test_colleague_sees_masked_row(self, api, make_ticket, ana, beto, financeiro):
        ticket = make_ticket(ana, financeiro, subject="Fatura duplicada")
        listing = api(beto).get("/api/v1/tickets/").json()
        assert listing["count"] == 1  # a linha APARECE (requisito da UI)
        row = listing["results"][0]
        assert "Fatura" not in row["subject"]  # D6: assunto mascarado
        assert row["requester_display"] == MASKED_REQUESTER
        assert row["is_restricted"] is True  # cadeado
        assert row["content_hidden"] is True  # ícone "i"
        assert row["restriction_reason"]  # tooltip

        detail = api(beto).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert detail["messages"] == []  # conteúdo NUNCA sai
        assert "Fatura" not in detail["subject"]

    def test_colleague_cannot_reply_restricted(self, api, make_ticket, ana, beto, financeiro):
        ticket = make_ticket(ana, financeiro)
        resp = api(beto).post(
            f"/api/v1/tickets/{ticket.pk}/reply/", {"body": "oi"}, format="json"
        )
        assert resp.status_code == 400
        assert ticket.messages.count() == 1

    def test_owner_cannot_read_restricted_of_others(self, api, make_ticket, ana, olga, financeiro):
        """D9 dá ao OWNER o direito de responder — mas NÃO furar restrição do Financeiro."""
        ticket = make_ticket(ana, financeiro)
        detail = api(olga).get(f"/api/v1/tickets/{ticket.pk}/").json()
        assert detail["content_hidden"] is True
        resp = api(olga).post(
            f"/api/v1/tickets/{ticket.pk}/reply/", {"body": "oi"}, format="json"
        )
        assert resp.status_code == 400

    def test_access_log_records_reads_and_denials(
        self, api, make_ticket, ana, beto, agente_financeiro, financeiro
    ):
        ticket = make_ticket(ana, financeiro)
        api(ana).get(f"/api/v1/tickets/{ticket.pk}/")        # solicitante: granted
        api(beto).get(f"/api/v1/tickets/{ticket.pk}/")       # colega: negado (mascarado)
        api(agente_financeiro).get(f"/api/v1/tickets/{ticket.pk}/")  # agente: granted

        logs = TicketAccessLog.objects.filter(ticket=ticket).order_by("id")
        assert logs.count() == 3  # leitura de INTERNO também é logada
        assert [entry.was_granted for entry in logs] == [True, False, True]

    def test_regular_team_not_masked(self, api, make_ticket, ana, beto, suporte):
        make_ticket(ana, suporte, subject="Site fora do ar")
        row = api(beto).get("/api/v1/tickets/").json()["results"][0]
        assert row["subject"] == "Site fora do ar"
        assert row["requester_display"] == "ana"
        assert row["is_restricted"] is False
        assert row["content_hidden"] is False


class TestInternalNotes:
    def test_internal_note_never_reaches_client(
        self, api, make_ticket, ana, suporte, agente_suporte
    ):
        ticket = make_ticket(ana, suporte)
        api(agente_suporte).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "nota confidencial", "is_public": False},
            format="json",
        )
        detail = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        bodies = [m["body"] for m in detail["messages"]]
        assert "nota confidencial" not in bodies

    def test_client_cannot_forge_internal_note(
        self, api, make_ticket, ana, suporte
    ):
        """`is_public` é campo de autorização, não preferência de quem escreve.

        Um cliente mandando `is_public=false` criaria uma mensagem que some da
        thread dele mas fica visível ao suporte — conteúdo oculto da própria
        empresa, escrito por quem não deveria controlar esse campo. A resposta
        do cliente é SEMPRE pública."""
        ticket = make_ticket(ana, suporte)
        api(ana).post(
            f"/api/v1/tickets/{ticket.pk}/reply/",
            {"body": "só o suporte deveria ver", "is_public": False},
            format="json",
        )
        mensagem = ticket.messages.get(body="só o suporte deveria ver")
        assert mensagem.is_public is True


class TestInternalTeam:
    """Equipe interna: mais forte que restrita.

    Restrito (`REQUESTER_ONLY`) ainda deixa a linha aparecer mascarada para a
    empresa — é um ticket do cliente que outro usuário dele não pode ler.
    Interno é outra coisa: o ticket é NOSSO, sobre o cliente. A linha mascarada
    já contaria que existe um assunto comercial em aberto com ele.
    """

    def _ticket_interno(self, ana, comercial, agente_suporte):
        return Ticket.objects.create(
            reference=next_reference(), company=ana.company, requester=agente_suporte,
            team=comercial, subject="Negociar horas",
        )

    def test_client_never_sees_internal_team_ticket(
        self, api, ana, comercial, agente_suporte
    ):
        ticket = self._ticket_interno(ana, comercial, agente_suporte)
        data = api(ana).get("/api/v1/tickets/").json()

        assert ticket.pk not in [t["id"] for t in data["results"]]

    def test_client_retrieve_is_404(self, api, ana, comercial, agente_suporte):
        ticket = self._ticket_interno(ana, comercial, agente_suporte)

        # 404 e não 403: a existência do chamado também é informação
        assert api(ana).get(f"/api/v1/tickets/{ticket.pk}/").status_code == 404

    def test_client_search_cannot_confirm_it_exists(
        self, api, ana, comercial, agente_suporte
    ):
        """Busca por referência é o oráculo mais fácil: se o termo exato
        devolvesse a linha, o chamado interno estaria confirmado."""
        ticket = self._ticket_interno(ana, comercial, agente_suporte)

        data = api(ana).get(f"/api/v1/tickets/?q={ticket.reference}").json()
        assert data["count"] == 0

    def test_admin_sees_it(self, api, admin, ana, comercial, agente_suporte):
        ticket = self._ticket_interno(ana, comercial, agente_suporte)
        data = api(admin).get("/api/v1/tickets/").json()

        assert ticket.pk in [t["id"] for t in data["results"]]

    def test_internal_team_is_not_offered_to_client(self, api, ana, suporte, comercial):
        slugs = [d["slug"] for d in api(ana).get("/api/v1/teams/").json()["results"]]

        assert "suporte" in slugs
        assert "comercial" not in slugs

    def test_agent_still_sees_it_in_the_picker(self, api, agente_suporte, comercial):
        slugs = [d["slug"] for d in
                 api(agente_suporte).get("/api/v1/teams/").json()["results"]]

        assert "comercial" in slugs

    def test_client_cannot_open_ticket_in_internal_team(self, api, ana, comercial):
        """O seletor não oferece, mas o id vai no corpo da requisição — quem
        recusa é o serviço, não a tela."""
        resp = api(ana).post(
            "/api/v1/tickets/",
            {"team_id": comercial.pk, "subject": "Quero horas", "body": "..."},
            format="json",
        )

        assert resp.status_code == 400
        assert not comercial.tickets.exists()
