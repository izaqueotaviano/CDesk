"""Máquina de estados e operações de negócio sobre tickets.

Toda mudança de status passa por aqui e grava `TicketStatusEvent` — nunca se
escreve `ticket.status` fora deste módulo. Transições (docs/02 §máquina):

| Evento                     | De               | Para                                  |
|----------------------------|------------------|---------------------------------------|
| Cliente cria               | —                | NEW                                   |
| Agente responde (pública)  | qualquer aberta  | escolhido: OPEN / PENDING / CLOSED    |
| Cliente responde           | PENDING_CUSTOMER | OPEN (automático)                     |
| Cliente responde           | CLOSED           | OPEN + reabertura (automático)        |
| Cliente responde           | NEW / OPEN       | mantém                                |
| Agente fecha               | qualquer         | CLOSED (exige resolution_*, D4)       |

Reabertura NÃO consome cota (P6: cota é consumida na criação; reabrir não cria
ticket). D5: first_response_at nunca é reescrito; sla_cycle avança.
"""

from __future__ import annotations

import datetime as dt
import logging

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import Team
from apps.accounts.rbac import Perm
from apps.customers.services import quota as quota_service
from apps.tickets.models import (
    MessageSource,
    ScheduledReply,
    ScheduledReplyStatus,
    Ticket,
    TicketMessage,
    TicketSource,
    TicketStage,
    TicketStatus,
    TicketStatusEvent,
)
from apps.tickets.services import mentions, sla
from apps.tickets.services.references import next_reference

logger = logging.getLogger(__name__)


class TicketRuleViolation(Exception):
    """Regra de negócio violada — a view converte em resposta 4xx."""


def create_ticket(
    *,
    requester,
    team: Team,
    subject: str,
    body: str,
    priority: str = "normal",
    category=None,
    order_number: str = "",
    actor=None,
    with_signature: bool = False,
) -> Ticket:
    """Cria o ticket com a primeira mensagem, consumindo cota quando devido.

    `actor` é quem executa: o próprio cliente (source=WEB, consome cota) ou um
    interno abrindo em nome do cliente (source=INTERNAL, isento — F-C).
    """
    actor = actor or requester
    if not team.is_active:
        raise TicketRuleViolation("Equipe inativa.")
    if requester.is_internal:
        raise TicketRuleViolation("O solicitante deve ser um usuário cliente.")
    # o seletor já não oferece, mas o id chega pelo corpo da requisição: quem
    # decide isso é o serviço, não a tela
    if team.internal_only and not actor.is_internal:
        raise TicketRuleViolation("Equipe interna: abertura só por agente.")

    # Agente abre em nome do cliente só nas equipes que ATENDE. Sem isto,
    # um agente de Suporte abre chamado numa equipe restrita (Financeiro)
    # que nem enxerga depois — escrita fora do próprio escopo de visibilidade.
    # Admin não tem recorte de equipe; o próprio cliente não passa aqui.
    if actor.is_internal and not actor.is_admin:
        atende = actor.team_links.filter(team_id=team.pk).exists()
        if not atende:
            raise TicketRuleViolation(
                "Você não atende esta equipe; a abertura fica com quem atende."
            )

    source = TicketSource.INTERNAL if actor.is_internal else TicketSource.WEB

    with transaction.atomic():
        ticket = Ticket.objects.create(
            reference=next_reference(),
            company=requester.company,
            requester=requester,
            team=team,
            subject=subject,
            order_number=order_number.strip(),
            priority=priority,
            category=category,
            source=source,
            status=TicketStatus.NEW,
            stage=stage_padrao(TicketStatus.NEW),
        )
        TicketStatusEvent.objects.create(
            ticket=ticket, from_status=None, to_status=TicketStatus.NEW, changed_by=actor
        )
        TicketMessage.objects.create(
            ticket=ticket, author=actor, body=body, is_public=True,
            # agente abrindo em nome do cliente assina; o cliente não tem
            # assinatura para pôr
            with_signature=bool(with_signature) and actor.is_internal,
        )
        if source == TicketSource.WEB:
            # levanta QuotaExceeded e desfaz tudo se o período está cheio
            quota_service.check_and_consume(ticket=ticket, actor=requester)
        ticket.last_customer_message_at = timezone.now()
        ticket.save(update_fields=["last_customer_message_at"])

        sla.apply_sla(ticket)
        _email_support_about_new_ticket(ticket)
        _email_requester_about_new_ticket(ticket)
        # o aviso in-app sai DEPOIS do commit: ele empurra pelo WebSocket, e
        # empurrar de dentro da transação avisaria de um chamado que a cota
        # ainda pode desfazer
        transaction.on_commit(lambda: _notify_team_about_new_ticket(ticket.pk, actor.pk))
    return ticket


def _notify_team_about_new_ticket(ticket_pk, actor_pk) -> None:
    """Avisa quem ATENDE a equipe que entrou chamado novo.

    Até aqui um ticket novo só produzia e-mail para a caixa do suporte. Quem
    está com o sistema aberto (ou noutra aba do navegador) não ficava sabendo
    de nada — e é justamente essa pessoa que vai atender. O aviso vai pelo
    canal pessoal, o mesmo que o sino usa, então o navegador consegue avisar
    com a aba em segundo plano.

    Vai para os agentes da equipe, nunca para quem abriu: um interno que abre
    em nome do cliente não precisa ser avisado do próprio chamado.
    """
    from apps.accounts.models import AgentTeam, User
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, ticket_url

    try:
        ticket = Ticket.objects.select_related("team", "requester", "company").get(
            pk=ticket_pk
        )
        destinatarios = (
            User.objects.filter(
                pk__in=AgentTeam.objects.filter(team_id=ticket.team_id).values("user_id"),
                is_active=True,
            )
            .exclude(pk=actor_pk)
        )
        for agente in destinatarios:
            notify(
                recipient=agente,
                kind=NotificationKind.TICKET_CREATED,
                title=f"Novo chamado {ticket.reference}",
                body=f"{ticket.company.name} · {ticket.subject}",
                url=ticket_url(ticket, agente),
                ticket=ticket,
            )
    except Exception:  # noqa: BLE001 — aviso não derruba a abertura já commitada
        logger.exception("Falha ao avisar a equipe do ticket novo %s", ticket_pk)


def _email_support_about_new_ticket(ticket: Ticket) -> None:
    """E-mail informativo para o suporte (requisito 8): apenas aviso, sem
    resposta por e-mail. A equipe pode ter endereço próprio."""
    from django.conf import settings

    from apps.notifications.services import queue_email

    to = ticket.team.notification_email or settings.SUPPORT_NOTIFICATION_EMAIL
    queue_email(
        to=to,
        subject=f"[{ticket.reference}] Novo ticket: {ticket.subject}",
        template="new_ticket",
        context={
            "reference": ticket.reference,
            "requester": ticket.requester.full_name,
            "company": ticket.company.name,
            "team": ticket.team.name,
            "subject": ticket.subject,
        },
        ticket=ticket,
        dedupe_key=f"new-ticket-{ticket.pk}",
    )


def _portal_link(caminho: str) -> str:
    """Endereço absoluto no Painel do Cliente — e-mail precisa de link inteiro."""
    from django.conf import settings

    return f"{settings.SITE_URL}{caminho}"


def _email_requester_about_new_ticket(ticket: Ticket) -> None:
    """Confirmação de abertura para o CLIENTE.

    A regra do portal é avisar por e-mail da abertura ao encerramento; até
    aqui o cliente só recebia e-mail de resposta. Sai sob TICKET_CREATED —
    o mesmo tipo que avisa a equipe in-app —, porque do lado do cliente
    esse tipo significa exatamente "meu chamado foi aberto", e é o que ele
    liga ou desliga em Configurações. Só e-mail: aviso in-app do próprio
    chamado seria ruído (ele acabou de abrir).
    """
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import quer_email, queue_email

    requester = ticket.requester
    if requester is None or requester.is_internal or not requester.email:
        return
    if not quer_email(requester, NotificationKind.TICKET_CREATED):
        return
    queue_email(
        to=requester.email,
        subject=f"Recebemos seu chamado {ticket.reference}",
        template="ticket_opened",
        context={
            "requester_name": requester.full_name,
            "reference": ticket.reference,
            "subject": ticket.subject,
            "team": ticket.team.name,
            "link": _portal_link(f"/portal/tickets/{ticket.pk}"),
        },
        ticket=ticket,
        dedupe_key=f"ticket-opened-{ticket.pk}",
    )


