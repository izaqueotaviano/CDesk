"""Ordenação por coluna da fila (`?ordering=`) — cada clique de cabeçalho
vira um valor allowlistado, nunca o nome cru do campo."""

import datetime as dt

import pytest
from django.utils import timezone

from apps.tickets.models import TicketPriority
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


@pytest.fixture
def tres_tickets(make_ticket, ana, suporte):
    """Três chamados com prioridade e criação em ordens DIFERENTES entre si
    — o que prova que o `ordering` está de fato reordenando, e não só
    devolvendo a ordem natural do banco por coincidência."""
    baixa = make_ticket(ana, suporte, subject="Zebra baixa prioridade")
    baixa.priority = TicketPriority.LOW
    baixa.save(update_fields=["priority"])

    urgente = make_ticket(ana, suporte, subject="Alfa urgente")
    urgente.priority = TicketPriority.URGENT
    urgente.save(update_fields=["priority"])

    alta = make_ticket(ana, suporte, subject="Meio alta")
    alta.priority = TicketPriority.HIGH
    alta.save(update_fields=["priority"])

    return {"baixa": baixa, "urgente": urgente, "alta": alta}


class TestOrdenacao:
    def test_por_referencia_crescente(self, api, agente_suporte, tres_tickets):
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=reference")
        refs = [t["reference"] for t in resp.json()["results"]]
        assert refs == sorted(refs)

    def test_por_referencia_decrescente(self, api, agente_suporte, tres_tickets):
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=-reference")
        refs = [t["reference"] for t in resp.json()["results"]]
        assert refs == sorted(refs, reverse=True)

    def test_por_data_de_abertura_mais_recente_primeiro(self, api, agente_suporte, tres_tickets):
        """'Aberto em' com `-criado`: o mais recente aparece primeiro — é
        literalmente o pedido ("aparecer organizado pelos abertos na data e
        hora mais recente")."""
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=-criado")
        ids = [t["id"] for t in resp.json()["results"]]
        assert ids == [
            tres_tickets["alta"].id, tres_tickets["urgente"].id, tres_tickets["baixa"].id,
        ]

    def test_tempo_de_espera_ascendente_e_quem_espera_mais_primeiro(
        self, api, agente_suporte, tres_tickets,
    ):
        """'Tempo de espera' crescente = quem foi aberto há mais tempo primeiro
        — mesmo campo de 'aberto em', direção oposta por padrão."""
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=espera")
        ids = [t["id"] for t in resp.json()["results"]]
        assert ids == [
            tres_tickets["baixa"].id, tres_tickets["urgente"].id, tres_tickets["alta"].id,
        ]

    def test_urgencia_por_severidade_nao_alfabetica(self, api, agente_suporte, tres_tickets):
        """Alfabética daria Alta, Baixa, Normal, Urgente — inútil pra
        triagem. A ordem certa é a de gravidade: Baixa < Normal < Alta <
        Urgente."""
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=urgencia")
        prioridades = [t["priority"] for t in resp.json()["results"]]
        assert prioridades == ["low", "high", "urgent"]

    def test_urgencia_decrescente_mais_urgente_primeiro(self, api, agente_suporte, tres_tickets):
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=-urgencia")
        prioridades = [t["priority"] for t in resp.json()["results"]]
        assert prioridades == ["urgent", "high", "low"]

    def test_status_segue_a_ordem_do_quadro_nao_o_alfabeto(self, api, agente_suporte, tres_tickets):
        """`stage__order` é o mesmo campo que organiza as colunas do Kanban —
        reaproveitado aqui em vez de inventar outra ordenação de status."""
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=status")
        assert resp.status_code == 200  # não quebra; a ordem exata depende do stage de fábrica

    def test_valor_desconhecido_nao_quebra_e_cai_no_padrao(self, api, agente_suporte, tres_tickets):
        """`?ordering=lixo` (ou um campo fora da allowlist, tipo tentar
        ordenar por `password`) não pode virar 500 nem abrir a allowlist —
        só devolve a ordem padrão."""
        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=password")
        assert resp.status_code == 200
        assert resp.json()["count"] == 3


