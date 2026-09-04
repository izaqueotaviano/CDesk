"""A menção não pode alcançar o cliente — prova escrita de fora.

Fixtures e asserções próprias, sem reaproveitar as da suíte de menções: se a
regra tivesse sido implementada com o mesmo engano dos dois lados, os testes
de lá passariam junto com o erro. O que está travado aqui é o pior caso do
recurso — recado interno aparecendo para o cliente.
"""
import pytest

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.customers.models import Company, Plan
from apps.tickets.models import Ticket, TicketMention, TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def cena(db):
    plano = Plan.objects.create(slug="g", name="G", default_ticket_limit=99)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plano)
    eq = Team.objects.create(name="Suporte", slug="suporte")
    ana = User.objects.create_user(email="ana@acme.test", full_name="Ana",
                                   kind=UserKind.CLIENT, company=acme, client_role="owner")
    def ag(email, nome, ativo=True):
        u = User.objects.create_user(email=email, full_name=nome, kind=UserKind.INTERNAL,
                                     internal_role=InternalRole.AGENT, is_active=ativo)
        AgentTeam.objects.create(user=u, team=eq)
        return u
    izaque, sumido = ag("iza@x.test", "Izaque"), ag("old@x.test", "Desativado", ativo=False)
    t = Ticket.objects.create(reference="T-1", company=acme, requester=ana, team=eq,
                              subject="s", status=TicketStatus.OPEN)
    return dict(t=t, ana=ana, izaque=izaque, sumido=sumido, eq=eq, agente=ag("a@x.test", "Agente"))


def test_mencao_em_resposta_publica_nao_vira_mencao(cena):
    """A regra dura. Se isto quebrar, um cliente lê o recado interno."""
    msg = ticket_service.add_reply(
        ticket=cena["t"], author=cena["agente"], is_public=True,
        body=f"@[user:{cena['izaque'].pk}] confere isso", new_status=TicketStatus.OPEN)
    assert not TicketMention.objects.filter(message=msg).exists()
    from apps.notifications.models import Notification
    assert not Notification.objects.filter(recipient=cena["izaque"]).exists()


def test_nota_interna_menciona_e_notifica(cena):
    msg = ticket_service.add_reply(
        ticket=cena["t"], author=cena["agente"], is_public=False,
        body=f"@[user:{cena['izaque'].pk}] confere isso")
    assert TicketMention.objects.filter(message=msg, user=cena["izaque"]).exists()
    from apps.notifications.models import Notification
    assert Notification.objects.filter(recipient=cena["izaque"]).count() == 1


def test_cliente_nunca_e_alvo_de_mencao(cena):
    msg = ticket_service.add_reply(
        ticket=cena["t"], author=cena["agente"], is_public=False,
        body=f"@[user:{cena['ana'].pk}] oi")
    assert not TicketMention.objects.filter(message=msg, user=cena["ana"]).exists()


def test_agente_desativado_nao_e_notificado(cena):
    from apps.notifications.models import Notification
    ticket_service.add_reply(ticket=cena["t"], author=cena["agente"], is_public=False,
                             body=f"@[user:{cena['sumido'].pk}] oi")
    assert not Notification.objects.filter(recipient=cena["sumido"]).exists()


def test_mesma_pessoa_duas_vezes_gera_uma_notificacao(cena):
    from apps.notifications.models import Notification
    i = cena["izaque"].pk
    ticket_service.add_reply(ticket=cena["t"], author=cena["agente"], is_public=False,
                             body=f"@[user:{i}] e de novo @[user:{i}]")
    assert Notification.objects.filter(recipient=cena["izaque"]).count() == 1


def test_mencao_a_equipe_e_a_pessoa_nao_duplica(cena):
    from apps.notifications.models import Notification
    ticket_service.add_reply(
        ticket=cena["t"], author=cena["agente"], is_public=False,
        body=f"@[team:{cena['eq'].pk}] e @[user:{cena['izaque'].pk}]")
    assert Notification.objects.filter(recipient=cena["izaque"]).count() == 1
    # e o desativado da equipe não recebe
    assert not Notification.objects.filter(recipient=cena["sumido"]).exists()


def test_o_nome_acompanha_a_troca_de_nome(cena):
    from rest_framework.test import APIRequestFactory

    from apps.tickets.serializers import TicketDetailSerializer
    ticket_service.add_reply(ticket=cena["t"], author=cena["agente"], is_public=False,
                             body=f"@[user:{cena['izaque'].pk}] oi")
    cena["izaque"].full_name = "Izaque Otaviano"
    cena["izaque"].save()
    req = APIRequestFactory().get("/")
    req.user = cena["agente"]
    dados = TicketDetailSerializer(cena["t"], context={"request": req}).data
    nomes = [m["name"] for msg in dados["messages"] for m in msg.get("mentions", [])]
    assert "Izaque Otaviano" in nomes