def _notify_requester_closed(ticket_pk, *, automatic: bool) -> None:
    """Avisa o CLIENTE que o chamado terminou — resolvido pelo suporte ou
    fechado por falta de retorno.

    Roda DEPOIS do commit, pelo mesmo motivo da pesquisa de satisfação: um
    aviso de fechamento que depois é desfeito é pior que aviso nenhum. Os
    dois desfechos saem sob TICKET_CLOSED (um interruptor só em
    Configurações: "encerramento de chamado"), cada canal respeitando a
    própria preferência. O texto muda: resolvido convida a avaliar e lembra
    que responder reabre; fechado automaticamente orienta a abrir outro
    (fechamento automático não reabre — ver `auto_close_stale_pending`).
    """
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email, ticket_url

    try:
        ticket = Ticket.objects.select_related("requester").get(pk=ticket_pk)
        requester = ticket.requester
        if requester is None or requester.is_internal:
            return
        if automatic:
            titulo = f"Chamado {ticket.reference} encerrado por falta de retorno"
            corpo = (
                "Ficou aguardando seu retorno além do prazo. "
                "Precisa de ajuda? Abra um novo chamado."
            )
            template = "ticket_auto_closed"
        else:
            titulo = f"Seu chamado {ticket.reference} foi resolvido"
            corpo = "Se puder, avalie o atendimento. Responder ao chamado reabre."
            template = "ticket_resolved"
        notify(
            recipient=requester,
            kind=NotificationKind.TICKET_CLOSED,
            title=titulo,
            body=corpo,
            url=ticket_url(ticket, requester),
            ticket=ticket,
        )
        if requester.email and quer_email(requester, NotificationKind.TICKET_CLOSED):
            marca = f"{ticket.closed_at:%Y%m%d%H%M%S}" if ticket.closed_at else "sem-data"
            queue_email(
                to=requester.email,
                subject=titulo,
                template=template,
                context={
                    "requester_name": requester.full_name,
                    "reference": ticket.reference,
                    "subject": ticket.subject,
                    "link": _portal_link(f"/portal/tickets/{ticket.pk}"),
                },
                ticket=ticket,
                # reaberto e fechado de novo é outro desfecho: outro e-mail
                dedupe_key=f"ticket-closed-{ticket.pk}-{marca}",
            )
    except Exception:  # noqa: BLE001 — aviso não derruba o fechamento já commitado
        logger.exception("Falha ao avisar o cliente do fechamento do ticket %s", ticket_pk)


def create_from_chat(*, chat, team, actor=None, subject=None, auto=False):
    """Conversão chat→ticket — um dos DOIS pontos de integração do chat v2.

    Cobre as duas saídas: a MANUAL (agente converte a qualquer momento e
    escolhe a equipe) e a AUTOMÁTICA (timeout de fila — ninguém pegou,
    vira "Chat não atendido" na equipe padrão, `auto=True`).

    Regras:
    - Idempotente: chat já convertido devolve o ticket existente.
    - O chat FECHA junto (spec: converter fecha automaticamente) — e chat
      fechado por conversão não cobra avaliação do cliente.
    - Não consome cota (mesma regra F-A do chat antigo).
    - `created_at` retrocede para `queued_at`: a espera na fila conta no
      SLA — senão a primeira resposta sairia negativa.
    - `first_response_at` = primeira mensagem de agente no chat: o canal
      não muda a métrica.
    - UMA TicketMessage com a transcrição CENSURADA (o filtro de palavrões
      vale nos dois lados, e a transcrição é exibição como qualquer outra);
      as ChatMessage seguem sendo a fonte granular via `origin_chat`.
    - Campos de atendimento preenchidos no chat (categoria, urgência,
      responsável, etiquetas) viajam para o ticket.
    - Manual com agente: nasce OPEN atribuído; automática: nasce NEW, sem
      responsável — ninguém chegou a atender.
    """
    from apps.chat.models import Chat as _Chat
    from apps.chat.models import ChatMessage as _ChatMsg
    from apps.chat.models import ChatStatus as _ChatStatus
    from apps.chat.services import chat_service as _chat_svc

    with transaction.atomic():
        # Lock a linha do chat: o timeout automático do beat rodando junto
        # com um clique manual do agente (ou um retry/duplo clique) não pode
        # deixar as duas chamadas passarem pela checagem de idempotência ao
        # mesmo tempo. Sem o lock, as duas veem `generated_ticket` vazio e as
        # duas tentam criar — a segunda estoura `IntegrityError` na
        # constraint única de `origin_chat` em vez de devolver o ticket que a
        # primeira já criou. Mesmo padrão de `select_for_update` que
        # `chat_service.take_chat` usa para "pegar" um chat da fila.
        chat = _Chat.objects.select_for_update().get(pk=chat.pk)
        existing = getattr(chat, "generated_ticket", None)
        if existing is not None:
            return existing

        # mesma regra da criação normal: equipe interna não recebe chamado de
        # cliente — o ticket sumiria da visão do próprio solicitante
        if team.internal_only:
            raise TicketRuleViolation(
                "Equipe interna não pode receber a conversão de um chat de cliente."
            )

        if chat.status != _ChatStatus.CLOSED:
            chat.status = _ChatStatus.CLOSED
            chat.closed_at = timezone.now()
            chat.closed_by = actor
            chat.timeout_converted = auto
            chat.save(update_fields=[
                "status", "closed_at", "closed_by", "timeout_converted", "updated_at",
            ])
            _ChatMsg.objects.create(
                chat=chat, is_system=True, body="Chat convertido em ticket.",
            )

        assignee = None if auto else (chat.assignee or chat.agent)
        ticket = Ticket.objects.create(
            reference=next_reference(),
            company=chat.company,
            requester=chat.client,
            team=team,
            subject=subject or chat.name
            or f"Chat de {chat.queued_at:%d/%m/%Y} — {chat.client.full_name}",
            source=TicketSource.CHAT,
            status=TicketStatus.NEW,
            stage=stage_padrao(TicketStatus.NEW),
            origin_chat=chat,
            assignee=assignee,
            priority=chat.priority,
            category=chat.category,
        )
        etiquetas = list(chat.tags.all())
        if etiquetas:
            ticket.tags.add(*etiquetas)
        # backdate: auto_now_add ignora valor no create
        Ticket.objects.filter(pk=ticket.pk).update(created_at=chat.queued_at)
        ticket.refresh_from_db()

        TicketStatusEvent.objects.create(
            ticket=ticket, from_status=None, to_status=TicketStatus.NEW,
            is_automatic=True,
            note="chat não atendido (timeout)" if auto else "conversão de chat",
        )
        TicketMessage.objects.create(
            ticket=ticket,
            author=None,  # sistema
            body=_render_transcript(chat),
            is_public=True,
            source=MessageSource.CHAT,
        )

        update = []
        mensagens_cliente = chat.messages.filter(is_system=False, author=chat.client)
        if mensagens_cliente.exists():
            ticket.last_customer_message_at = mensagens_cliente.last().sent_at
            update.append("last_customer_message_at")
        primeira_interna = (
            chat.messages.filter(is_system=False, author__kind="internal")
            .order_by("id").first()
        )
        if primeira_interna:
            ticket.first_response_at = primeira_interna.sent_at
            ticket.last_agent_message_at = (
                chat.messages.filter(is_system=False, author__kind="internal")
                .last().sent_at
            )
            update += ["first_response_at", "last_agent_message_at"]
        if update:
            ticket.save(update_fields=update)

        sla.apply_sla(ticket)

        if not auto and assignee is not None:
            _change_status(ticket, TicketStatus.OPEN, actor,
                           automatic=True, note="convertido do chat em atendimento")

    # quem ainda está com a conversa aberta vê o link do ticket na hora —
    # mas isso é TRANSITÓRIO (só alcança quem está conectado neste
    # instante). A notificação abaixo é o canal PERSISTENTE, pro caso mais
    # provável de acontecer aqui: conversão automática por timeout, cliente
    # tipicamente ausente (Divergência #8 do GAPS.md).
    _chat_svc._sala(chat.pk, {
        "type": "chat.converted",
        "ticket_id": ticket.pk,
        "ticket_reference": ticket.reference,
    })
    _notify_chat_converted(ticket=ticket, client=chat.client, actor=actor)
    return ticket


