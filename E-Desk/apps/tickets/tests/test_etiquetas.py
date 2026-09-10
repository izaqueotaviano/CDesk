"""Etiquetas saindo do limbo: do CRUD órfão ao chamado etiquetado.

O `TicketTag` sempre existiu — model com M2M no chamado, serializer e um CRUD
inteiro em `settings/tags/` — mas nenhum outro ponto do sistema o lia: a fila
não mostrava, o detalhe não editava, o filtro não filtrava. Era um recurso
completo dos dois lados de uma porta que ninguém abriu.

Estes testes fixam a porta aberta: a triagem grava, a listagem carrega, o
filtro recorta e a mudança fica no histórico do chamado.
"""

import pytest

from apps.tickets.models import TicketTag
from apps.tickets.services import ticket_service
from apps.tickets.services.ticket_service import TicketRuleViolation

pytestmark = pytest.mark.django_db


@pytest.fixture
def urgente(db):
    return TicketTag.objects.create(name="Urgente de verdade", slug="urgente", color="#C0392B")


@pytest.fixture
def vip(db):
    return TicketTag.objects.create(name="Cliente VIP", slug="vip", color="#B58900")


class TestTriagem:
    def test_agente_etiqueta_pelo_patch(self, api, make_ticket, ana, suporte,
                                        agente_suporte, urgente, vip):
        ticket = make_ticket(ana, suporte)
        resp = api(agente_suporte).patch(
            f"/api/v1/tickets/{ticket.pk}/",
            {"tags": [urgente.pk, vip.pk]}, format="json",
        )
        assert resp.status_code == 200, resp.data
        assert {t["slug"] for t in resp.data["tags"]} == {"urgente", "vip"}

    def test_lista_substitui_e_vazia_limpa(self, make_ticket, ana, suporte,
                                           agente_suporte, urgente, vip):
        """Contrato de multi-select: o conjunto enviado É o conjunto final."""
        ticket = make_ticket(ana, suporte)
        ticket_service.reclassify(ticket=ticket, actor=agente_suporte,
                                  tags=[urgente, vip])
        ticket_service.reclassify(ticket=ticket, actor=agente_suporte, tags=[vip])
        assert list(ticket.tags.values_list("slug", flat=True)) == ["vip"]

        ticket_service.reclassify(ticket=ticket, actor=agente_suporte, tags=[])
        assert ticket.tags.count() == 0

    def test_ausente_nao_mexe(self, make_ticket, ana, suporte, agente_suporte, urgente):
        """Editar a urgência não pode apagar as etiquetas por efeito colateral."""
        ticket = make_ticket(ana, suporte)
        ticket_service.reclassify(ticket=ticket, actor=agente_suporte, tags=[urgente])
        ticket_service.reclassify(ticket=ticket, actor=agente_suporte, priority="high")
        assert ticket.tags.count() == 1

    def test_a_mudanca_fica_no_historico(self, make_ticket, ana, suporte,
                                         agente_suporte, urgente):
        ticket = make_ticket(ana, suporte)
        ticket_service.reclassify(ticket=ticket, actor=agente_suporte, tags=[urgente])
        evento = ticket.status_events.latest("id")
        assert "etiquetas" in evento.note
        assert "Urgente de verdade" in evento.note

    def test_cliente_nao_etiqueta(self, make_ticket, ana, suporte, urgente):
        ticket = make_ticket(ana, suporte)
        with pytest.raises(TicketRuleViolation):
            ticket_service.reclassify(ticket=ticket, actor=ana, tags=[urgente])


class TestFilaEFiltro:
    def test_a_fila_carrega_as_pilulas(self, api, make_ticket, ana, suporte,
                                       agente_suporte, urgente):
        ticket = make_ticket(ana, suporte)
        ticket.tags.add(urgente)
        linha = next(
            t for t in api(agente_suporte).get("/api/v1/tickets/").data["results"]
            if t["id"] == ticket.pk
        )
        assert linha["tags"] == [
            {"id": urgente.pk, "name": "Urgente de verdade",
             "slug": "urgente", "color": "#C0392B"}
        ]

    def test_filtro_por_etiqueta(self, api, make_ticket, ana, suporte,
                                 agente_suporte, urgente):
        com = make_ticket(ana, suporte)
        com.tags.add(urgente)
        make_ticket(ana, suporte)  # sem etiqueta

        resultado = api(agente_suporte).get("/api/v1/tickets/?tag=urgente").data
        assert [t["id"] for t in resultado["results"]] == [com.pk]
