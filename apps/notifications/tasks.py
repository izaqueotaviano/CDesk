"""Tasks de notificação: envio do outbox e varredura de SLA."""

import logging

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# corpo dos e-mails: texto simples com placeholders do context do outbox.
# Reply-To é no-reply de propósito — não existe ingestão por e-mail.
EMAIL_TEMPLATES = {
    "new_ticket": (
        "Novo ticket {reference} aberto por {requester} ({company}).\n\n"
        "Equipe: {team}\nAssunto: {subject}\n\n"
        "Acesse o sistema para responder — este e-mail não recebe respostas."
    ),
    "invite": (
        "Olá, {full_name}.\n\n"
        "Seu acesso ao suporte{company} foi criado. Defina sua senha em:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "login_code": (
        "Olá, {full_name}.\n\n"
        "Seu código de verificação é: {code}\n\n"
        "Ele vale por {valid_minutes} minutos e só funciona uma vez.\n"
        "Se você não tentou entrar, ignore este e-mail e avise o suporte.\n\n"
        "Este e-mail não recebe respostas."
    ),
    # `{assinatura}` é a assinatura de quem respondeu, em texto puro, e vem
    # vazia quando ele não pediu para incluí-la — ver `_notify_requester_replied`
    "ticket_replied": (
        "Olá, {requester_name}.\n\n"
        "{agent_name} respondeu o chamado {reference} — {subject}.\n\n"
        "Acesse o portal de suporte para ler a resposta e continuar a "
        "conversa.\n"
        "Este e-mail não recebe respostas.\n"
        "{assinatura}"
    ),
    "chat_converted": (
        "Olá, {requester_name}.\n\n"
        "Sua conversa virou o chamado {reference} — {subject}.\n\n"
        "Acesse o portal de suporte para acompanhar o andamento.\n"
        "Este e-mail não recebe respostas."
    ),
    # --- ciclo de vida visto pelo cliente (Painel do Cliente) -------------
    # A regra do portal é "e-mail da abertura ao encerramento do chamado, e
    # ao fim do chat". Cada um respeita a preferência da conta
    # (`quer_email`): abertura sob TICKET_CREATED, os dois desfechos sob
    # TICKET_CLOSED e o chat sob CHAT_CLOSED.
    "ticket_opened": (
        "Olá, {requester_name}.\n\n"
        "Recebemos seu chamado {reference} — {subject}.\n\n"
        "Equipe responsável: {team}. Você recebe um e-mail a cada resposta "
        "do suporte, e pode acompanhar tudo pelo portal:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "ticket_resolved": (
        "Olá, {requester_name}.\n\n"
        "O chamado {reference} — {subject} foi resolvido pelo suporte.\n\n"
        "Se ainda precisar de algo sobre este assunto, é só responder ao "
        "chamado pelo portal — ele reabre. E, se puder, avalie o "
        "atendimento: leva menos de um minuto.\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "ticket_auto_closed": (
        "Olá, {requester_name}.\n\n"
        "O chamado {reference} — {subject} foi encerrado automaticamente "
        "porque ficou aguardando o seu retorno por mais tempo que o "
        "combinado.\n\n"
        "Se ainda precisar de ajuda, abra um novo chamado pelo portal:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "chat_closed": (
        "Olá, {client_name}.\n\n"
        "Sua conversa por chat{com_agente} foi encerrada.\n\n"
        "{proximo_passo}\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "twofa_reset_by_admin": (
        "Olá, {full_name}.\n\n"
        "Um administrador desativou a verificação em duas etapas da sua "
        "conta ({email}) — geralmente porque você perdeu o acesso ao "
        "método anterior (app autenticador ou e-mail).\n\n"
        "Se quiser, ative de novo em Minha conta > Segurança.\n"
        "Se você não pediu isso a ninguém, avise o suporte agora.\n\n"
        "Este e-mail não recebe respostas."
    ),
    "password_reset_by_admin": (
        "Olá, {full_name}.\n\n"
        "Um administrador redefiniu a senha da sua conta ({email}) — "
        "geralmente a pedido de quem esqueceu a senha anterior.\n\n"
        "Por segurança, este e-mail não informa a senha nova: ela foi "
        "passada a você diretamente por quem fez o atendimento.\n"
        "Se você não pediu isso a ninguém, avise o suporte agora.\n\n"
        "Este e-mail não recebe respostas."
    ),
    # --- "Esqueci minha senha" (apps/accounts/recuperacao.py) ---------------
    # A parte HTML sai do modelo que o admin configura em Sistema, como a de
    # todo e-mail do outbox; o link vira link clicável lá (mailer._paragrafos).
    "password_reset": (
        "Olá, {full_name}.\n\n"
        "Recebemos um pedido para redefinir a senha da sua conta ({email}). "
        "Para criar uma senha nova, abra o link abaixo:\n"
        "{link}\n\n"
        "O link vale por {valid_minutes} minutos e só funciona uma vez.\n"
        "Se você não pediu isso, ignore este e-mail: sua senha continua a "
        "mesma.\n\n"
        "Este e-mail não recebe respostas."
    ),
    "password_changed": (
        "Olá, {full_name}.\n\n"
        "A senha da sua conta ({email}) foi alterada em {quando}, pelo link "
        "de recuperação enviado a este e-mail.\n\n"
        "Por segurança, encerramos as sessões abertas em outros aparelhos. "
        "Para entrar de novo, use a senha nova.\n"
        "Se não foi você, fale com o suporte agora.\n\n"
        "Este e-mail não recebe respostas."
    ),
    # --- ciclo de vida visto por quem ATENDE (agente/admin interno) -------
    # Cada tipo aqui já existia como notificação IN-APP; até esta rodada o
    # toggle de e-mail correspondente em Minha conta > Notificações não
    # tinha efeito nenhum — a preferência existia, mas nada consultava
    # `quer_email` para estes 9 tipos. O texto reaproveita os mesmos dados
    # já calculados para o `notify()` de cada ponto (título, corpo, link).
    "ticket_assigned": (
        "Olá, {agent_name}.\n\n"
        "O chamado {reference} — {subject} foi atribuído a você.\n\n"
        "Acesse o sistema para atender:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "ticket_owner_set": (
        "Olá, {agent_name}.\n\n"
        "Você foi definido como dono técnico do chamado {reference} — "
        "{subject}.\n\n"
        "Acesse o sistema para acompanhar:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "ticket_reopened": (
        "Olá, {agent_name}.\n\n"
        "O chamado {reference} — {subject}, atribuído a você, foi reaberto: "
        "{author_name} respondeu depois do fechamento.\n\n"
        "Acesse o sistema para continuar o atendimento:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    # `{resumo}` num parágrafo só dele: é a nota que a pessoa escreveu, e na
    # parte HTML ela chega formatada, como bloco citado (`resumo_md`, ver
    # `_corpos_do_email`). Entre aspas, no meio da frase, uma lista não cabia.
    "mention": (
        "Olá, {agent_name}.\n\n"
        "{author_name} mencionou você no chamado {reference}:\n\n"
        "{resumo}\n\n"
        "Acesse o sistema para ver a nota completa:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "sla_warning": (
        "Olá, {agent_name}.\n\n"
        "O SLA de {label} do chamado {reference} — {subject} está próximo "
        "do limite.\n\n"
        "Acesse o sistema para atender antes do prazo:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "sla_breached": (
        "Olá, {agent_name}.\n\n"
        "O SLA de {label} do chamado {reference} — {subject} estourou.\n\n"
        "Acesse o sistema para atender:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "kanban_due": (
        "Olá, {agent_name}.\n\n"
        "O prazo do card do chamado {reference} — {subject} venceu no "
        "quadro {board}.\n\n"
        "Acesse o sistema para atualizar:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    # anexo bloqueado: um template só para os dois pontos de origem (ticket
    # e chat) — o texto é idêntico, só muda o link de volta (ver
    # `apps.tickets.tasks` e `apps.chat.tasks`)
    "attachment_blocked": (
        "Olá, {user_name}.\n\n"
        "A verificação antivírus identificou uma ameaça no arquivo "
        "\"{filename}\" que você enviou, e ele não ficará disponível para "
        "download.\n\n"
        "Acesse o sistema para mais detalhes:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "lgpd_deadline": (
        "Olá, {admin_name}.\n\n"
        "{corpo}\n\n"
        "Acesse a auditoria para tratar o pedido:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    # --- os 2 últimos NotificationKind que nunca tiveram emissor nenhum,
    # nem in-app nem e-mail (a rodada anterior cobriu os 9 de agente acima;
    # estes dois não tinham NADA disparando `notify()`/`queue_email()`) ----
    "announcement": (
        "Olá, {full_name}.\n\n"
        "Novo aviso no mural: {title}\n\n"
        "{resumo}\n\n"
        "Veja o mural completo:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
    "chat_incoming": (
        "Olá, {agent_name}.\n\n"
        "{client_name} ({company}) está aguardando atendimento no chat há "
        "um tempo e ainda não foi atendido.\n\n"
        "Acesse o sistema para atender:\n"
        "{link}\n\n"
        "Este e-mail não recebe respostas."
    ),
}


class _ContextoTolerante(dict):
    """Marcador sem valor vira string vazia em vez de derrubar o envio.

    O outbox guarda o CONTEXTO; o molde é código. Quando um molde ganha um
    marcador novo (foi o caso de `{assinatura}`), as mensagens que já estavam
    na fila não o têm — e um `KeyError` aqui não é um e-mail feio, é um e-mail
    que nunca sai e uma task em retry até desistir.
    """

    def __missing__(self, chave: str) -> str:  # noqa: D105
        logger.warning("molde de e-mail pediu %r, que não está no contexto", chave)
        return ""


def _corpos_do_email(template: str, contexto: dict) -> tuple[str, str | None, dict[str, str]]:
    """As duas partes do e-mail a partir do molde.

    Campo de contexto terminado em `_md` é texto que uma PESSOA escreveu com a
    formatação leve da tela (`apps/notifications/formatacao.py`) — hoje, a nota
    citada no aviso de menção. Ele preenche o marcador de mesmo nome sem o
    sufixo (`resumo_md` → `{resumo}`):

    - na parte de texto puro, sem os marcadores (`**urgente**` → `urgente`);
    - na parte HTML, como HTML formatado — via uma marca inerte que o
      `mailer.montar_html` troca DEPOIS de escapar o resto do molde.

    Sem campo `_md` (todos os outros e-mails, e os que já estavam na fila antes
    desta regra), devolve o molde de sempre e nenhum HTML à parte.
    """
    from apps.notifications import formatacao

    formatados = {
        chave[: -len("_md")]: str(contexto.pop(chave) or "")
        for chave in [k for k in contexto if k.endswith("_md")]
    }
    for chave, bruto in formatados.items():
        contexto[chave] = formatacao.para_texto(bruto)
    corpo = template.format_map(contexto)
    if not formatados:
        return corpo, None, {}

    contexto_html = _ContextoTolerante(contexto)
    trechos: dict[str, str] = {}
    for i, (chave, bruto) in enumerate(formatados.items()):
        # caracteres de uso privado: não aparecem em texto de verdade, e o
        # escape de HTML não mexe neles
        marca = f"{i}"
        contexto_html[chave] = marca
        trechos[marca] = formatacao.para_html(bruto)
    return corpo, template.format_map(contexto_html), trechos


@shared_task(bind=True, max_retries=5, default_retry_delay=30)
def send_outbound_email(self, email_id: int):
    from apps.core.models import SystemConfig
    from apps.notifications import mailer
    from apps.notifications.models import OutboundEmail

    email = OutboundEmail.objects.get(pk=email_id)
    if email.status == OutboundEmail.Status.SENT:
        return  # idempotência no retry

    config = SystemConfig.load()
    if not config.email_enabled:
        # não é falha: a operação desligou. Fica registrado no outbox para a
        # tela de Sistema mostrar o que deixou de sair, e não volta a tentar.
        email.status = OutboundEmail.Status.SKIPPED
        email.error = "Entrega de e-mail desligada em Configurações → Sistema."
        email.save(update_fields=["status", "error"])
        return

    template = EMAIL_TEMPLATES.get(email.template, "{body}")
    contexto = _ContextoTolerante(email.context)
    # não é marcador do molde de texto: é o bloco HTML da assinatura, que só
    # existe na parte rica do e-mail (a de texto puro recebe `{assinatura}`)
    html_extra = contexto.pop("assinatura_html", "")
    corpo, corpo_html, trechos_html = _corpos_do_email(template, contexto)
    try:
        mailer.enviar(
            to=email.to_email,
            subject=email.subject,
            body=corpo,
            config=config,
            html_extra=html_extra,
            corpo_html=corpo_html,
            trechos_html=trechos_html,
        )
    except Exception as exc:
        email.attempts += 1
        email.status = OutboundEmail.Status.FAILED
        email.error = str(exc)[:2000]
        email.save(update_fields=["attempts", "status", "error"])
        raise self.retry(exc=exc) from exc

    email.status = OutboundEmail.Status.SENT
    email.sent_at = timezone.now()
    email.attempts += 1
    email.save(update_fields=["status", "sent_at", "attempts"])


@shared_task
def sla_scan():
    """Varredura de SLA (beat, 5 min): avisa quando o prazo se aproxima e marca
    o estouro. Deduplicado por (destinatário, tipo, ticket)."""
    from apps.tickets.models import Ticket, TicketStatus

    now = timezone.now()
    warn_at = now + timezone.timedelta(minutes=settings.SLA_WARNING_MINUTES)
    warned = breached = 0

    open_tickets = Ticket.objects.exclude(status=TicketStatus.CLOSED).select_related(
        "assignee", "team"
    )

    # primeira resposta: só enquanto não respondida
    for ticket in open_tickets.filter(
        first_response_at__isnull=True,
        sla_first_response_due_at__isnull=False,
        sla_first_response_due_at__lte=warn_at,
    ):
        past_due = ticket.sla_first_response_due_at <= now
        if past_due:
            # marca o estouro num UPDATE condicional: a guarda vai no WHERE, então
            # dois scans concorrentes (ou um scan cruzando com add_reply/close, que
            # bloqueiam a linha) não perdem a marcação nem se sobrescrevem
            Ticket.objects.filter(
                pk=ticket.pk, sla_first_response_breached=False
            ).update(sla_first_response_breached=True)
        breached += _alert(ticket, past_due, "primeira resposta")
        warned += 0 if past_due else 1

    # resolução: qualquer ticket vivo com prazo estourando — MENOS quem está
    # aguardando o cliente: o relógio está pausado e o prazo será empurrado
    # na retomada (ver _change_status); alarmar aqui seria alarme falso
    for ticket in open_tickets.filter(
        sla_resolution_due_at__isnull=False,
        sla_resolution_due_at__lte=warn_at,
    ).exclude(status=TicketStatus.PENDING_CUSTOMER):
        past_due = ticket.sla_resolution_due_at <= now
        if past_due:
            Ticket.objects.filter(
                pk=ticket.pk, sla_resolution_breached=False
            ).update(sla_resolution_breached=True)
        breached += _alert(ticket, past_due, "resolução")
        warned += 0 if past_due else 1

    return {"warned": warned, "breached": breached}


def _alert(ticket, past_due, label) -> int:
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import (
        already_notified,
        notify,
        quer_email,
        queue_email,
        ticket_url,
    )

    # sem responsável, quem responde pela fila é o SUPERVISOR da equipe —
    # justamente os tickets "sem atendimento" eram os que ninguém alertava
    destinatario = ticket.assignee or ticket.team.supervisor
    if destinatario is None:
        return 0  # equipe sem supervisor e ticket sem dono: relatório pega
    kind = NotificationKind.SLA_BREACHED if past_due else NotificationKind.SLA_WARNING
    # `since`: reabertura zera a régua do dedupe — o prazo NOVO avisa de novo
    if already_notified(recipient=destinatario, kind=kind, ticket=ticket,
                        since=ticket.last_reopened_at):
        return 0
    verb = "estourou" if past_due else "está próximo do limite"
    sufixo = "" if ticket.assignee else " (sem responsável)"
    titulo = f"SLA de {label} {verb}: {ticket.reference}{sufixo}"
    url = ticket_url(ticket, destinatario)
    notify(
        recipient=destinatario,
        kind=kind,
        title=titulo,
        body=ticket.subject,
        url=url,
        ticket=ticket,
    )
    if destinatario.email and quer_email(destinatario, kind):
        from django.conf import settings

        queue_email(
            to=destinatario.email,
            subject=titulo,
            template="sla_breached" if past_due else "sla_warning",
            context={
                "agent_name": destinatario.full_name,
                "reference": ticket.reference,
                "subject": ticket.subject,
                "label": label,
                "link": f"{settings.SITE_URL}{url}",
            },
            ticket=ticket,
            # mesma régua do dedupe in-app: reabertura (sla_cycle) libera novo aviso
            dedupe_key=f"{kind}:{ticket.pk}:{ticket.sla_cycle}",
        )
    return 1 if past_due else 0