def _notify_chat_converted(*, ticket, client, actor) -> None:
    """Entrega persistente do número do chamado ao cliente — sino do
    portal e e-mail, mesmo padrão dual-canal de `_notify_requester_replied`
    (cada canal respeitando a preferência da conta). Resolve a
    Divergência #8 do GAPS.md: antes disso, o único aviso era o evento
    WebSocket transitório logo acima, que não alcança quem está offline —
    justamente o caso mais comum de acontecer aqui (conversão automática
    por timeout de fila, ninguém pegou o chat)."""
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email, ticket_url

    if client is None or client.is_internal:
        return
    notify(
        recipient=client,
        kind=NotificationKind.CHAT_CONVERTED,
        title=f"Sua conversa virou o chamado {ticket.reference}",
        body=ticket.subject,
        url=ticket_url(ticket, client),
        ticket=ticket,
        actor=actor,
    )
    if client.email and quer_email(client, NotificationKind.CHAT_CONVERTED):
        queue_email(
            to=client.email,
            subject=f"Sua conversa virou o chamado {ticket.reference}",
            template="chat_converted",
            context={
                "requester_name": client.full_name,
                "reference": ticket.reference,
                "subject": ticket.subject,
            },
            ticket=ticket,
            # um chat só converte uma vez (idempotente logo no topo da
            # função) — chave por ticket é suficiente, nunca duplica
            dedupe_key=f"chat_converted:{ticket.pk}",
        )


def _render_transcript(chat) -> str:
    """Transcrição legível — já CENSURADA (a lista de moderação vale para o
    que o ticket exibe tanto quanto para a tela do chat)."""
    from apps.chat.services.chat_service import censor

    fim = chat.closed_at or timezone.now()
    lines = [f"Transcrição do chat #{chat.pk} — "
             f"{chat.queued_at:%d/%m/%Y %H:%M} a {fim:%H:%M}"]
    for msg in chat.messages.order_by("id"):
        stamp = f"{msg.sent_at:%H:%M}"
        if msg.is_system:
            lines.append(f"[{stamp}] — {msg.body}")
        else:
            author = msg.author.full_name if msg.author else "Sistema"
            lines.append(f"[{stamp}] {author}: {censor(msg.body)}")
        nomes = [f.filename for f in msg.files.all()]
        if nomes:
            lines.append(f"        (anexos: {', '.join(nomes)})")
    return "\n".join(lines)


# status que um agente pode escolher ao responder publicamente
_AGENT_REPLY_STATUSES = {TicketStatus.OPEN, TicketStatus.PENDING_CUSTOMER, TicketStatus.CLOSED}


def add_reply(
    *,
    ticket: Ticket,
    author,
    body: str,
    is_public: bool = True,
    new_status: str | None = None,
    resolution_started_at: dt.datetime | None = None,
    resolution_ended_at: dt.datetime | None = None,
    close_note: str = "",
    with_signature: bool = False,
) -> TicketMessage:
    """Adiciona resposta e aplica a transição de status correspondente.

    Agente em resposta pública ESCOLHE o novo status (obrigatório). Se escolher
    CLOSED, os campos de resolução (D4) são exigidos na mesma chamada — e
    `close_note` é a justificativa do fechamento, a mesma que o endpoint
    `close/` recebe. Responder-e-fechar é UMA chamada: dividir em duas deixaria
    a resposta gravada e o ticket aberto se a segunda falhasse.
    Cliente nunca escolhe status: as transições são automáticas.
    """
    if not ticket.can_reply(author):
        raise TicketRuleViolation("Sem permissão para responder este ticket.")

    # nota interna é conceito de agente. `is_public` é campo de autorização, não
    # preferência de quem escreve: um cliente mandando is_public=false criaria
    # uma mensagem que some da própria thread dele mas fica visível ao suporte.
    # Quem não é interno sempre fala em público.
    if not author.is_internal:
        is_public = True

    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        now = timezone.now()

        message = TicketMessage.objects.create(
            ticket=ticket,
            author=author,
            body=body,
            is_public=is_public,
            source=MessageSource.WEB,
            # nota interna nunca leva assinatura, mesmo se a tela pedir
            with_signature=bool(with_signature) and is_public and author.is_internal,
        )

        if author.is_internal:
            # menção só existe em nota interna; o serviço devolve vazio para
            # resposta pública, e é ele quem segura a regra (ver mentions.py)
            mentions.registrar_mencoes(message=message, author=author)
            if not is_public:
                # nota interna: não muda status nem conta como primeira resposta.
                # É o único caminho de escrita do AGENTE LEVE — por isso a
                # checagem de permissão fica na resposta PÚBLICA, abaixo, e
                # não na entrada da função.
                if not author.can(Perm.TICKET_ADD_INTERNAL_NOTE):
                    raise TicketRuleViolation(
                        "Seu papel não permite comentar neste ticket."
                    )
                return message

            # Daqui para baixo a mensagem vai para o CLIENTE. A transação já
            # está aberta e a mensagem já foi criada — a exceção desfaz tudo,
            # que é o comportamento certo: um agente leve que tentou responder
            # publicamente não deve deixar rastro de mensagem nenhuma.
            if not ticket.can_reply_publicly(author):
                raise TicketRuleViolation(
                    "Seu papel não permite responder ao cliente. "
                    "Use uma nota interna."
                )

            if new_status not in _AGENT_REPLY_STATUSES:
                raise TicketRuleViolation(
                    "Ao responder, o agente escolhe o novo status: "
                    "open, pending_customer ou closed."
                )
            if ticket.first_response_at is None:
                ticket.first_response_at = now
                message.is_first_response = True
                message.save(update_fields=["is_first_response"])
            ticket.last_agent_message_at = now
            ticket.save(update_fields=["first_response_at", "last_agent_message_at"])

            if new_status == TicketStatus.CLOSED:
                close_ticket(
                    ticket=ticket,
                    actor=author,
                    resolution_started_at=resolution_started_at,
                    resolution_ended_at=resolution_ended_at,
                    note=close_note,
                    _locked=True,
                )
            elif ticket.status == TicketStatus.CLOSED:
                # agente reabrindo passa pela MESMA reabertura do cliente:
                # ciclo novo de SLA, closed_* limpos, contador e evento de
                # reabertura. Antes caía no _change_status genérico e voltava
                # "aberto" com prazo vencido e data de fechamento preenchida.
                _reopen(ticket, author, now, automatic=False)
                if new_status != TicketStatus.OPEN:
                    _change_status(ticket, new_status, author)
            elif new_status != ticket.status:
                _change_status(ticket, new_status, author)
            # o CLIENTE fica sabendo que respondemos — in-app e e-mail. Antes
            # ele só descobria entrando no portal por conta própria.
            _notify_requester_replied(ticket, author, com_assinatura=message.with_signature)
            return message

        # ---- resposta de cliente: transições automáticas ----
        ticket.last_customer_message_at = now
        ticket.save(update_fields=["last_customer_message_at"])

        if ticket.status == TicketStatus.PENDING_CUSTOMER:
            _change_status(ticket, TicketStatus.OPEN, author, automatic=True)
            _notify_assignee_replied(ticket, author)
        elif ticket.status == TicketStatus.CLOSED:
            if ticket.auto_closed:
                # R: fechamento automático não reabre por resposta — o cliente
                # abre um novo chamado. A mensagem de fechamento já avisa isso;
                # aqui é a garantia de que a resposta tardia não reabre sozinha.
                raise TicketRuleViolation(
                    "Este chamado foi encerrado automaticamente por falta de "
                    "resposta e não pode mais ser reaberto. Abra um novo chamado "
                    "para continuar."
                )
            # Regra do portal: antes de reabrir, a nota. Só para quem PODE
            # avaliar (o solicitante); o responsável da empresa respondendo
            # pelo colega não tem pesquisa para responder, e travá-lo aqui
            # seria um beco sem saída.
            survey = getattr(ticket, "survey", None)
            pendente = (survey is not None and not survey.is_answered
                        and not survey.is_expired)
            if author.pk == ticket.requester_id and pendente:
                raise TicketRuleViolation(
                    "Avalie o atendimento antes de reabrir o chamado — leva "
                    "menos de um minuto."
                )
            _reopen(ticket, author, now)
        else:  # NEW/OPEN: mantém status, mas o agente fica sabendo
            _notify_assignee_replied(ticket, author)
        return message


