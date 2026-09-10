"""Kanban: o quadro é uma vista sobre os tickets.

A mudança que estes testes protegem: **ninguém adiciona ticket ao quadro**. Ele
aparece na coluna do seu status, como aparece na fila — e todo status tem
coluna, para que o quadro não esconda trabalho. O que se grava é só o prazo
interno.

Do que já existia, três travas continuam valendo e continuam testadas:
D7 (coluna aplica status), o veto de fechar por arrasto (D4) e o escopo de
visibilidade (D1).
"""

import datetime as dt

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
from apps.notifications.models import Notification, NotificationKind
from apps.tickets.models import Ticket, TicketStage, TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------- #
# Cenário
# ---------------------------------------------------------------------- #

@pytest.fixture
def suporte(db):
    return Team.objects.create(name="Suporte", slug="suporte")


@pytest.fixture
def financeiro(db):
    return Team.objects.create(
        name="Financeiro", slug="financeiro",
        visibility=TeamVisibility.REQUESTER_ONLY,
    )


@pytest.fixture
def ana(db):
    plan = Plan.objects.create(slug="gold", name="Gold")
    company = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana@acme.test", full_name="Ana", kind=UserKind.CLIENT,
        company=company, client_role=ClientRole.MEMBER,
    )


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(suporte):
    user = User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )
    AgentTeam.objects.create(user=user, team=suporte)
    return user


@pytest.fixture
def board(admin, suporte):
    """Quadro do Suporte. As colunas não são dele: são os status do ticket."""
    return Board.objects.create(name="Semana", slug="semana", created_by=admin)


@pytest.fixture
def cols(db):
    """Os status de fábrica, por nome — as colunas do quadro."""
    from apps.tickets.models import TicketStage
    return {s.name: s for s in TicketStage.objects.all()}