class TestOrdenacaoPorSla:
    """Achado de QA: a coluna SLA existia na tabela e não dava pra ordenar
    por ela — `ALLOWED_ORDERING` não tinha a chave."""

    def test_por_sla_crescente_prazo_mais_perto_primeiro(
        self, api, agente_suporte, tres_tickets,
    ):
        agora = timezone.now()
        tres_tickets["urgente"].sla_resolution_due_at = agora + dt.timedelta(hours=1)
        tres_tickets["urgente"].save(update_fields=["sla_resolution_due_at"])
        tres_tickets["alta"].sla_resolution_due_at = agora + dt.timedelta(hours=5)
        tres_tickets["alta"].save(update_fields=["sla_resolution_due_at"])
        # "baixa" fica sem sla_resolution_due_at (NULL) de propósito — é o
        # caso de "sem SLA" que precisa ir pro fim, não pro início.

        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=sla")
        ids = [t["id"] for t in resp.json()["results"]]
        assert ids == [
            tres_tickets["urgente"].id, tres_tickets["alta"].id, tres_tickets["baixa"].id,
        ]

    def test_por_sla_decrescente_mais_folgado_primeiro(self, api, agente_suporte, tres_tickets):
        agora = timezone.now()
        tres_tickets["urgente"].sla_resolution_due_at = agora + dt.timedelta(hours=1)
        tres_tickets["urgente"].save(update_fields=["sla_resolution_due_at"])
        tres_tickets["alta"].sla_resolution_due_at = agora + dt.timedelta(hours=5)
        tres_tickets["alta"].save(update_fields=["sla_resolution_due_at"])

        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=-sla")
        ids = [t["id"] for t in resp.json()["results"]]
        assert ids == [
            tres_tickets["baixa"].id, tres_tickets["alta"].id, tres_tickets["urgente"].id,
        ]


class TestJustificativa:
    def test_nota_da_ultima_troca_de_status_aparece_pro_interno(
        self, api, make_ticket, ana, suporte, agente_suporte,
    ):
        ticket = make_ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente_suporte, actor=agente_suporte)

        resp = api(agente_suporte).get("/api/v1/tickets/")
        linha = next(t for t in resp.json()["results"] if t["id"] == ticket.id)
        assert "atribuído a" in linha["current_status_note"]

    def test_nota_nunca_vaza_pro_cliente(self, api, make_ticket, ana, suporte, agente_suporte):
        """Mesma regra do histórico interno (`get_events`): quem atribuiu a
        quem é colaboração de dentro da casa, não informação do cliente."""
        ticket = make_ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente_suporte, actor=agente_suporte)

        resp = api(ana).get("/api/v1/tickets/")
        linha = next(t for t in resp.json()["results"] if t["id"] == ticket.id)
        assert linha["current_status_note"] is None
        assert "atribuído" not in resp.content.decode()

    def test_sem_nota_ainda_e_null_nao_string_vazia_nem_erro(
        self, api, make_ticket, ana, suporte, agente_suporte,
    ):
        make_ticket(ana, suporte)
        resp = api(agente_suporte).get("/api/v1/tickets/")
        assert resp.status_code == 200
        assert all(t["current_status_note"] is None for t in resp.json()["results"])

    def test_ordena_por_justificativa(self, api, make_ticket, ana, suporte, agente_suporte):
        ticket = make_ticket(ana, suporte)
        ticket_service.assign(ticket=ticket, assignee=agente_suporte, actor=agente_suporte)
        make_ticket(ana, suporte, subject="sem nota nenhuma")

        resp = api(agente_suporte).get("/api/v1/tickets/?ordering=justificativa")
        assert resp.status_code == 200
        # ascendente: NULL fica por último no Postgres (comportamento padrão
        # da coluna), então quem TEM nota aparece primeiro
        assert resp.json()["results"][0]["id"] == ticket.id