def assign(*, ticket: Ticket, assignee, actor) -> Ticket:
    """Atribui o ticket a um agente, com notificação in-app e e-mail
    (requisito 8) — o agente pode estar de fora do sistema quando o
    ticket cai nele."""
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import (
        broadcast_ticket_event,
        notify,
        quer_email,
        queue_email,
        ticket_url,
    )

    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos atribuem tickets.")
    if not actor.can(Perm.TICKET_EDIT_PROPERTIES):
        raise TicketRuleViolation("Seu papel não permite alterar o responsável.")
    if assignee is not None and not assignee.is_internal:
        raise TicketRuleViolation("Responsável deve ser um usuário interno.")
    # Duas perguntas diferentes: quem ATRIBUI precisa poder editar o ticket
    # (acima); quem RECEBE precisa poder ser responsável. É esta segunda que
    # barra atribuir um ticket a um agente leve — de fora, pela API ou pelo
    # kanban, a tentativa é a mesma e cai aqui.
    if assignee is not None and not assignee.can(Perm.TICKET_BE_ASSIGNED):
        raise TicketRuleViolation(
            f"{assignee.full_name} tem um papel que não pode ser responsável por tickets."
        )

    previous = ticket.assignee_id
    ticket.assignee = assignee
    ticket.save(update_fields=["assignee"])
    TicketStatusEvent.objects.create(
        ticket=ticket, from_status=ticket.status, to_status=ticket.status,
        changed_by=actor, note=f"atribuído a {assignee.full_name if assignee else '—'}",
    )
    if assignee and assignee.pk not in (previous, actor.pk):
        titulo = f"Ticket atribuído a você: {ticket.reference}"
        url = ticket_url(ticket, assignee)
        notify(
            recipient=assignee,
            kind=NotificationKind.TICKET_ASSIGNED,
            title=titulo,
            body=ticket.subject,
            url=url,
            ticket=ticket,
            actor=actor,
        )
        if assignee.email and quer_email(assignee, NotificationKind.TICKET_ASSIGNED):
            from django.conf import settings

            queue_email(
                to=assignee.email,
                subject=titulo,
                template="ticket_assigned",
                context={
                    "agent_name": assignee.full_name,
                    "reference": ticket.reference,
                    "subject": ticket.subject,
                    "link": f"{settings.SITE_URL}{url}",
                },
                ticket=ticket,
                dedupe_key=f"ticket-assigned:{ticket.pk}:{assignee.pk}:{timezone.now():%Y%m%d%H%M}",
            )
    broadcast_ticket_event(ticket=ticket, kind="assigned", actor=actor)
    return ticket


def set_owner(*, ticket: Ticket, owner, actor) -> Ticket:
    """Define o "dono técnico" — quem responde pela ENTREGA da solução,
    separado de `assignee` (quem está respondendo o cliente agora).

    docs/05-fluxos-complexos.md §3.2: "owner pode ser diferente do agente
    que está no chat" — ex.: o atendimento é de A (`assignee=A`), mas quem
    corrige é B do time técnico (`owner=B`). Mesmo desenho de `assign()`
    (histórico + notificação in-app), campo próprio pra não confundir os
    dois papéis na tela nem no histórico.
    """
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import (
        broadcast_ticket_event,
        notify,
        quer_email,
        queue_email,
        ticket_url,
    )

    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos definem o dono técnico.")
    if not actor.can(Perm.TICKET_EDIT_PROPERTIES):
        raise TicketRuleViolation("Seu papel não permite alterar o dono técnico.")
    if owner is not None and not owner.is_internal:
        raise TicketRuleViolation("Dono técnico deve ser um usuário interno.")
    # Mesma permissão de `assign`: os dois criam evento no histórico e
    # notificam a pessoa, então os dois são atribuição. Ver o comentário de
    # `Perm.TICKET_BE_ASSIGNED` para como separá-los se um dia for preciso.
    if owner is not None and not owner.can(Perm.TICKET_BE_ASSIGNED):
        raise TicketRuleViolation(
            f"{owner.full_name} tem um papel que não pode ser responsável por tickets."
        )

    previous = ticket.owner_id
    ticket.owner = owner
    ticket.save(update_fields=["owner"])
    TicketStatusEvent.objects.create(
        ticket=ticket, from_status=ticket.status, to_status=ticket.status,
        changed_by=actor, note=f"dono técnico → {owner.full_name if owner else '—'}",
    )
    if owner and owner.pk not in (previous, actor.pk):
        titulo = f"Você é o dono técnico de {ticket.reference}"
        url = ticket_url(ticket, owner)
        notify(
            recipient=owner,
            kind=NotificationKind.TICKET_OWNER_SET,
            title=titulo,
            body=ticket.subject,
            url=url,
            ticket=ticket,
            actor=actor,
        )
        if owner.email and quer_email(owner, NotificationKind.TICKET_OWNER_SET):
            from django.conf import settings

            queue_email(
                to=owner.email,
                subject=titulo,
                template="ticket_owner_set",
                context={
                    "agent_name": owner.full_name,
                    "reference": ticket.reference,
                    "subject": ticket.subject,
                    "link": f"{settings.SITE_URL}{url}",
                },
                ticket=ticket,
                dedupe_key=f"ticket-owner-set:{ticket.pk}:{owner.pk}:{timezone.now():%Y%m%d%H%M}",
            )
    broadcast_ticket_event(ticket=ticket, kind="owner", actor=actor)
    return ticket


_NAO_INFORMADO = object()  # sentinela: distingue "não mexer" de "limpar"


def reclassify(*, ticket: Ticket, actor, priority=None, category=_NAO_INFORMADO,
               team=None, tags=None) -> Ticket:
    """Triagem de um chamado já aberto: urgência, categoria, equipe e etiquetas.

    Era o buraco da operação — a fila ordena por urgência e categoria, o
    kanban agrupa por prioridade, e nada disso era editável depois da
    abertura. `category` usa sentinela porque "sem categoria" é um valor
    válido (limpar), diferente de "não mexer".
    """
    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos reclassificam tickets.")
    if not actor.can(Perm.TICKET_EDIT_PROPERTIES):
        raise TicketRuleViolation("Seu papel não permite editar as propriedades do ticket.")
    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        mudancas: list[str] = []
        campos: list[str] = []

        if priority is not None and priority != ticket.priority:
            ticket.priority = priority
            mudancas.append(f"prioridade → {ticket.get_priority_display()}")
            campos.append("priority")

        if category is not _NAO_INFORMADO and category != ticket.category:
            ticket.category = category
            mudancas.append(f"categoria → {category.name if category else '—'}")
            campos.append("category")

        if team is not None and team.pk != ticket.team_id:
            # mesma regra da criação: equipe interna não recebe chamado de
            # cliente — o ticket sumiria da visão do próprio solicitante
            if not ticket.requester.is_internal and team.internal_only:
                raise TicketRuleViolation(
                    "Equipe interna não pode receber chamado de cliente."
                )
            ticket.team = team
            mudancas.append(f"equipe → {team.name}")
            campos.append("team")

        # etiquetas: `None` = não mexer; lista (vazia inclusive) SUBSTITUI o
        # conjunto — é o contrato de um multi-select, e "tirar todas" é um
        # valor legítimo
        if tags is not None:
            atuais = set(ticket.tags.values_list("pk", flat=True))
            novas = {tag.pk for tag in tags}
            if novas != atuais:
                ticket.tags.set(tags)
                rotulo = ", ".join(sorted(t.name for t in tags)) or "—"
                mudancas.append(f"etiquetas → {rotulo}")

        if not campos and not mudancas:
            return ticket
        if campos:
            ticket.save(update_fields=campos)
        TicketStatusEvent.objects.create(
            ticket=ticket, from_status=ticket.status, to_status=ticket.status,
            changed_by=actor, note="; ".join(mudancas)[:200],
        )
    from apps.notifications.services import broadcast_ticket_event

    broadcast_ticket_event(ticket=ticket, kind="updated", actor=actor)
    return ticket