@pytest.fixture
def ticket(ana, suporte):
    return ticket_service.create_ticket(
        requester=ana, team=suporte, subject="Bug X", body="corpo"
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def quadro(api_client, board):
    return api_client.get(f"/api/v1/kanban/boards/{board.pk}/cards/").json()


def coluna_de(payload, reference):
    entrada = next(e for e in payload["entries"] if e["ticket_reference"] == reference)
    return entrada["column"]


def place(api_client, board, ticket, stage):
    return api_client.post(
        f"/api/v1/kanban/boards/{board.pk}/place/",
        {"ticket_id": ticket.pk, "stage_id": stage.pk}, format="json",
    )


# ---------------------------------------------------------------------- #
# O quadro sai dos tickets
# ---------------------------------------------------------------------- #

class TestQuadroDerivado:
    def test_ticket_aparece_sem_ninguem_adicionar(self, api, agente, board, cols, ticket):
        """O pedido do negócio: o quadro puxa o mesmo que a fila."""
        payload = quadro(api(agente), board)

        assert len(payload["entries"]) == 1
        assert payload["entries"][0]["ticket"] == ticket.pk
        assert payload["entries"][0]["column"] == str(cols["Novo"].pk)
        assert Card.objects.count() == 0  # nada gravado para isso

    def test_mudar_o_status_muda_a_coluna(self, api, agente, board, cols, ticket):
        ticket_service.mover_para_stage(
            ticket=ticket, stage=cols["Aguardando retorno"],
            actor=agente, board=board,
        )
        assert coluna_de(quadro(api(agente), board), ticket.reference) == \
            str(cols["Aguardando retorno"].pk)

    def test_quadro_novo_ja_nasce_com_as_colunas_de_status(self, api, admin, agente):
        """As colunas não são do quadro: são os status do sistema.

        A de conclusão entra junto e vem marcada com `concludes` — ela é o
        DESTINO do arraste que fecha o chamado. Fica sempre vazia (o quadro é a
        fila dos não resolvidos), mas precisa existir: sem ela não havia onde
        soltar para concluir, e concluir pelo quadro era impossível.
        """
        resp = api(admin).post("/api/v1/kanban/boards/", {"name": "Novo"}, format="json")
        assert resp.status_code == 201

        payload = api(agente).get(
            f"/api/v1/kanban/boards/{resp.json()['id']}/cards/"
        ).json()
        assert [c["category"] for c in payload["columns"]] == \
            ["new", "open", "pending_customer", "closed"]
        assert [c["concludes"] for c in payload["columns"]] == \
            [False, False, False, True]

    def test_status_de_fabrica_nao_pode_ser_apagado(self, api, admin, cols, ticket):
        """Eles são o destino de resgate de todo status criado — e sumir com
        um deixaria os chamados daquela categoria sem coluna."""
        resp = api(admin).delete(f"/api/v1/settings/statuses/{cols['Novo'].pk}/")
        assert resp.status_code == 400
        assert TicketStage.objects.filter(pk=cols["Novo"].pk).exists()

    def test_apagar_um_status_criado_devolve_os_chamados_ao_de_fabrica(
        self, api, admin, agente, board, ticket
    ):
        """Nenhum chamado some ao apagar coluna: ele volta para o status de
        fábrica da MESMA categoria, então continua aberto se estava aberto."""
        analise = TicketStage.objects.create(
            slug="em-analise", name="Em análise", category="new", order=9
        )
        ticket.stage = analise
        ticket.save(update_fields=["stage"])

        assert api(admin).delete(
            f"/api/v1/settings/statuses/{analise.pk}/"
        ).status_code == 204

        ticket.refresh_from_db()
        assert ticket.stage.slug == "new"      # resgatado
        assert ticket.status == "new"          # e a categoria não mudou
        payload = quadro(api(agente), board)
        assert len(payload["entries"]) == 1    # continua à vista

    def test_quadro_de_equipe_recorta(self, api, admin, board, ticket,
                                            ana, financeiro, suporte):
        outro = ticket_service.create_ticket(
            requester=ana, team=financeiro, subject="Fatura", body="b"
        )
        assert len(quadro(api(admin), board)["entries"]) == 2

        board.team = suporte
        board.save(update_fields=["team"])
        refs = [e["ticket_reference"] for e in quadro(api(admin), board)["entries"]]
        assert refs == [ticket.reference]
        assert outro.reference not in refs


# ---------------------------------------------------------------------- #
# D7 e a trava do fechamento
# ---------------------------------------------------------------------- #

class TestStatus:
    def test_coluna_de_status_aplica_o_status(self, api, agente, board, cols, ticket):
        resp = place(api(agente), board, ticket, cols["Aberto"])
        assert resp.status_code == 200
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.status_events.latest("id").note == f"movido no quadro {board.name}"

    def test_arrastar_nunca_fecha_ticket(self, api, agente, board, cols, ticket):
        resp = place(api(agente), board, ticket, cols["Fechado"])

        assert resp.status_code == 409
        assert resp.json()["code"] == "close_dialog_required"
        ticket.refresh_from_db()
        assert ticket.status != TicketStatus.CLOSED

    def test_ticket_fechado_sai_do_quadro(self, api, agente, board, cols, ticket):
        """O quadro é a fila de não resolvidos: fechar é o único jeito de um
        chamado sair dele — e ele sai, como sai da fila."""
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        payload = quadro(api(agente), board)
        refs = [e["ticket_reference"] for e in payload["entries"]]
        assert ticket.reference not in refs
        # a coluna de conclusão permanece — ela é destino de arraste, não
        # depósito — e nenhuma ENTRADA fechada sobra nela
        conclusao = [c for c in payload["columns"] if c["concludes"]]
        assert conclusao
        chaves = {c["key"] for c in conclusao}
        assert all(e["column"] not in chaves for e in payload["entries"])


# ---------------------------------------------------------------------- #
# Prazo e proprietário
# ---------------------------------------------------------------------- #

class TestPrazoEProprietario:
    def test_proprietario_vai_para_o_ticket(self, api, agente, board, ticket, admin):
        resp = api(agente).patch(
            f"/api/v1/kanban/boards/{board.pk}/entry/{ticket.pk}/",
            {"owner_id": admin.pk}, format="json",
        )
        assert resp.status_code == 200
        ticket.refresh_from_db()
        assert ticket.owner == admin  # o dado mora no ticket
        assert resp.json()["entries"][0]["owner_name"] == "Alice"
        assert Card.objects.count() == 0  # owner não é do quadro: nada gravado aqui

    def test_proprietario_pelo_card_grava_historico_e_notifica(
        self, api, agente, board, ticket, admin,
    ):
        """Bug achado na investigação da Fase 4 (Administração): `entry()`
        fazia `ticket.owner = owner; ticket.save()` direto, sem passar por
        `ticket_service.set_owner()` — perdia o TicketStatusEvent e a
        notificação que a mesma ação já tem via `tickets/{id}/set-owner/`.
        Mesmo dado, dois caminhos (card do quadro vs. tela do Chamado); os
        dois precisam se comportar igual."""
        api(agente).patch(
            f"/api/v1/kanban/boards/{board.pk}/entry/{ticket.pk}/",
            {"owner_id": admin.pk}, format="json",
        )
        evento = ticket.status_events.latest("id")
        assert "dono técnico" in evento.note
        assert admin.full_name in evento.note
        assert Notification.objects.filter(
            recipient=admin, kind=NotificationKind.TICKET_OWNER_SET, ticket=ticket,
        ).exists()

    def test_proprietario_precisa_ser_interno(self, api, agente, board, ticket, ana):
        resp = api(agente).patch(
            f"/api/v1/kanban/boards/{board.pk}/entry/{ticket.pk}/",
            {"owner_id": ana.pk}, format="json",
        )
        assert resp.status_code == 400

    def test_prazo_cria_a_linha_e_tirar_o_prazo_a_remove(self, api, agente, board, ticket):
        url = f"/api/v1/kanban/boards/{board.pk}/entry/{ticket.pk}/"
        vencido = (timezone.now() - dt.timedelta(hours=2)).isoformat()

        resp = api(agente).patch(url, {"due_at": vencido}, format="json")
        assert resp.json()["entries"][0]["is_overdue"] is True
        assert Card.objects.count() == 1

        api(agente).patch(url, {"due_at": None}, format="json")
        assert Card.objects.count() == 0  # sem prazo e sem fixação, não sobra nada

    def test_prazo_vencido_alarma_enquanto_o_chamado_esta_aberto(
        self, api, agente, board, ticket
    ):
        url = f"/api/v1/kanban/boards/{board.pk}/entry/{ticket.pk}/"
        api(agente).patch(
            url, {"due_at": (timezone.now() - dt.timedelta(hours=2)).isoformat()},
            format="json",
        )
        entrada = quadro(api(agente), board)["entries"][0]
        assert entrada["is_overdue"] is True

        # fechado, o chamado sai do quadro — e o alarme com ele
        ticket_service.close_ticket(
            ticket=ticket, actor=agente,
            resolution_started_at=ticket.created_at,
            resolution_ended_at=timezone.now(),
        )
        assert quadro(api(agente), board)["entries"] == []


# ---------------------------------------------------------------------- #
# Escopo — o teste que não pode cair
# ---------------------------------------------------------------------- #

class TestVisibilidade:
    def test_agente_so_ve_a_propria_equipe(self, api, agente, admin, board,
                                                 ana, financeiro, ticket):
        ticket_service.create_ticket(
            requester=ana, team=financeiro, subject="Fatura", body="b"
        )
        assert len(quadro(api(agente), board)["entries"]) == 1
        assert len(quadro(api(admin), board)["entries"]) == 2

    def test_agente_nao_fixa_ticket_fora_do_escopo(self, api, agente, admin, board,
                                                   cols, ana, financeiro):
        alheio = ticket_service.create_ticket(
            requester=ana, team=financeiro, subject="Fatura", body="b"
        )
        resp = place(api(agente), board, alheio, cols["Aberto"])
        assert resp.status_code == 404  # fora do escopo: não existe

    def test_cliente_nao_entra(self, api, ana, board):
        assert api(ana).get("/api/v1/kanban/boards/").status_code == 403


# ---------------------------------------------------------------------- #
# Administração
# ---------------------------------------------------------------------- #

class TestAdministracao:
    def test_agente_nao_configura(self, api, agente, board, cols):
        assert api(agente).post("/api/v1/kanban/boards/", {"name": "x"},
                                format="json").status_code == 403
        assert api(agente).delete(
            f"/api/v1/settings/statuses/{cols['Novo'].pk}/"
        ).status_code == 403

    def test_apagar_quadro_nunca_toca_nos_tickets(self, api, admin, board, cols, ticket):
        place(api(admin), board, ticket, cols["Aberto"])
        assert api(admin).delete(f"/api/v1/kanban/boards/{board.pk}/").status_code == 204
        assert Card.objects.count() == 0
        assert Ticket.objects.filter(pk=ticket.pk).exists()  # intocado

    def test_slug_derivado_do_nome_e_unico(self, api, admin):
        primeiro = api(admin).post("/api/v1/kanban/boards/", {"name": "Fila do Suporte"},
                                   format="json").json()
        segundo = api(admin).post("/api/v1/kanban/boards/", {"name": "Fila do Suporte"},
                                  format="json").json()
        assert primeiro["slug"] == "fila-do-suporte"
        assert primeiro["slug"] != segundo["slug"]

    def test_renomear_a_coluna_e_renomear_o_status(self, api, admin, cols):
        col = cols["Novo"]
        resp = api(admin).patch(f"/api/v1/settings/statuses/{col.pk}/",
                                {"name": "Entrando"}, format="json")
        assert resp.status_code == 200
        col.refresh_from_db()
        assert (col.name, col.category) == ("Entrando", "new")

    def test_status_de_fabrica_nao_troca_de_categoria(self, api, admin, cols):
        """Trocar a categoria de "Fechado" mudaria de uma vez o que conta como
        resolvido em todo relatório já emitido."""
        col = cols["Novo"]
        resp = api(admin).patch(f"/api/v1/settings/statuses/{col.pk}/",
                                {"category": "open"}, format="json")
        assert resp.status_code == 400
        col.refresh_from_db()
        assert col.category == "new"  # nada mudou

    def test_criar_coluna_e_criar_um_status(self, api, admin, board, agente):
        resp = api(admin).post("/api/v1/settings/statuses/",
                               {"name": "Em análise", "category": "open"},
                               format="json")
        assert resp.status_code == 201
        assert resp.json()["slug"] == "em-analise"
        assert resp.json()["is_system"] is False

        # e a coluna nova aparece no quadro, na leitura seguinte
        nomes = [c["name"] for c in quadro(api(agente), board)["columns"]]
        assert "Em análise" in nomes

    def test_reordenar_colunas(self, api, admin, cols):
        a, b = cols["Novo"], cols["Aberto"]
        api(admin).patch(f"/api/v1/settings/statuses/{a.pk}/", {"order": 1}, format="json")
        api(admin).patch(f"/api/v1/settings/statuses/{b.pk}/", {"order": 0}, format="json")
        a.refresh_from_db()
        b.refresh_from_db()
        assert (a.order, b.order) == (1, 0)

    def test_apagar_lane_limpa_card_orfao_mas_preserva_o_que_ainda_guarda_prazo(
        self, api, admin, board, ticket, ana, suporte
    ):
        """Card só existe enquanto guarda prazo OU fixação (docstring do
        model). Apagar a lane solta a fixação (Card.lane é SET_NULL) — um
        Card que só tinha ISSO fica órfão, os dois campos vazios, e sem
        faxina sobrevivia andando à toa (achado testando a tela nova do
        Kanban ao vivo, ver GAPS.md). Um que também guarda prazo não pode
        sumir junto."""
        outro = ticket_service.create_ticket(
            requester=ana, team=suporte, subject="Bug Y", body="corpo"
        )
        lane = api(admin).post(
            "/api/v1/kanban/lanes/", {"board": board.pk, "name": "Depende do gestor"},
            format="json",
        ).json()
        for t in (ticket, outro):
            assert api(admin).post(
                f"/api/v1/kanban/boards/{board.pk}/place/",
                {"ticket_id": t.pk, "lane_id": lane["id"]}, format="json",
            ).status_code == 200
        # `outro` também guarda um prazo — não pode sumir quando a lane sumir
        prazo = timezone.now() + dt.timedelta(days=2)
        assert api(admin).patch(
            f"/api/v1/kanban/boards/{board.pk}/entry/{outro.pk}/",
            {"due_at": prazo.isoformat()}, format="json",
        ).status_code == 200

        assert api(admin).delete(f"/api/v1/kanban/lanes/{lane['id']}/").status_code == 204

        assert not Card.objects.filter(ticket=ticket).exists()  # órfão: some
        card_outro = Card.objects.get(ticket=outro)  # ainda guarda prazo: sobrevive
        assert card_outro.lane_id is None
        assert card_outro.due_at is not None


# ---------------------------------------------------------------------- #
# O dado que decide
# ---------------------------------------------------------------------- #

class TestSLANoQuadro:
    """O quadro é onde se escolhe o próximo chamado. Até aqui ele não trazia o
    relógio do SLA — o dado que decide essa escolha morava só na fila, na tela
    ao lado. O que estes testes seguram é que ele vem, e que vem do MESMO
    cálculo do serializer da listagem: dois cálculos de prazo seriam duas
    verdades, e a que estivesse errada seria justamente a do quadro."""

    def _entrada(self, api, board, ticket):
        payload = quadro(api, board)
        return next(
            e for e in payload["entries"] if e["ticket_reference"] == ticket.reference
        )

    def test_entrada_traz_os_dois_relogios(self, api, admin, board, ticket):
        entrada = self._entrada(api(admin), board, ticket)

        assert set(entrada["sla"]) == {"first_response", "resolution"}
        for relogio in entrada["sla"].values():
            assert set(relogio) == {"due_at", "state", "minutes_left"}

    def test_prazo_de_resolucao_vencido_chega_como_estourado(
        self, api, admin, board, ticket,
    ):
        ticket.sla_resolution_due_at = timezone.now() - dt.timedelta(hours=3)
        ticket.sla_resolution_breached = True
        ticket.save(update_fields=["sla_resolution_due_at", "sla_resolution_breached"])

        entrada = self._entrada(api(admin), board, ticket)
        assert entrada["sla"]["resolution"]["state"] == "breached"
        assert entrada["sla"]["resolution"]["minutes_left"] < 0

    def test_sem_politica_de_sla_o_relogio_nao_inventa_prazo(
        self, api, admin, board, ticket,
    ):
        """Ticket importado não tem SLA. O quadro tem de dizer 'não há', e não
        um prazo calculado do nada — foi por isso que a importação deixou os
        campos vazios de propósito."""
        ticket.sla_resolution_due_at = None
        ticket.sla_first_response_due_at = None
        ticket.save(update_fields=["sla_resolution_due_at", "sla_first_response_due_at"])

        entrada = self._entrada(api(admin), board, ticket)
        assert entrada["sla"]["resolution"]["state"] == "none"
        assert entrada["sla"]["resolution"]["due_at"] is None

    def test_o_quadro_concorda_com_a_fila(self, api, admin, board, ticket):
        """Mesmo ticket, duas telas: o estado tem de ser o mesmo nas duas."""
        ticket.sla_resolution_due_at = timezone.now() + dt.timedelta(minutes=30)
        ticket.save(update_fields=["sla_resolution_due_at"])

        no_quadro = self._entrada(api(admin), board, ticket)["sla"]
        na_fila = next(
            t for t in api(admin).get("/api/v1/tickets/").json()["results"]
            if t["reference"] == ticket.reference
        )["sla"]

        assert no_quadro["resolution"]["state"] == na_fila["resolution"]["state"]
        assert no_quadro["first_response"]["state"] == na_fila["first_response"]["state"]
