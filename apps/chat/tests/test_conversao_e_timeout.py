"""Os DOIS pontos de integração com tickets: conversão manual (agente escolhe
a equipe) e automática (timeout de fila → "Chat não atendido")."""

import datetime as dt
import threading
import time

import pytest
from django.db import connection
from django.utils import timezone

from apps.chat.models import Chat, ChatMessage, ChatStatus
from apps.chat.services import chat_service
from apps.chat.tasks import convert_unattended_chats
from apps.notifications.models import Notification, NotificationKind, OutboundEmail
from apps.tickets.models import Ticket, TicketStatus
from apps.tickets.services import sla, ticket_service

pytestmark = pytest.mark.django_db(transaction=True)


class TestConversaoManual:
    def test_converte_fecha_o_chat_e_leva_a_transcricao(
        self, chat_da_ana, ana, agente, suporte,
    ):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="meu site caiu")
        chat_da_ana.name = "Site fora do ar"
        chat_da_ana.save(update_fields=["name"])

        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )

        chat_da_ana.refresh_from_db()
        assert chat_da_ana.status == ChatStatus.CLOSED  # fecha automaticamente
        assert ticket.subject == "Site fora do ar"       # nome interno vira assunto
        assert ticket.team == suporte                    # equipe escolhida na hora
        assert ticket.requester == ana
        assert "meu site caiu" in ticket.messages.first().body  # transcript

    def test_campos_de_atendimento_viajam_pro_ticket(
        self, chat_da_ana, agente, suporte,
    ):
        from apps.tickets.models import TicketCategory

        categoria = TicketCategory.objects.create(name="Dúvida", slug="duvida")
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        chat_da_ana.category = categoria
        chat_da_ana.priority = "high"
        chat_da_ana.save(update_fields=["category", "priority"])

        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        assert ticket.category == categoria
        assert ticket.priority == "high"
        assert ticket.assignee == agente  # sem responsável explícito: o agente

    def test_idempotente(self, chat_da_ana, agente, suporte):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        t1 = ticket_service.create_from_chat(chat=chat_da_ana, team=suporte, actor=agente)
        t2 = ticket_service.create_from_chat(chat=chat_da_ana, team=suporte, actor=agente)
        assert t1.pk == t2.pk

    def test_idempotente_sob_corrida_de_verdade(
        self, chat_da_ana, agente, agente2, suporte, monkeypatch,
    ):
        """`test_idempotente` acima é sequencial — a segunda chamada só
        começa depois que a primeira já commitou, o que a checagem de
        idempotência já resolvia mesmo sem lock nenhum. Este teste dispara
        as DUAS chamadas ao mesmo tempo, em threads com conexão própria:
        sem o `select_for_update` em `create_from_chat`, as duas passavam
        pela checagem de "já existe ticket?" antes de qualquer uma commitar,
        e a segunda estourava `IntegrityError` na constraint única de
        `origin_chat` em vez de devolver o ticket da primeira."""
        original_apply_sla = sla.apply_sla

        def _apply_sla_devagar(ticket):
            # segura a transação vencedora aberta um instante — tempo de
            # sobra pro SELECT FOR UPDATE da segunda thread bloquear de
            # verdade, em vez de só ter sorte no timing das duas threads
            time.sleep(0.3)
            return original_apply_sla(ticket)

        monkeypatch.setattr(sla, "apply_sla", _apply_sla_devagar)

        resultados: list[int] = []
        erros: list[Exception] = []
        largada = threading.Barrier(2)

        def _converter(actor):
            try:
                largada.wait(timeout=5)
                ticket = ticket_service.create_from_chat(
                    chat=chat_da_ana, team=suporte, actor=actor,
                )
                resultados.append(ticket.pk)
            except Exception as exc:  # noqa: BLE001 - a asserção abaixo cobra a causa exata
                erros.append(exc)
            finally:
                connection.close()

        threads = [
            threading.Thread(target=_converter, args=(agente,)),
            threading.Thread(target=_converter, args=(agente2,)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert not erros, f"conversão concorrente não deveria estourar exceção: {erros!r}"
        assert len(resultados) == 2
        assert resultados[0] == resultados[1]  # as duas chamadas devolvem o MESMO ticket
        assert Ticket.objects.filter(origin_chat=chat_da_ana).count() == 1

    def test_transcricao_sai_censurada(self, chat_da_ana, ana, agente, suporte):
        from apps.chat.models import BannedWord

        BannedWord.objects.create(word="porcaria")
        ChatMessage.objects.create(chat=chat_da_ana, author=ana,
                                   body="essa porcaria não funciona")
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        transcript = ticket.messages.first().body
        assert "porcaria" not in transcript
        assert "****" in transcript

    def test_espera_na_fila_conta_no_sla(self, chat_da_ana, agente, suporte):
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        assert ticket.created_at == chat_da_ana.queued_at  # backdate


class TestTimeout:
    def test_fila_esquecida_vira_ticket_chat_nao_atendido(
        self, chat_da_ana, suporte, config,
    ):
        config(queue_timeout_minutes=5, default_team=suporte)
        Chat.objects.filter(pk=chat_da_ana.pk).update(
            queued_at=timezone.now() - dt.timedelta(minutes=6)
        )

        convertidos = convert_unattended_chats()

        assert convertidos == 1
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.status == ChatStatus.CLOSED
        assert chat_da_ana.timeout_converted
        ticket = chat_da_ana.generated_ticket
        assert ticket.subject == "Chat não atendido"
        assert ticket.team == suporte           # equipe padrão do config
        assert ticket.assignee is None          # ninguém chegou a atender
        assert ticket.status == TicketStatus.NEW

    def test_dentro_do_prazo_nao_converte(self, chat_da_ana, suporte, config):
        config(queue_timeout_minutes=30, default_team=suporte)
        assert convert_unattended_chats() == 0
        chat_da_ana.refresh_from_db()
        assert chat_da_ana.status == ChatStatus.QUEUED

    def test_em_atendimento_nao_tem_timeout(self, chat_da_ana, agente, suporte, config):
        config(queue_timeout_minutes=5, default_team=suporte)
        chat_service.take_chat(chat=chat_da_ana, agent=agente)
        Chat.objects.filter(pk=chat_da_ana.pk).update(
            queued_at=timezone.now() - dt.timedelta(minutes=60)
        )
        assert convert_unattended_chats() == 0

    def test_reabrir_zera_o_relogio_do_timeout(
        self, chat_da_ana, ana, suporte, config,
    ):
        config(queue_timeout_minutes=5, default_team=suporte)
        chat_service.close_chat(chat=chat_da_ana, actor=ana)
        chat_service.rate(chat=chat_da_ana, client=ana,
                          service_score=8, resolution_score=8)
        Chat.objects.filter(pk=chat_da_ana.pk).update(
            closed_at=timezone.now(),
        )
        chat = chat_service.reopen(chat=chat_da_ana, actor=ana)
        # reaberto AGORA: não pode ser convertido por um queued_at antigo
        assert convert_unattended_chats() == 0
        chat.refresh_from_db()
        assert chat.status == ChatStatus.QUEUED


class TestNotificacaoDeConversao:
    """Divergência #8 do GAPS.md: o número do chamado só chegava por evento
    WebSocket transitório — se o cliente estivesse offline no instante
    exato (o caso mais provável: conversão automática por timeout), nunca
    ficava sabendo. Canal persistente: sino + e-mail, mesmo padrão dual de
    `_notify_requester_replied`."""

    def test_conversao_manual_notifica_o_cliente_com_o_numero(
        self, chat_da_ana, ana, agente, suporte,
    ):
        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        aviso = Notification.objects.get(
            recipient=ana, kind=NotificationKind.CHAT_CONVERTED, ticket=ticket,
        )
        assert ticket.reference in aviso.title
        assert aviso.url == f"/tickets/{ticket.pk}"

    def test_conversao_manual_enfileira_email(self, chat_da_ana, ana, agente, suporte):
        ticket = ticket_service.create_from_chat(
            chat=chat_da_ana, team=suporte, actor=agente,
        )
        email = OutboundEmail.objects.get(to_email=ana.email, template="chat_converted")
        assert ticket.reference in email.context["reference"]
        assert email.context["requester_name"] == ana.full_name

    def test_conversao_automatica_tambem_notifica(
        self, chat_da_ana, ana, suporte, config,
    ):
        """O caso que mais importa: NINGUÉM pegou o chat, o cliente
        provavelmente nem está mais na tela — é exatamente aqui que o
        evento WebSocket sozinho não bastava."""
        config(queue_timeout_minutes=5, default_team=suporte)
        Chat.objects.filter(pk=chat_da_ana.pk).update(
            queued_at=timezone.now() - dt.timedelta(minutes=6)
        )
        convert_unattended_chats()
        chat_da_ana.refresh_from_db()
        ticket = chat_da_ana.generated_ticket
        assert Notification.objects.filter(
            recipient=ana, kind=NotificationKind.CHAT_CONVERTED, ticket=ticket,
        ).exists()
        assert OutboundEmail.objects.filter(
            to_email=ana.email, template="chat_converted",
        ).exists()