def apply_macro(*, ticket: Ticket, macro, actor) -> Ticket:
    """Macro de triagem com um clique: categoria/urgência/responsável/
    etiquetas prontos. Espelha `chat_service.apply_macro` (mesma decisão
    do Izaque, replicada aqui via `TicketMacro` — Fase 3 do prompt de
    integração, GAPS.md) — soma, não zera: campo vazio na macro deixa em
    paz o que o agente já preencheu. `macro.body` (o texto pronto) NÃO
    entra aqui: pré-preencher o composer é decisão do front, sem ida ao
    servidor — só os campos de negócio (categoria/urgência/responsável/
    etiquetas) precisam de escrita real.

    Etiquetas da macro SOMAM às existentes (`.add()`), diferente de
    `reclassify()` (`.set()`, substitui o conjunto inteiro) — mesma escolha
    do chat: aplicar uma macro depois de já ter marcado uma etiqueta não
    pode apagar a etiqueta que o agente pôs na mão.
    """
    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos aplicam macro.")
    # Macro grava categoria/urgência/responsável/etiquetas — é edição de
    # propriedade com outro nome, e por isso pede a mesma permissão.
    if not actor.can(Perm.TICKET_EDIT_PROPERTIES):
        raise TicketRuleViolation("Seu papel não permite aplicar macros neste ticket.")
    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        mudancas: list[str] = []
        campos: list[str] = []

        if macro.category_id and macro.category_id != ticket.category_id:
            ticket.category_id = macro.category_id
            campos.append("category")
            mudancas.append(f"categoria → {macro.category.name}")
        if macro.priority and macro.priority != ticket.priority:
            ticket.priority = macro.priority
            campos.append("priority")
            mudancas.append(f"prioridade → {ticket.get_priority_display()}")
        if macro.assignee_id and macro.assignee_id != ticket.assignee_id:
            ticket.assignee_id = macro.assignee_id
            campos.append("assignee")
            mudancas.append(f"responsável → {macro.assignee.full_name}")
        if campos:
            ticket.save(update_fields=campos)

        novas = [t for t in macro.tags.all() if t.pk not in
                 set(ticket.tags.values_list("pk", flat=True))]
        if novas:
            ticket.tags.add(*novas)
            mudancas.append(f"etiquetas + {', '.join(sorted(t.name for t in novas))}")

        if mudancas:
            nota = f"aplicou macro «{macro.name}»: " + "; ".join(mudancas)[:150]
            TicketStatusEvent.objects.create(
                ticket=ticket, from_status=ticket.status, to_status=ticket.status,
                changed_by=actor, note=nota,
            )
    from apps.notifications.services import broadcast_ticket_event

    broadcast_ticket_event(ticket=ticket, kind="updated", actor=actor)
    return ticket


def _notify_requester_replied(ticket: Ticket, author, *, com_assinatura: bool = False) -> None:
    """Resposta pública de agente avisa o SOLICITANTE — sino do portal e
    e-mail (cada canal respeitando a preferência da conta). O corpo da
    resposta NÃO vai no e-mail: conteúdo de chamado restrito não pode parar
    em caixa de entrada; o e-mail convida a abrir o portal.

    A ASSINATURA de quem respondeu vai — quando a pessoa pediu para incluí-la
    no envio. Ela não é conteúdo do chamado: é o rodapé de identidade de quem
    escreveu, e é justamente no e-mail que ela se parece com o que o nome
    promete (`apps/accounts/assinatura.py`)."""
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email, ticket_url

    requester = ticket.requester
    if requester is None or requester.is_internal or requester.pk == author.pk:
        return
    notify(
        recipient=requester,
        kind=NotificationKind.TICKET_REPLIED,
        title=f"Seu chamado {ticket.reference} foi respondido",
        body=ticket.subject,
        url=ticket_url(ticket, requester),
        ticket=ticket,
        actor=author,
    )
    if requester.email and quer_email(requester, NotificationKind.TICKET_REPLIED):
        from django.conf import settings

        from apps.accounts import assinatura as assinatura_do_agente

        texto = assinatura_do_agente.render_texto(author) if com_assinatura else ""
        html = (
            assinatura_do_agente.render_html(author, base_url=settings.SITE_URL)
            if com_assinatura
            else ""
        )
        queue_email(
            to=requester.email,
            subject=f"Resposta no chamado {ticket.reference}",
            template="ticket_replied",
            context={
                "requester_name": requester.full_name,
                "reference": ticket.reference,
                "subject": ticket.subject,
                "agent_name": author.full_name,
                # `assinatura` entra no molde de texto; `assinatura_html` é
                # retirado do contexto pelo envio e vira a parte rica do
                # e-mail (ver apps/notifications/tasks.py)
                "assinatura": f"\n{texto}\n" if texto else "",
                "assinatura_html": html,
            },
            ticket=ticket,
            # uma resposta = um e-mail; várias na mesma hora não viram rajada
            dedupe_key=f"replied:{ticket.pk}:{timezone.now():%Y%m%d%H%M}",
        )


def _notify_assignee_replied(ticket: Ticket, author) -> None:
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, ticket_url

    if ticket.assignee is None:
        return
    notify(
        recipient=ticket.assignee,
        kind=NotificationKind.TICKET_REPLIED,
        title=f"{author.full_name} respondeu {ticket.reference}",
        body=ticket.subject,
        url=ticket_url(ticket, ticket.assignee),
        ticket=ticket,
        actor=author,
    )


def close_ticket(
    *,
    ticket: Ticket,
    actor,
    resolution_started_at: dt.datetime | None,
    resolution_ended_at: dt.datetime | None,
    note: str = "",
    _locked: bool = False,
) -> Ticket:
    """Fecha o ticket registrando o trabalho técnico real (D4).

    Início/término da solução são obrigatórios e validados:
    created_at <= início <= término <= agora.
    """
    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos fecham tickets.")
    if not actor.can(Perm.TICKET_CLOSE):
        raise TicketRuleViolation("Seu papel não permite fechar tickets.")
    if resolution_started_at is None or resolution_ended_at is None:
        raise TicketRuleViolation(
            "Fechar exige data de início e de término da solução (D4)."
        )

    with transaction.atomic():
        if not _locked:
            ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        if ticket.status == TicketStatus.CLOSED:
            raise TicketRuleViolation("Ticket já está fechado.")

        now = timezone.now()
        # Compara no MINUTO, não no instante. Quem informa esses campos é um
        # <input type="datetime-local">, que não tem casa de segundos: um ticket
        # criado às 17:35:35 só pode ser descrito como "17:35", e comparar com o
        # instante cru reprovava o próprio valor sugerido pela tela — o
        # fechamento ficava impossível por 35 centésimos de minuto.
        if resolution_started_at < ticket.created_at.replace(second=0, microsecond=0):
            raise TicketRuleViolation("Início da solução anterior à criação do ticket.")
        if resolution_ended_at < resolution_started_at:
            raise TicketRuleViolation("Término da solução anterior ao início.")
        if resolution_ended_at > now + dt.timedelta(minutes=1):
            raise TicketRuleViolation("Término da solução no futuro.")

        ticket.resolution_started_at = resolution_started_at
        ticket.resolution_ended_at = resolution_ended_at
        ticket.closed_at = now
        ticket.closed_by = actor
        ticket.save(update_fields=[
            "resolution_started_at", "resolution_ended_at", "closed_at", "closed_by",
        ])
        _change_status(ticket, TicketStatus.CLOSED, actor, note=note)
        # o veredito do SLA sai AQUI, não só na varredura de 5 min: fechado
        # com atraso na janela entre dois scans ficava "no prazo" pra sempre
        # (o scan só olha ticket aberto). O _change_status acima já devolveu
        # ao prazo o tempo pausado em "aguardando o cliente".
        marcas = []
        if (ticket.sla_resolution_due_at is not None
                and not ticket.sla_resolution_breached
                and now > ticket.sla_resolution_due_at):
            ticket.sla_resolution_breached = True
            marcas.append("sla_resolution_breached")
        if (ticket.first_response_at is None
                and ticket.sla_first_response_due_at is not None
                and not ticket.sla_first_response_breached
                and now > ticket.sla_first_response_due_at):
            ticket.sla_first_response_breached = True
            marcas.append("sla_first_response_breached")
        if marcas:
            ticket.save(update_fields=marcas)
        # depois do commit: uma pesquisa criada dentro da transação sobreviveria
        # a um fechamento desfeito, e cobraria nota de um chamado ainda aberto
        transaction.on_commit(lambda: _open_satisfaction_survey(ticket.pk))
        # idem para a franquia de horas: a soma tem de enxergar ESTE
        # fechamento já commitado, senão o mês fecha um chamado atrasado
        transaction.on_commit(lambda: _check_maintenance_overage(ticket.pk, actor.pk))
        transaction.on_commit(lambda: _notify_requester_closed(ticket.pk, automatic=False))
    from apps.notifications.services import broadcast_ticket_event

    broadcast_ticket_event(ticket=ticket, kind="closed", actor=actor)
    return ticket


