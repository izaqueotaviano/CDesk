"""Isolamento depois da fusão departamento→equipe, provado do lado de fora.

Fixtures e asserções escritas sem reaproveitar as da suíte antiga: se a
fusão tivesse alargado a visibilidade em silêncio, os testes herdados
poderiam passar junto com o erro.

O que está travado aqui é a fronteira comercial (uma empresa nunca vê a
outra) e a fronteira interna (equipe internal_only não aparece para o
cliente). Vale para o ORM e para a API."""
import pytest

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.tickets.models import Ticket, TicketStatus

pytestmark = pytest.mark.django_db


@pytest.fixture
def mundo(db):
    plano = Plan.objects.create(slug="p", name="P", default_ticket_limit=99)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plano)
    rival = Company.objects.create(name="Rival", slug="rival", plan=plano)
    design = Team.objects.create(name="Design", slug="design")
    infra = Team.objects.create(name="Infra", slug="infra")
    interna = Team.objects.create(name="Comercial", slug="comercial", internal_only=True)

    def cliente(email, empresa):
        return User.objects.create_user(email=email, full_name=email, kind=UserKind.CLIENT,
                                        company=empresa, client_role="member")
    def agente(email, *equipes):
        u = User.objects.create_user(email=email, full_name=email, kind=UserKind.INTERNAL,
                                     internal_role=InternalRole.AGENT)
        for e in equipes:
            AgentTeam.objects.create(user=u, team=e)
        return u

    ana, bob = cliente("ana@acme.test", acme), cliente("bob@rival.test", rival)
    def tk(req, team, assunto):
        return Ticket.objects.create(reference=f"T-{assunto}", company=req.company,
                                     requester=req, team=team, subject=assunto,
                                     status=TicketStatus.OPEN)
    return dict(
        ana=ana, bob=bob, acme=acme, rival=rival,
        design=design, infra=infra, interna=interna,
        t_acme_design=tk(ana, design, "acme-design"),
        t_acme_infra=tk(ana, infra, "acme-infra"),
        t_acme_interno=tk(ana, interna, "acme-interno"),
        t_rival=tk(bob, design, "rival-design"),
        ag_design=agente("d@x.test", design),
        ag_duas=agente("dd@x.test", design, infra),
        ag_nenhuma=agente("n@x.test"),
        admin=User.objects.create_user(email="a@x.test", full_name="A",
                                       kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN),
    )


def refs(user):
    return set(Ticket.objects.visible_to(user).values_list("subject", flat=True))


def test_cliente_nunca_ve_ticket_de_outra_empresa(mundo):
    assert "rival-design" not in refs(mundo["ana"])
    assert "acme-design" not in refs(mundo["bob"])


def test_cliente_nao_ve_equipe_interna(mundo):
    """Comercial é internal_only: o chamado é sobre o cliente, não para ele."""
    assert "acme-interno" not in refs(mundo["ana"])
    assert refs(mundo["ana"]) == {"acme-design", "acme-infra"}


def test_agente_ve_so_as_equipes_a_que_pertence(mundo):
    assert refs(mundo["ag_design"]) == {"acme-design", "rival-design"}
    assert "acme-infra" not in refs(mundo["ag_design"])


def test_agente_em_duas_equipes_ve_as_duas(mundo):
    assert refs(mundo["ag_duas"]) == {"acme-design", "acme-infra", "rival-design"}


def test_agente_sem_equipe_nao_ve_nada(mundo):
    assert refs(mundo["ag_nenhuma"]) == set()


def test_admin_ve_tudo(mundo):
    assert len(refs(mundo["admin"])) == 4


def test_remover_o_vinculo_tira_a_visao_na_hora(mundo):
    ag = mundo["ag_duas"]
    assert "acme-infra" in refs(ag)
    AgentTeam.objects.filter(user=ag, team=mundo["infra"]).delete()
    assert "acme-infra" not in refs(ag)


def test_api_nao_vaza_ticket_de_outra_empresa(mundo):
    """A prova acima é do ORM. Esta é da porta de entrada: mesmo pedindo o id
    exato, o cliente da outra empresa leva 404 — nunca 403 com corpo, que já
    confirmaria a existência do chamado."""
    from rest_framework.test import APIClient

    c = APIClient()
    c.force_authenticate(user=mundo["ana"])
    lista = c.get("/api/v1/tickets/").json()["results"]
    assuntos = {t["subject"] for t in lista}
    assert "rival-design" not in assuntos
    assert "acme-interno" not in assuntos

    alheio = mundo["t_rival"].pk
    assert c.get(f"/api/v1/tickets/{alheio}/").status_code == 404
    interno = mundo["t_acme_interno"].pk
    assert c.get(f"/api/v1/tickets/{interno}/").status_code == 404

    # e o agente de Design não alcança o ticket de Infra pelo id
    ag = APIClient()
    ag.force_authenticate(user=mundo["ag_design"])
    assert ag.get(f"/api/v1/tickets/{mundo['t_acme_infra'].pk}/").status_code == 404
