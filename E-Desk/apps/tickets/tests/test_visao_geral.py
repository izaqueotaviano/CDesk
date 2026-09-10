"""O que a Visão geral precisa: filtro por plano, as duas visões salvas
novas, o feed de atividade e o resumo.

O fio que costura todos: NADA aqui pode furar visibilidade. Resumo, feed e
faceta saem do mesmo `get_queryset()`/`visible_to()` da lista — um número de
cartão que conte ticket de equipe restrita vaza tanto quanto abrir o ticket.
"""

import pytest
from django.utils import timezone

from apps.accounts.models import Team
from apps.customers.models import Company, CompanyDomain, Plan
from apps.tickets.models import TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan_black(db):
    return Plan.objects.create(slug="black", name="Black", rank=30)


@pytest.fixture
def delta(plan_black):
    return Company.objects.create(name="Delta", slug="delta", plan=plan_black)


class TestFiltroPorPlano:
    def test_filtra_pelo_slug_do_plano(
        self, api, agente_suporte, ana, suporte, delta, make_ticket,
    ):
        from apps.accounts.models import ClientRole, User, UserKind
        davi = User.objects.create_user(
            email="davi@delta.test", password="x", full_name="Davi",
            kind=UserKind.CLIENT, company=delta, client_role=ClientRole.MEMBER,
        )
        make_ticket(requester=ana, team=suporte)     # Acme, plano Gold
        make_ticket(requester=davi, team=suporte)    # Delta, plano Black

        r = api(agente_suporte).get("/api/v1/tickets/?plan=black")
        assert r.status_code == 200
        assert r.json()["count"] == 1
        assert r.json()["results"][0]["company_name"] == "Delta"

    def test_toda_empresa_tem_plano(self, plan_black):
        """`Company.plan` é NOT NULL no banco: empresa sem plano não existe,
        e por isso a faceta nunca devolve a linha "Sem plano". Este teste
        está aqui para que, no dia em que alguém tornar o campo opcional,
        ele quebre e lembre de reavaliar a barra lateral por plano."""
        from django.db import IntegrityError, transaction

        with pytest.raises(IntegrityError), transaction.atomic():
            Company.objects.create(name="Avulsa", slug="avulsa", plan=None)

    def test_faceta_lista_planos_do_superior_para_o_inferior(
        self, api, agente_suporte, ana, suporte, delta, make_ticket,
    ):
        """Ordem por `rank`, não por contagem: a barra lateral tem de listar
        sempre na mesma posição, senão obriga a reler o rótulo todo dia."""
        from apps.accounts.models import ClientRole, User, UserKind
        davi = User.objects.create_user(
            email="davi@delta.test", password="x", full_name="Davi",
            kind=UserKind.CLIENT, company=delta, client_role=ClientRole.MEMBER,
        )
        make_ticket(requester=ana, team=suporte)   # Gold (rank 20)
        for _ in range(3):
            make_ticket(requester=davi, team=suporte)  # Black (rank 30)

        planos = api(agente_suporte).get("/api/v1/tickets/facets/").json()["plan"]
        assert [p["value"] for p in planos] == ["black", "gold"]
        assert planos[0]["count"] == 3

    def test_sem_dominio_conta_empresa_sem_dominio_cadastrado(
        self, api, agente_suporte, ana, acme, suporte, make_ticket,
    ):
        make_ticket(requester=ana, team=suporte)
        corpo = api(agente_suporte).get("/api/v1/tickets/facets/").json()
        assert corpo["sem_dominio"] == 1

        CompanyDomain.objects.create(company=acme, domain="acme.test")
        corpo = api(agente_suporte).get("/api/v1/tickets/facets/").json()
        assert corpo["sem_dominio"] == 0

    def test_faceta_de_plano_nao_filtra_a_si_mesma(
        self, api, agente_suporte, ana, suporte, delta, make_ticket,
    ):
        """Com `plan=black` escolhido, a faceta ainda mostra Gold — senão
        não haveria como trocar de plano depois de escolher um."""
        from apps.accounts.models import ClientRole, User, UserKind
        davi = User.objects.create_user(
            email="davi@delta.test", password="x", full_name="Davi",
            kind=UserKind.CLIENT, company=delta, client_role=ClientRole.MEMBER,
        )
        make_ticket(requester=ana, team=suporte)
        make_ticket(requester=davi, team=suporte)

        planos = api(agente_suporte).get("/api/v1/tickets/facets/?plan=black").json()["plan"]
        assert {p["value"] for p in planos} == {"black", "gold"}