def close_ticket_by_requester(*, ticket: Ticket, actor, note: str = "") -> Ticket:
    """O CLIENTE encerra o próprio chamado.

    Espelha `close_ticket`, mas SEM `resolution_started_at`/`resolution_ended_at`
    (D4): esse registro descreve o trabalho técnico de quem atendeu, e não faz
    sentido pedir isso de quem só está dizendo "pode fechar, resolvido pra
    mim". Mesmo efeito colateral do fechamento do agente (pesquisa de
    satisfação, franquia de manutenção, aviso ao solicitante) — só o QUEM
    fecha e o QUE se registra mudam.
    """
    if not ticket.can_close_as_requester(actor):
        raise TicketRuleViolation("Só quem abre o chamado (ou o titular da empresa) pode encerrá-lo.")

    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        if ticket.status == TicketStatus.CLOSED:
            raise TicketRuleViolation("Ticket já está fechado.")

        now = timezone.now()
        ticket.closed_at = now
        ticket.closed_by = actor
        ticket.save(update_fields=["closed_at", "closed_by"])
        _change_status(ticket, TicketStatus.CLOSED, actor, note=note)

        marcas = []
        if (ticket.sla_resolution_due_at is not None
                and not ticket.sla_resolution_breached
                and now > ticket.sla_resolution_due_at):
            ticket.sla_resolution_breached = True
            marcas.append("sla_resolution_breached")
        if (ticket.first_response_at is None
                and ticket.sla_first_response_due_at is not None
                and not ticket.sla_first_response_breached
                and now > ticket.sla_first_response_due_at):
            ticket.sla_first_response_breached = True
            marcas.append("sla_first_response_breached")
        if marcas:
            ticket.save(update_fields=marcas)
        transaction.on_commit(lambda: _open_satisfaction_survey(ticket.pk))
        transaction.on_commit(lambda: _check_maintenance_overage(ticket.pk, actor.pk))
        transaction.on_commit(lambda: _notify_requester_closed(ticket.pk, automatic=False))
    from apps.notifications.services import broadcast_ticket_event

    broadcast_ticket_event(ticket=ticket, kind="closed", actor=actor)
    return ticket


# ---------------------------------------------------------------------- #
# Resposta agendada — escrita agora, disparada sozinha na hora marcada
# ---------------------------------------------------------------------- #

def schedule_reply(
    *,
    ticket: Ticket,
    actor,
    body: str,
    scheduled_at: dt.datetime,
    is_public: bool = True,
    new_status: str | None = None,
    resolution_started_at: dt.datetime | None = None,
    resolution_ended_at: dt.datetime | None = None,
    close_note: str = "",
    with_signature: bool = False,
) -> ScheduledReply:
    """Agenda uma resposta — só quem já poderia responder AGORA
    (`can_reply`/`can_reply_publicly`) pode agendar para depois; o disparo
    (`tasks.dispatch_scheduled_replies`) chama `add_reply` com os mesmos
    parâmetros, então validar aqui é evitar um agendamento que o disparo
    rejeitaria sozinho, sem ninguém olhando, horas depois.
    """
    if not actor.is_internal:
        raise TicketRuleViolation("Agendar resposta é ação da equipe.")
    if not ticket.can_reply(actor):
        raise TicketRuleViolation("Sem permissão para responder este ticket.")
    if not (body or "").strip():
        raise TicketRuleViolation("Escreva o texto da resposta.")
    if scheduled_at <= timezone.now():
        raise TicketRuleViolation("A data e hora precisam estar no futuro.")

    if is_public:
        if not ticket.can_reply_publicly(actor):
            raise TicketRuleViolation(
                "Seu papel não permite responder ao cliente. Use uma nota interna."
            )
        if new_status not in _AGENT_REPLY_STATUSES:
            raise TicketRuleViolation(
                "Escolha o status que o ticket assume ao enviar: "
                "open, pending_customer ou closed."
            )
        if new_status == TicketStatus.CLOSED and (
            resolution_started_at is None or resolution_ended_at is None
        ):
            raise TicketRuleViolation(
                "Fechar ao enviar exige data de início e de término da solução (D4)."
            )
    else:
        new_status = ""

    return ScheduledReply.objects.create(
        ticket=ticket, author=actor, body=body.strip(), is_public=is_public,
        new_status=new_status or "", resolution_started_at=resolution_started_at,
        resolution_ended_at=resolution_ended_at, close_note=close_note,
        with_signature=with_signature, scheduled_at=scheduled_at,
    )


def cancel_scheduled_reply(*, scheduled: ScheduledReply, actor) -> ScheduledReply:
    """Desiste de um agendamento antes da hora — só o autor, e só enquanto
    pendente (já enviada/falhada/cancelada não volta atrás)."""
    if actor.pk != scheduled.author_id:
        raise TicketRuleViolation("Só quem agendou pode cancelar.")
    if scheduled.status != ScheduledReplyStatus.PENDING:
        raise TicketRuleViolation("Este agendamento não está mais pendente.")
    scheduled.status = ScheduledReplyStatus.CANCELLED
    scheduled.save(update_fields=["status", "updated_at"])
    return scheduled


def dispatch_scheduled_replies() -> int:
    """Dispara as respostas agendadas cuja hora já chegou.

    Mesmo padrão de `auto_close_stale_pending`: pega só os ids pendentes e
    vencidos, tranca linha a linha (`select_for_update`) dentro da própria
    transação e REVALIDA o status depois do lock — o agente pode ter
    cancelado entre a seleção e o lock, e a corrida não pode mandar uma
    resposta que acabou de ser desistida.
    """
    agora = timezone.now()
    alvos = list(
        ScheduledReply.objects.filter(
            status=ScheduledReplyStatus.PENDING, scheduled_at__lte=agora,
        ).values_list("pk", flat=True)
    )

    enviadas = 0
    for pk in alvos:
        with transaction.atomic():
            agendada = ScheduledReply.objects.select_for_update().select_related(
                "ticket", "author"
            ).get(pk=pk)
            if agendada.status != ScheduledReplyStatus.PENDING:
                continue  # cancelada (ou já processada) entre a seleção e o lock
            try:
                mensagem = add_reply(
                    ticket=agendada.ticket, author=agendada.author, body=agendada.body,
                    is_public=agendada.is_public,
                    new_status=agendada.new_status or None,
                    resolution_started_at=agendada.resolution_started_at,
                    resolution_ended_at=agendada.resolution_ended_at,
                    close_note=agendada.close_note,
                    with_signature=agendada.with_signature,
                )
            except TicketRuleViolation as exc:
                # o ticket pode ter fechado/mudado de dono desde o agendamento —
                # FAILED, não silencioso: quem agendou precisa ver que não saiu
                agendada.status = ScheduledReplyStatus.FAILED
                agendada.error = str(exc)
                agendada.save(update_fields=["status", "error", "updated_at"])
                logger.warning(
                    "Resposta agendada #%s não pôde ser enviada: %s", agendada.pk, exc
                )
                continue
            agendada.status = ScheduledReplyStatus.SENT
            agendada.sent_at = agora
            agendada.message = mensagem
            agendada.save(update_fields=["status", "sent_at", "message", "updated_at"])
        enviadas += 1
    return enviadas


def _check_maintenance_overage(ticket_pk, actor_pk):
    """Franquia de manutenção esgotada? Abre o chamado para o Comercial.

    Como a pesquisa de satisfação: falha aqui não derruba o fechamento, que já
    está commitado. Um aviso comercial que não saiu é problema; um chamado que
    não fechou porque o aviso falhou seria pior.
    """
    from apps.accounts.models import User
    from apps.customers.services import maintenance

    try:
        ticket = Ticket.objects.select_related("company__plan").get(pk=ticket_pk)
        maintenance.ensure_overage_ticket(
            ticket.company, actor=User.objects.get(pk=actor_pk)
        )
    except Exception:  # noqa: BLE001 — acessório não derruba o principal
        logger.exception("Falha ao checar franquia de manutenção do ticket %s", ticket_pk)


def _open_satisfaction_survey(ticket_pk):
    """Abre a pesquisa de satisfação do ticket recém-fechado.

    Falha aqui não pode derrubar o fechamento, que já está commitado: o ticket
    fechado é o dado importante, a pesquisa é acessório.
    """
    from apps.tickets.services import satisfaction

    try:
        ticket = Ticket.objects.select_related("requester").get(pk=ticket_pk)
        satisfaction.create_for_ticket(ticket)
    except Exception:  # noqa: BLE001 — acessório não derruba o principal
        logger.exception("Falha ao abrir pesquisa de satisfação do ticket %s", ticket_pk)


def mover_para_stage(*, ticket: Ticket, stage: TicketStage, actor, board) -> Ticket:
    """Arrastar o card para uma coluna: o chamado assume AQUELE status.

    Duas coisas podem mudar, e são independentes:

    - a coluna (`stage`) muda sempre — é para onde a pessoa arrastou;
    - a categoria (`status`) muda só quando a coluna de destino é de outra
      categoria. Arrastar de "Aberto" para "Em análise" (as duas `open`) é
      andar dentro da mesma categoria: o SLA não reinicia, o cliente continua
      lendo um chamado em aberto, e mesmo assim o quadro registra o movimento.

    CLOSED continua barrado aqui: fechar exige as datas de solução (D4/D7), e
    o kanban_service devolve o 409 que manda a pessoa pelo caminho certo.
    """
    if stage.category == TicketStatus.CLOSED:
        raise TicketRuleViolation("Fechamento exige o fluxo de close (D4/D7).")

    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        if ticket.status != stage.category:
            # `note` é texto de LEITURA: sai no histórico do chamado e na
            # coluna "situação" da lista (current_status_note, views.py).
            # Era `kanban:{slug}` — um token de máquina, com o identificador
            # de URL dentro, no meio de vizinhos que são frases ("conversão
            # de chat", "atribuído a Fulano").
            _change_status(ticket, stage.category, actor,
                           note=f"movido no quadro {board.name}", stage=stage)
        elif ticket.stage_id != stage.pk:
            # mesma categoria, outra coluna: nada de evento de status — não
            # houve mudança de status para registrar, e inventar um poluiria o
            # histórico e as métricas de tempo por status
            ticket.stage = stage
            ticket.save(update_fields=["stage"])
    return ticket


