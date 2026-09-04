"""Rodada de correções da auditoria do módulo de tickets.

Cobre: o PATCH de triagem (urgência/categoria/equipe/responsável), a
reabertura pelo AGENTE, a pausa do SLA em "aguardando o cliente", o veredito
de SLA no fechamento, o cliente notificado na resposta pública (com a
preferência valendo) e o savepoint do outbox que não pode envenenar a
transação do chamador.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.accounts.models import Team
from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationPreference,
    OutboundEmail,
)
from apps.tickets.models import TicketCategory, TicketPriority, TicketStatus
from apps.tickets.services import ticket_service

pytestmark = pytest.mark.django_db


def _fechar(ticket, agente):
    return ticket_service.close_ticket(
        ticket=ticket, actor=agente,
        resolution_started_at=ticket.created_at,
        resolution_ended_at=timezone.now(),
    )


class TestTriagem:
    def test_patch_muda_urgencia_categoria_e_equipe(self, api, admin, ana, suporte,
                                                    financeiro, make_ticket):
        cat = TicketCategory.objects.create(name="Impressora", slug="impressora")
        ticket = make_ticket(ana, suporte)
        resp = api(admin).patch(f"/api/v1/tickets/{ticket.pk}/", {
            "priority": "urgent", "category": cat.pk, "team": financeiro.pk,
        }, format="json")
        assert resp.status_code == 200
        ticket.refresh_from_db()
        assert ticket.priority == TicketPriority.URGENT
        assert ticket.category_id == cat.pk
        assert ticket.team_id == financeiro.pk
        # a triagem fica no histórico
        evento = ticket.status_events.latest("created_at")
        assert "urgência" in evento.note and "equipe" in evento.note

    def test_patch_do_kanban_por_prioridade_e_responsavel(self, api, admin, ana,
                                                          suporte, agente_suporte,
                                                          make_ticket):
        """Os payloads exatos que o quadro manda ao arrastar."""
        ticket = make_ticket(ana, suporte)
        assert api(admin).patch(
            f"/api/v1/tickets/{ticket.pk}/", {"priority": "high"}, format="json"
        ).status_code == 200
        assert api(admin).patch(
            f"/api/v1/tickets/{ticket.pk}/", {"assignee": agente_suporte.pk},
            format="json",
        ).status_code == 200
        ticket.refresh_from_db()
        assert ticket.priority == TicketPriority.HIGH
        assert ticket.assignee_id == agente_suporte.pk
        # e soltar em "sem responsável"
        assert api(admin).patch(
            f"/api/v1/tickets/{ticket.pk}/", {"assignee": None}, format="json"
        ).status_code == 200
        ticket.refresh_from_db()
        assert ticket.assignee_id is None

    def test_cliente_nao_reclassifica(self, api, ana, suporte, make_ticket):
        ticket = make_ticket(ana, suporte)
        resp = api(ana).patch(
            f"/api/v1/tickets/{ticket.pk}/", {"priority": "urgent"}, format="json"
        )
        assert resp.status_code == 403

    def test_equipe_interna_nao_recebe_chamado_de_cliente(self, api, admin, ana,
                                                          suporte, make_ticket):
        interna = Team.objects.create(name="TI Interna", slug="ti", internal_only=True)
        ticket = make_ticket(ana, suporte)
        resp = api(admin).patch(
            f"/api/v1/tickets/{ticket.pk}/", {"team": interna.pk}, format="json"
        )
        assert resp.status_code == 400
        ticket.refresh_from_db()
        assert ticket.team_id == suporte.pk


class TestReaberturaPeloAgente:
    def test_responder_fechado_reabre_de_verdade(self, ana, suporte, agente_suporte,
                                                 make_ticket):
        """O caminho do agente passa pela MESMA reabertura do cliente: ciclo
        novo, closed_* limpos, evento marcado — antes voltava 'aberto' com
        data de fechamento preenchida e prazo vencido."""
        ticket = make_ticket(ana, suporte)
        _fechar(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.CLOSED

        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="reabrindo pra revisar",
            new_status=TicketStatus.OPEN,
        )
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.closed_at is None and ticket.closed_by is None
        assert ticket.sla_cycle == 2
        assert ticket.reopen_count == 1
        evento = ticket.status_events.filter(is_reopen=True).latest("created_at")
        assert evento.is_automatic is False  # foi decisão do agente


class TestPausaDeSLA:
    def test_aguardando_cliente_pausa_e_retomar_empurra_o_prazo(
            self, ana, suporte, agente_suporte, make_ticket):
        ticket = make_ticket(ana, suporte)
        # dá um prazo de resolução artificial pra observar o empurrão
        devido = timezone.now() + dt.timedelta(hours=4)
        type(ticket).objects.filter(pk=ticket.pk).update(sla_resolution_due_at=devido)
        ticket.refresh_from_db()

        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="aguardo seu retorno",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        ticket.refresh_from_db()
        assert ticket.sla_paused_at is not None

        # simula 2h de espera do cliente
        type(ticket).objects.filter(pk=ticket.pk).update(
            sla_paused_at=timezone.now() - dt.timedelta(hours=2)
        )
        ticket.refresh_from_db()
        ticket_service.add_reply(ticket=ticket, author=ana, body="voltei")
        ticket.refresh_from_db()
        assert ticket.status == TicketStatus.OPEN
        assert ticket.sla_paused_at is None
        # o prazo ganhou (aproximadamente) as 2h que a bola ficou com o cliente
        empurrao = ticket.sla_resolution_due_at - devido
        assert dt.timedelta(hours=1, minutes=55) < empurrao < dt.timedelta(hours=2, minutes=5)


class TestVereditoNoFechamento:
    def test_fechar_atrasado_marca_o_estouro(self, ana, suporte, agente_suporte,
                                             make_ticket):
        """Sem depender da varredura de 5 min: fechou depois do prazo, a
        marca sai no próprio fechamento."""
        ticket = make_ticket(ana, suporte)
        type(ticket).objects.filter(pk=ticket.pk).update(
            sla_resolution_due_at=timezone.now() - dt.timedelta(hours=1)
        )
        ticket.refresh_from_db()
        _fechar(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.sla_resolution_breached is True

    def test_fechar_no_prazo_nao_marca(self, ana, suporte, agente_suporte, make_ticket):
        ticket = make_ticket(ana, suporte)
        type(ticket).objects.filter(pk=ticket.pk).update(
            sla_resolution_due_at=timezone.now() + dt.timedelta(hours=1)
        )
        ticket.refresh_from_db()
        _fechar(ticket, agente_suporte)
        ticket.refresh_from_db()
        assert ticket.sla_resolution_breached is False


class TestClienteAvisado:
    def test_resposta_publica_avisa_o_cliente(self, ana, suporte, agente_suporte,
                                              make_ticket):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="resolvido assim",
            new_status=TicketStatus.OPEN,
        )
        aviso = Notification.objects.filter(
            recipient=ana, kind=NotificationKind.TICKET_REPLIED, ticket=ticket
        )
        assert aviso.exists()
        email = OutboundEmail.objects.filter(
            to_email=ana.email, template="ticket_replied"
        ).first()
        assert email is not None
        # conteúdo do chamado NÃO viaja no e-mail — só a referência e o convite
        assert "resolvido assim" not in str(email.context)

    def test_nota_interna_nao_avisa_o_cliente(self, ana, suporte, agente_suporte,
                                              make_ticket):
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="nota", is_public=False,
        )
        assert not Notification.objects.filter(
            recipient=ana, kind=NotificationKind.TICKET_REPLIED
        ).exists()

    def test_preferencia_desligada_desliga_de_verdade(self, ana, suporte,
                                                      agente_suporte, make_ticket):
        NotificationPreference.objects.create(
            user=ana,
            in_app={"ticket_replied": False},
            email={"ticket_replied": False},
        )
        ticket = make_ticket(ana, suporte)
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="oi",
            new_status=TicketStatus.OPEN,
        )
        assert not Notification.objects.filter(
            recipient=ana, kind=NotificationKind.TICKET_REPLIED
        ).exists()
        assert not OutboundEmail.objects.filter(template="ticket_replied").exists()


class TestOutboxNaoEnvenenaTransacao:
    def test_dedupe_colidindo_nao_desfaz_o_resto(self, ana, suporte, agente_suporte,
                                                 make_ticket):
        """Regressão do bug achado ao vivo: IntegrityError do dedupe capturado
        SEM savepoint próprio marcava a transação do chamador para rollback e
        o Django desfazia tudo em silêncio — a resposta sumia junto."""
        ticket = make_ticket(ana, suporte)
        # duas respostas no MESMO minuto → mesmo dedupe_key do e-mail
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="primeira",
            new_status=TicketStatus.OPEN,
        )
        ticket_service.add_reply(
            ticket=ticket, author=agente_suporte, body="segunda",
            new_status=TicketStatus.PENDING_CUSTOMER,
        )
        ticket.refresh_from_db()
        # a segunda resposta E a transição sobreviveram à colisão do dedupe
        assert ticket.status == TicketStatus.PENDING_CUSTOMER
        assert ticket.messages.filter(body="segunda").exists()