class TestVisoesNovas:
    def test_mencionam_voce_traz_o_ticket_da_nota(
        self, api, agente_suporte, admin, ana, suporte, make_ticket,
    ):
        t = make_ticket(requester=ana, team=suporte)
        make_ticket(requester=ana, team=suporte, subject="Sem menção")
        ticket_service.add_reply(
            ticket=t, author=admin, body=f"olha isso @[user:{agente_suporte.pk}]",
            is_public=False,
        )

        r = api(agente_suporte).get("/api/v1/tickets/?view=mencionam-voce")
        assert r.json()["count"] == 1
        assert r.json()["results"][0]["id"] == t.pk

    def test_mencao_a_equipe_conta_para_quem_esta_nela(
        self, api, agente_suporte, admin, ana, suporte, make_ticket,
    ):
        t = make_ticket(requester=ana, team=suporte)
        ticket_service.add_reply(
            ticket=t, author=admin, body=f"pergunta pro @[team:{suporte.pk}]",
            is_public=False,
        )
        r = api(agente_suporte).get("/api/v1/tickets/?view=mencionam-voce")
        assert r.json()["count"] == 1

    def test_tres_mencoes_no_mesmo_ticket_contam_uma_vez(
        self, api, agente_suporte, admin, ana, suporte, make_ticket,
    ):
        """Sem `distinct()` o JOIN em mensagens devolveria o ticket três
        vezes — e a CONTAGEM da barra lateral é o primeiro lugar onde isso
        apareceria errado."""
        t = make_ticket(requester=ana, team=suporte)
        for i in range(3):
            ticket_service.add_reply(
                ticket=t, author=admin, body=f"nota {i} @[user:{agente_suporte.pk}]",
                is_public=False,
            )
        r = api(agente_suporte).get("/api/v1/tickets/?view=mencionam-voce")
        assert r.json()["count"] == 1

    def test_aguardando_voce_exclui_o_que_espera_o_cliente(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        meu = make_ticket(requester=ana, team=suporte)
        ticket_service.assign(ticket=meu, assignee=agente_suporte, actor=agente_suporte)
        esperando_cliente = make_ticket(requester=ana, team=suporte, subject="Bola com ele")
        ticket_service.assign(
            ticket=esperando_cliente, assignee=agente_suporte, actor=agente_suporte,
        )
        ticket_service.add_reply(
            ticket=esperando_cliente, author=agente_suporte, body="pode confirmar?",
            is_public=True, new_status=TicketStatus.PENDING_CUSTOMER,
        )

        r = api(agente_suporte).get("/api/v1/tickets/?view=aguardando-voce")
        assert [t["id"] for t in r.json()["results"]] == [meu.pk]

    def test_visao_nova_respeita_equipe_restrita(
        self, api, agente_suporte, admin, ana, make_ticket,
    ):
        """A visão nova passa pelo mesmo `visible_to` do resto — citar
        alguém num ticket que ele não pode ver não abre a porta."""
        # "restrita" para um agente é a equipe em que ele NÃO está: o escopo
        # padrão de agente é TEAMS (rbac.ROLE_DEFAULT_SCOPE)
        fechada = Team.objects.create(name="Jurídico", slug="juridico")
        t = make_ticket(requester=ana, team=fechada)
        ticket_service.add_reply(
            ticket=t, author=admin, body=f"@[user:{agente_suporte.pk}]", is_public=False,
        )
        r = api(agente_suporte).get("/api/v1/tickets/?view=mencionam-voce")
        assert r.json()["count"] == 0


class TestAtividade:
    def test_traz_nota_interna_e_resolucao_com_o_verbo_pronto(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        t = make_ticket(requester=ana, team=suporte)
        ticket_service.add_reply(
            ticket=t, author=agente_suporte, body="olhando", is_public=False,
        )
        r = api(agente_suporte).get("/api/v1/tickets/atividade/?limit=20")
        assert r.status_code == 200
        itens = r.json()["results"]
        verbos = {i["verb"] for i in itens}
        assert "deixou nota interna em" in verbos
        assert all(i["reference"] == t.reference for i in itens)

    def test_nao_mostra_ticket_de_equipe_restrita(
        self, api, agente_suporte, ana, make_ticket,
    ):
        fechada = Team.objects.create(name="Jurídico", slug="juridico2")
        make_ticket(requester=ana, team=fechada)
        r = api(agente_suporte).get("/api/v1/tickets/atividade/")
        assert r.json()["results"] == []

    def test_limite_tem_teto(self, api, agente_suporte):
        r = api(agente_suporte).get("/api/v1/tickets/atividade/?limit=9999")
        assert r.status_code == 200
        assert len(r.json()["results"]) <= 50


class TestResumo:
    def test_conta_o_que_o_cartao_mostra(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        meu = make_ticket(requester=ana, team=suporte)
        ticket_service.assign(ticket=meu, assignee=agente_suporte, actor=agente_suporte)
        make_ticket(requester=ana, team=suporte, subject="Sem dono")

        corpo = api(agente_suporte).get("/api/v1/tickets/resumo/").json()
        assert corpo["abertos"]["total"] == 2
        assert corpo["nao_atribuidos"]["total"] == 1
        assert corpo["nao_atribuidos"]["espera_mais_longa_min"] is not None
        assert corpo["meus"]["total"] == 1
        assert corpo["meus"]["aguardando_voce"] == 1

    def test_fila_vazia_devolve_zero_e_nulo_nunca_erro(self, api, agente_suporte):
        corpo = api(agente_suporte).get("/api/v1/tickets/resumo/").json()
        assert corpo["nao_atribuidos"]["total"] == 0
        # sem fila não existe "o mais antigo" — nulo, não zero, que leria
        # como "chegou agora"
        assert corpo["nao_atribuidos"]["espera_mais_longa_min"] is None
        assert corpo["resolvidos_hoje"]["media_resolucao_min"] is None

    def test_nao_conta_ticket_de_equipe_restrita(
        self, api, agente_suporte, ana, make_ticket,
    ):
        fechada = Team.objects.create(name="Jurídico", slug="juridico3")
        make_ticket(requester=ana, team=fechada)
        corpo = api(agente_suporte).get("/api/v1/tickets/resumo/").json()
        assert corpo["abertos"]["total"] == 0

    def test_resolvido_hoje_entra_com_a_media(
        self, api, agente_suporte, ana, suporte, make_ticket,
    ):
        t = make_ticket(requester=ana, team=suporte)
        agora = timezone.now()
        ticket_service.close_ticket(
            ticket=t, actor=agente_suporte,
            resolution_started_at=agora, resolution_ended_at=agora,
        )
        corpo = api(agente_suporte).get("/api/v1/tickets/resumo/").json()
        assert corpo["resolvidos_hoje"]["total"] == 1
        assert corpo["resolvidos_hoje"]["media_resolucao_min"] is not None