def mudar_status(*, ticket: Ticket, stage: TicketStage, actor) -> Ticket:
    """Troca o status de um chamado FORA do quadro — é a ação em lote da fila
    ("Mudar status" com vários selecionados).

    Mesma mecânica de `mover_para_stage` (coluna sempre, categoria só quando
    muda), com três recusas a mais, cada uma com o motivo que a fila mostra
    no resumo do lote:

    - status de conclusão: fechar pede as datas da solução (D4/D7), que é o
      fluxo de "Encerrar", não uma troca de coluna;
    - chamado já fechado: reabrir é responder (é assim que o cliente é
      avisado e a pesquisa de satisfação é respeitada, ver `add_reply`) —
      reabrir 30 de uma vez por um select passaria por cima das duas coisas;
    - já está nesse status: não é erro, mas também não é "atualizado" — sem
      a recusa, o resumo diria "30 atualizados" para um lote que não mudou
      nada.

    Sem `note` no evento: a nota da troca de status vira a coluna
    "Justificativa" da fila (`current_status_note`) e o verbo do feed de
    atividade ("alterou …" em vez de "mudou o status de …"). Uma frase de
    máquina ali apagaria a justificativa real que alguém escreveu antes.
    """
    if not actor.is_internal:
        raise TicketRuleViolation("Apenas usuários internos mudam o status.")
    if not actor.can(Perm.TICKET_EDIT_PROPERTIES):
        raise TicketRuleViolation("Seu papel não permite mudar o status do ticket.")
    if stage.category == TicketStatus.CLOSED:
        raise TicketRuleViolation("Encerrar exige as datas da solução (D4/D7).")

    with transaction.atomic():
        ticket = Ticket.objects.select_for_update().get(pk=ticket.pk)
        if ticket.status == TicketStatus.CLOSED:
            raise TicketRuleViolation("Ticket fechado. Para reabrir, responda pelo chamado.")
        if ticket.stage_id == stage.pk:
            raise TicketRuleViolation("Já está neste status.")
        if ticket.status != stage.category:
            _change_status(ticket, stage.category, actor, stage=stage)
        else:
            ticket.stage = stage
            ticket.save(update_fields=["stage"])
    from apps.notifications.services import broadcast_ticket_event

    broadcast_ticket_event(ticket=ticket, kind="updated", actor=actor)
    return ticket


def stage_padrao(category: str) -> TicketStage | None:
    """O status de fábrica de uma categoria — para onde o chamado vai quando
    quem mudou o status não escolheu uma coluna específica.

    Devolve `None` só num banco sem os stages de fábrica (migração 0016 não
    rodou): aí o chamado fica sem coluna em vez de estourar, e a categoria —
    que é o que o maquinário lê — continua correta.
    """
    return TicketStage.objects.filter(
        category=category, is_system=True
    ).order_by("order", "id").first()


def _change_status(ticket: Ticket, to_status: str, actor, *, automatic=False,
                   note="", stage: TicketStage | None = None):
    """Muda a CATEGORIA do chamado, e com ela a coluna do quadro.

    `stage` só vem preenchido quando alguém escolheu a coluna (arrastar no
    quadro para um status próprio, tipo "Em análise"). Sem ele, o chamado cai
    no status de fábrica da categoria — é o caso de responder, fechar, reabrir
    e de todo o automático.

    Os dois campos andam juntos SEMPRE, no mesmo save: é o que impede a tela
    de mostrar uma coisa e o SLA de contar outra.
    """
    TicketStatusEvent.objects.create(
        ticket=ticket,
        from_status=ticket.status,
        to_status=to_status,
        changed_by=actor,
        is_automatic=automatic,
        note=note,
    )
    saiu_de_pending = (ticket.status == TicketStatus.PENDING_CUSTOMER
                       and to_status != TicketStatus.PENDING_CUSTOMER)
    entrou_em_pending = (to_status == TicketStatus.PENDING_CUSTOMER
                         and ticket.status != TicketStatus.PENDING_CUSTOMER)
    update_fields = ["status"]
    ticket.status = to_status

    destino = stage if stage is not None else stage_padrao(to_status)
    if destino is not None and ticket.stage_id != destino.pk:
        ticket.stage = destino
        update_fields.append("stage")

    # o relógio de resolução PARA enquanto a bola está com o cliente (é o que
    # a tela de relatórios sempre prometeu): entrar em pending_customer marca
    # a pausa; sair empurra o prazo pela duração exata da espera
    agora = timezone.now()
    if entrou_em_pending and ticket.sla_resolution_due_at is not None:
        ticket.sla_paused_at = agora
        update_fields.append("sla_paused_at")
    elif saiu_de_pending and ticket.sla_paused_at is not None:
        if ticket.sla_resolution_due_at is not None:
            ticket.sla_resolution_due_at += agora - ticket.sla_paused_at
            update_fields.append("sla_resolution_due_at")
        ticket.sla_paused_at = None
        update_fields.append("sla_paused_at")

    # saiu de "aguardando o cliente": a espera acabou, então uma futura espera
    # merece um aviso novo — sem isto, um ticket que já foi avisado uma vez
    # nunca mais avisaria, mesmo numa rodada de espera completamente nova.
    if ticket.auto_close_warned_at is not None and to_status != TicketStatus.PENDING_CUSTOMER:
        ticket.auto_close_warned_at = None
        update_fields.append("auto_close_warned_at")
    ticket.save(update_fields=update_fields)


def _tempo_aguardando_subquery():
    """Subquery do instante em que cada ticket entrou na ÚLTIMA vez em
    'aguardando o cliente' — base tanto do aviso quanto do fechamento."""
    from django.db.models import OuterRef, Subquery

    return Subquery(
        TicketStatusEvent.objects
        .filter(ticket=OuterRef("pk"), to_status=TicketStatus.PENDING_CUSTOMER)
        .order_by("-created_at").values("created_at")[:1]
    )


def auto_close_stale_pending() -> int:
    """Fecha tickets parados em 'aguardando o cliente' além do prazo configurado.

    O relógio conta desde a ÚLTIMA vez que o ticket entrou em pending_customer,
    em horas CORRIDAS (relógio de parede, não horário de atendimento — decisão
    explícita, ver SystemConfig.auto_close_pending_hours): se o cliente tivesse
    respondido, `add_reply` já teria virado o status para aberto — quem continua
    aguardando é quem não respondeu. A mensagem e o prazo saem do SystemConfig
    (editáveis em Configurações → Operação); prazo zero desliga a regra.

    O fechamento automático NÃO reabre por resposta (R: cliente abre um novo
    chamado) — é por isso que marca `auto_closed=True`, diferente de um
    fechamento manual do agente.

    Devolve quantos foram fechados. Idempotente: rodar de novo não refecha nada.
    """
    from apps.core.models import SystemConfig

    cfg = SystemConfig.load()
    horas = cfg.auto_close_pending_hours
    if not horas:
        return 0

    agora = timezone.now()
    corte = agora - dt.timedelta(hours=horas)
    alvos = list(
        Ticket.objects.filter(status=TicketStatus.PENDING_CUSTOMER)
        .annotate(aguardando_desde=_tempo_aguardando_subquery())
        .filter(aguardando_desde__lt=corte)
        .values_list("pk", flat=True)
    )

    fechados = 0
    for pk in alvos:
        with transaction.atomic():
            ticket = Ticket.objects.select_for_update().get(pk=pk)
            if ticket.status != TicketStatus.PENDING_CUSTOMER:
                continue  # mudou entre a seleção e o lock
            # a mensagem é pública e sem autor: o cliente lê "Sistema" e entende
            # por que o chamado fechou; a mensagem já orienta a abrir um novo (R)
            TicketMessage.objects.create(
                ticket=ticket, author=None, body=cfg.auto_close_message,
                is_public=True, source=MessageSource.SYSTEM,
            )
            ticket.closed_at = agora
            ticket.auto_closed = True
            ticket.save(update_fields=["closed_at", "auto_closed"])
            _change_status(
                ticket, TicketStatus.CLOSED, None, automatic=True,
                note="Fechado por falta de resposta do cliente.",
            )
            transaction.on_commit(
                lambda p=ticket.pk: _open_satisfaction_survey(p)
            )
            transaction.on_commit(
                lambda p=ticket.pk: _notify_requester_closed(p, automatic=True)
            )
        fechados += 1
    return fechados


