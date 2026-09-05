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
    "ticket_replied": (
        "Olá, {requester_name}.\n\n"
        "{agent_name} respondeu o chamado {reference} — {subject}.\n\n"
        "Acesse o portal de suporte para ler a resposta e continuar a "
        "conversa.\n"
        "Este e-mail não recebe respostas."
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
}


@shared_task(bind=True, max_retries=5, default_retry_delay=30)
def send_outbound_email(self, email_id: int):
    from apps.notifications.models import OutboundEmail

    from apps.core.models import SystemConfig
    from apps.notifications import mailer

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
    try:
        mailer.enviar(
            to=email.to_email,
            subject=email.subject,
            body=template.format(**email.context),
            config=config,
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
    from apps.notifications.services import already_notified, notify

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
    notify(
        recipient=destinatario,
        kind=kind,
        title=f"SLA de {label} {verb}: {ticket.reference}{sufixo}",
        body=ticket.subject,
        url=f"/tickets/{ticket.pk}",
        ticket=ticket,
    )
    return 1 if past_due else 0
