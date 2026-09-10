"""Visões salvas da barra lateral.

Elas são recortes NOMEADOS, definidos no servidor: "Tickets sem atendimento"
tem de querer dizer a mesma coisa na tela de hoje e no relatório de amanhã.
Cada teste aqui é a definição de uma delas, escrita de um jeito que quebra se
alguém mudar o significado sem querer.
"""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import (
    AgentTeam,
    ClientRole,
    InternalRole,
    Team,
    TeamVisibility,
    User,
    UserKind,
)
from apps.customers.models import Company, Plan
from apps.kanban.models import Board, Card
from apps.tickets.models import Ticket
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def ana(db):
    plano = Plan.objects.create(slug="gold", name="Gold")
    empresa = Company.objects.create(name="Acme", slug="acme", plan=plano)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=empresa, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def samuel(suporte):
    user = User.objects.create_user(
        email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def api(samuel):
    client = APIClient()
    client.force_authenticate(user=samuel)
    return client


@pytest.fixture
def cenario(ana, samuel, suporte):
    """Um ticket para cada situação que as visões separam."""
    def abrir(assunto, **campos):
        t = ticket_service.create_ticket(
            requester=ana, team=suporte, subject=assunto, body="b"
        )
        if campos:
            Ticket.objects.filter(pk=t.pk).update(**campos)
            t.refresh_from_db()
        return t

    meu = abrir("meu sem resposta", assignee=samuel)
    de_outro = abrir("de outro", assignee=None,
                     first_response_at=timezone.now())
    fechado = abrir("fechado")
    ticket_service.close_ticket(
        ticket=fechado, actor=samuel,
        resolution_started_at=fechado.created_at,
        resolution_ended_at=timezone.now(),
    )
    interno = ticket_service.create_ticket(
        requester=ana, team=suporte, subject="aberto pelo agente",
        body="b", actor=samuel,
    )
    return {"meu": meu, "de_outro": de_outro, "fechado": fechado, "interno": interno}


def assuntos(api, view):
    resp = api.get("/api/v1/tickets/", {"view": view})
    assert resp.status_code == 200
    return {t["subject"] for t in resp.json()["results"]}


class TestVisoes:
    def test_todos(self, api, cenario):
        assert len(assuntos(api, "todos")) == 4

    def test_meus_nao_resolvidos(self, api, cenario):
        assert assuntos(api, "meus-nao-resolvidos") == {"meu sem resposta"}

    def test_sem_atendimento_e_quem_ainda_nao_recebeu_resposta(self, api, cenario):
        achados = assuntos(api, "sem-atendimento")
        assert "meu sem resposta" in achados
        assert "de outro" not in achados      # já teve 1ª resposta
        assert "fechado" not in achados       # resolvido não é fila

    def test_nao_atribuidos_ignora_os_fechados(self, api, cenario, samuel):
        # o fechado do cenário não tem responsável, e mesmo assim não entra
        Ticket.objects.filter(subject="fechado").update(assignee=None)
        assert "fechado" not in assuntos(api, "nao-atribuidos")
        assert "de outro" in assuntos(api, "nao-atribuidos")

    def test_resolvidos(self, api, cenario):
        assert assuntos(api, "resolvidos") == {"fechado"}

    def test_internos_sao_os_abertos_por_um_agente(self, api, cenario):
        assert assuntos(api, "internos") == {"aberto pelo agente"}

    def test_em_kanban_e_o_que_TEM_PRAZO_ANOTADO(self, api, cenario, samuel):
        """O quadro mostra a fila inteira, então "estar no kanban" não recorta
        nada. O que recorta é o prazo interno anotado lá."""
        quadro = Board.objects.create(name="Q", slug="q", created_by=samuel)
        Card.objects.create(board=quadro, ticket=cenario["meu"],
                            due_at=timezone.now())
        # sem prazo, o card nem chega a existir — e este não entra na visão
        Card.objects.create(board=quadro, ticket=cenario["de_outro"])

        assert assuntos(api, "em-kanban") == {"meu sem resposta"}

    def test_visao_desconhecida_nao_esvazia_a_tela(self, api, cenario):
        assert len(assuntos(api, "inventada")) == 4


# --------------------------------------------------------------------------- #
# A busca não pode virar oráculo do que a máscara esconde
# --------------------------------------------------------------------------- #

@pytest.fixture
def financeiro(db):
    return Team.objects.create(
        name="Financeiro", slug="financeiro",
        visibility=TeamVisibility.REQUESTER_ONLY,
    )


@pytest.fixture
def beto(ana):
    """Colega de empresa da Ana — vê os tickets dela, mascarados quando restritos."""
    return User.objects.create_user(
        email="beto@acme.test", full_name="Beto", kind=UserKind.CLIENT,
        company=ana.company, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def cliente_de():
    def _para(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _para


class TestBuscaERestricao:
    """Numa equipe restrita o assunto é mascarado para quem não é o
    solicitante. Se o `?q=` casasse contra o assunto real, o campo viraria um
    oráculo: digitar um trecho e ver a linha aparecer confirma exatamente o
    conteúdo que a máscara existe para esconder.

    A referência continua casando sempre — ela não é conteúdo, é o número que o
    cliente cita ao telefone.
    """

    def test_colega_nao_acha_pelo_assunto_do_ticket_restrito(
        self, cliente_de, ana, beto, financeiro,
    ):
        ticket = ticket_service.create_ticket(
            requester=ana, team=financeiro,
            subject="Cobrança duplicada do boleto 998877", body="corpo",
        )

        achados = cliente_de(beto).get("/api/v1/tickets/?q=998877").json()["results"]
        assert ticket.reference not in [t["reference"] for t in achados]

        # e o ticket continua LISTADO para ele — mascarado, como sempre foi
        todos = cliente_de(beto).get("/api/v1/tickets/").json()["results"]
        linha = next(t for t in todos if t["reference"] == ticket.reference)
        assert linha["content_hidden"] is True

    def test_o_dono_acha_o_proprio_ticket_restrito(self, cliente_de, ana, financeiro):
        ticket = ticket_service.create_ticket(
            requester=ana, team=financeiro,
            subject="Cobrança duplicada do boleto 998877", body="corpo",
        )
        achados = cliente_de(ana).get("/api/v1/tickets/?q=998877").json()["results"]
        assert ticket.reference in [t["reference"] for t in achados]

    def test_a_referencia_acha_mesmo_mascarado(self, cliente_de, beto, ana, financeiro):
        """O número do chamado não é conteúdo: quem o recebeu por e-mail ou
        ouviu no telefone tem de conseguir chegar na linha (mascarada)."""
        ticket = ticket_service.create_ticket(
            requester=ana, team=financeiro, subject="Segredo", body="corpo",
        )
        achados = cliente_de(beto).get(
            f"/api/v1/tickets/?q={ticket.reference}"
        ).json()["results"]
        assert ticket.reference in [t["reference"] for t in achados]

    def test_interno_acha_pelo_assunto(self, api, ana, suporte):
        """Para o interno nada muda: ele já lê o conteúdo restrito (com o
        acesso registrado), então a busca não teria o que proteger."""
        ticket = ticket_service.create_ticket(
            requester=ana, team=suporte,
            subject="Erro no relatório 4477", body="corpo",
        )
        achados = api.get("/api/v1/tickets/?q=4477").json()["results"]
        assert ticket.reference in [t["reference"] for t in achados]