def warn_stale_pending() -> int:
    """Avisa o cliente ANTES do fechamento automático (R: avisar).

    Dispara quando falta `auto_close_warning_hours` para o prazo de
    `auto_close_pending_hours` vencer — ex.: prazo 72h e aviso 24h manda o
    lembrete com 48h de espera. `auto_close_warned_at` garante que cada período
    de espera recebe UM aviso só; `_change_status` zera esse campo sempre que
    o ticket sai de 'aguardando o cliente', então uma nova espera pode avisar
    de novo. Zero em qualquer um dos dois campos desliga o aviso.

    Devolve quantos avisos foram enviados.
    """
    from apps.core.models import SystemConfig

    cfg = SystemConfig.load()
    horas_prazo = cfg.auto_close_pending_hours
    horas_aviso = cfg.auto_close_warning_hours
    if not horas_prazo or not horas_aviso:
        return 0

    agora = timezone.now()
    # aviso dispara quando já se passou (prazo - aviso) horas de espera
    corte = agora - dt.timedelta(hours=max(horas_prazo - horas_aviso, 0))
    alvos = list(
        Ticket.objects.filter(
            status=TicketStatus.PENDING_CUSTOMER, auto_close_warned_at__isnull=True,
        )
        .annotate(aguardando_desde=_tempo_aguardando_subquery())
        .filter(aguardando_desde__lt=corte)
        .values_list("pk", flat=True)
    )

    avisados = 0
    for pk in alvos:
        with transaction.atomic():
            ticket = Ticket.objects.select_for_update().get(pk=pk)
            if ticket.status != TicketStatus.PENDING_CUSTOMER or ticket.auto_close_warned_at:
                continue  # mudou entre a seleção e o lock, ou já foi avisado
            TicketMessage.objects.create(
                ticket=ticket, author=None, body=cfg.auto_close_warning_message,
                is_public=True, source=MessageSource.SYSTEM,
            )
            ticket.auto_close_warned_at = agora
            ticket.save(update_fields=["auto_close_warned_at"])
        avisados += 1
    return avisados


def _reopen(ticket: Ticket, author, now, *, automatic=True):
    """Reabertura — pelo cliente (resposta em ticket fechado, automática) ou
    pelo agente (resposta escolhendo status aberto).

    NÃO consome cota (P6) e NÃO reescreve first_response_at (D5); o SLA de
    resolução reinicia no novo ciclo.
    """
    TicketStatusEvent.objects.create(
        ticket=ticket,
        from_status=TicketStatus.CLOSED,
        to_status=TicketStatus.OPEN,
        changed_by=author,
        is_reopen=True,
        is_automatic=automatic,
    )
    ticket.status = TicketStatus.OPEN
    ticket.stage = stage_padrao(TicketStatus.OPEN)
    ticket.reopen_count += 1
    ticket.last_reopened_at = now
    ticket.sla_cycle += 1
    ticket.sla_resolution_breached = False
    ticket.closed_at = None
    ticket.closed_by = None
    ticket.save(update_fields=[
        "status", "stage", "reopen_count", "last_reopened_at", "sla_cycle",
        "sla_resolution_breached", "closed_at", "closed_by",
    ])
    sla.restart_resolution_sla(ticket)  # D5: novo prazo de resolução

    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email, ticket_url

    # não avisa quem reabriu a si mesmo (agente reabrindo o próprio chamado)
    if ticket.assignee and ticket.assignee_id != author.pk:
        titulo = f"Ticket reaberto: {ticket.reference}"
        corpo = f"{author.full_name}: resposta em ticket fechado."
        url = ticket_url(ticket, ticket.assignee)
        notify(
            recipient=ticket.assignee,
            kind=NotificationKind.TICKET_REOPENED,
            title=titulo,
            body=corpo,
            url=url,
            ticket=ticket,
            actor=author,
        )
        if ticket.assignee.email and quer_email(ticket.assignee, NotificationKind.TICKET_REOPENED):
            from django.conf import settings

            queue_email(
                to=ticket.assignee.email,
                subject=titulo,
                template="ticket_reopened",
                context={
                    "agent_name": ticket.assignee.full_name,
                    "reference": ticket.reference,
                    "subject": ticket.subject,
                    "author_name": author.full_name,
                    "link": f"{settings.SITE_URL}{url}",
                },
                ticket=ticket,
                # cada reabertura é um ciclo de SLA novo (sla_cycle) — e um e-mail novo
                dedupe_key=f"ticket-reopened:{ticket.pk}:{ticket.sla_cycle}",
            )


# ---------------------------------------------------------------------- #
# Corrigir o que já foi enviado
# ---------------------------------------------------------------------- #

#: Mensagem que substitui o corpo apagado na thread.
CORPO_APAGADO = "Esta mensagem foi apagada."


def _pode_mexer_na_mensagem(message: TicketMessage, actor) -> None:
    """Só o AUTOR corrige o que escreveu.

    Nem admin: a mensagem é fala de uma pessoa, e um administrador reescrevendo
    a fala de outra dentro de um histórico que o cliente lê é falsificação, não
    administração. Admin que precise remover conteúdo tem a via da LGPD (D20),
    que é auditada e feita para isso.

    Mensagem de sistema (`author=None`) não se edita: ela é registro do
    maquinário, não fala de ninguém.
    """
    if message.author_id is None:
        raise TicketRuleViolation("Mensagem do sistema não pode ser alterada.")
    if actor.pk != message.author_id:
        raise TicketRuleViolation("Só o autor pode alterar a própria mensagem.")
    if message.deleted_at is not None:
        raise TicketRuleViolation("Esta mensagem já foi apagada.")


def _auditar_mensagem(*, message, actor, action, changes, summary) -> None:
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditLog

    AuditLog.objects.create(
        actor=actor,
        action=action,
        content_type=ContentType.objects.get_for_model(TicketMessage),
        object_id=str(message.pk),
        changes=changes,
        summary=summary,
    )


def edit_message(*, message: TicketMessage, actor, body: str) -> TicketMessage:
    """Corrige o texto de uma mensagem já enviada.

    O texto ANTERIOR vai para a auditoria antes de ser substituído: sem isso,
    "editar" seria um jeito silencioso de reescrever o que se disse a um
    cliente. A tela mostra "editada" ao lado da mensagem pelo `edited_at`.

    O que a edição NÃO toca: `is_public` (uma nota interna não vira resposta ao
    cliente por edição — e vice-versa: uma resposta que o cliente já leu não
    pode se esconder virando nota), status, SLA ou anexos.
    """
    _pode_mexer_na_mensagem(message, actor)
    body = (body or "").strip()
    if not body:
        raise TicketRuleViolation("A mensagem não pode ficar vazia — apague-a.")
    if body == message.body:
        return message

    anterior = message.body
    with transaction.atomic():
        message.body = body
        message.edited_at = timezone.now()
        message.edited_by = actor
        message.save(update_fields=["body", "edited_at", "edited_by", "updated_at"])
        _auditar_mensagem(
            message=message, actor=actor, action="update",
            changes={"body": [anterior, body]},
            summary=f"Mensagem editada no ticket {message.ticket.reference}",
        )
    return message


def delete_message(*, message: TicketMessage, actor) -> TicketMessage:
    """Apaga o CONTEÚDO de uma mensagem, preservando a linha.

    Ver o comentário em `TicketMessage.deleted_at`: a linha sustenta o relógio
    do SLA e a auditoria. O corpo original fica na auditoria, e a thread mostra
    "mensagem apagada" no lugar — quem já leu sabe que algo estava ali, o que é
    mais honesto do que um buraco.
    """
    _pode_mexer_na_mensagem(message, actor)

    anterior = message.body
    with transaction.atomic():
        message.body = CORPO_APAGADO
        message.deleted_at = timezone.now()
        message.deleted_by = actor
        message.save(
            update_fields=["body", "deleted_at", "deleted_by", "updated_at"]
        )
        _auditar_mensagem(
            message=message, actor=actor, action="delete",
            changes={"body": [anterior, ""]},
            summary=f"Mensagem apagada no ticket {message.ticket.reference}",
        )
    return message
