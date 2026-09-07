"""Tasks Celery do chat v2.

- `convert_unattended_chats`: o timeout de fila — ninguém pegou dentro do
  tempo configurado, vira o ticket "Chat não atendido" na equipe padrão.
  Roda a cada minuto no beat; idempotente (conversão é OneToOne no banco).
- `scan_chat_file`: varredura antivírus do anexo, mesma política de
  quarentena dos anexos de ticket (D19).
- `notify_queued_chats`: aviso PERSISTENTE (sino + e-mail) de chat esquecido
  na fila há tempo demais, ANTES do timeout acima converter em ticket —
  diferente do popup em tempo real de `_avisar_fila` (ver chat_service).
"""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

_SETTLED = {"clean", "infected", "skipped"}  # estados terminais da varredura


@shared_task
def convert_unattended_chats() -> int:
    """Fila esquecida vira ticket — o cliente não fica falando sozinho.

    Sem equipe padrão configurada (e sem nenhuma equipe ativa), o chat fica
    na fila e o problema é logado: converter para lugar nenhum não existe.
    """
    from apps.accounts.models import Team
    from apps.chat.models import Chat, ChatConfig, ChatStatus
    from apps.tickets.services import ticket_service

    config = ChatConfig.load()
    corte = timezone.now() - timezone.timedelta(minutes=config.queue_timeout_minutes)
    equipe = config.default_team or Team.objects.filter(is_active=True).first()

    esquecidos = Chat.objects.filter(status=ChatStatus.QUEUED, queued_at__lt=corte)
    convertidos = 0
    for chat in esquecidos:
        if equipe is None:
            logger.error(
                "Chat #%s estourou o timeout mas não há equipe padrão "
                "configurada — configure em Configurações do chat.", chat.pk,
            )
            continue
        ticket_service.create_from_chat(
            chat=chat, team=equipe, subject="Chat não atendido", auto=True,
        )
        convertidos += 1
        logger.info("Chat #%s não atendido em %s min — virou ticket.",
                    chat.pk, config.queue_timeout_minutes)
    return convertidos


@shared_task(bind=True, max_retries=5, default_retry_delay=60)
def scan_chat_file(self, chat_file_id: int) -> str:
    """Antivírus do anexo de chat — nasce em quarentena, só é servido depois
    de `clean`/`skipped`; daemon fora do ar é retry, nunca aprovação."""
    from apps.chat.models import ChatFile, ChatScanStatus
    from apps.tickets.services import antivirus

    chat_file = ChatFile.objects.filter(pk=chat_file_id).first()
    if chat_file is None:
        return "gone"
    if chat_file.scan_status in _SETTLED:
        return chat_file.scan_status

    chat_file.scan_attempts += 1

    try:
        with chat_file.file.open("rb") as handle:
            verdict, signature = antivirus.scan_stream(handle)

    except antivirus.ScanUnavailable as exc:
        chat_file.save(update_fields=["scan_attempts"])
        if self.request.retries >= self.max_retries:
            logger.error("Varredura esgotou as tentativas: anexo de chat %s", chat_file_id)
            return _settle(chat_file, ChatScanStatus.ERROR, error=str(exc))
        raise self.retry(exc=exc) from exc

    except antivirus.ScanRejected as exc:
        return _settle(chat_file, ChatScanStatus.ERROR, error=str(exc))

    except FileNotFoundError as exc:
        return _settle(chat_file, ChatScanStatus.ERROR, error=f"Arquivo ausente: {exc}")

    if verdict == antivirus.INFECTED:
        _settle(chat_file, ChatScanStatus.INFECTED, signature=signature)
        _report_infection(chat_file)
        return ChatScanStatus.INFECTED

    return _settle(chat_file, ChatScanStatus.CLEAN)


def _settle(chat_file, status, *, signature: str = "", error: str = "") -> str:
    chat_file.scan_status = status
    chat_file.scan_signature = signature[:200]
    chat_file.scan_error = error[:250]
    chat_file.scanned_at = timezone.now()
    chat_file.save(update_fields=[
        "scan_status", "scan_signature", "scan_error", "scan_attempts", "scanned_at",
    ])
    return status


def _report_infection(chat_file) -> None:
    """Malware não é erro silencioso: quem enviou fica sabendo, e a auditoria
    registra — mesma régua do anexo de ticket bloqueado."""
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditAction, AuditLog
    from apps.chat.models import ChatFile
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email

    AuditLog.objects.create(
        actor=chat_file.uploaded_by,
        action=AuditAction.SCAN_BLOCKED,
        content_type=ContentType.objects.get_for_model(ChatFile),
        object_id=str(chat_file.pk),
        summary=(
            f"Anexo de chat '{chat_file.filename}' bloqueado "
            f"(chat #{chat_file.message.chat_id}): {chat_file.scan_signature}"
        ),
        changes={"signature": chat_file.scan_signature, "checksum": chat_file.checksum},
    )

    if chat_file.uploaded_by_id:
        titulo = f"Anexo bloqueado: {chat_file.filename}"
        corpo = (
            "A verificação antivírus identificou uma ameaça neste arquivo, "
            "que não ficará disponível para download."
        )
        url = "/app/chat"
        notify(
            recipient=chat_file.uploaded_by,
            kind=NotificationKind.ATTACHMENT_BLOCKED,
            title=titulo,
            body=corpo,
            url=url,
        )
        if chat_file.uploaded_by.email and quer_email(
            chat_file.uploaded_by, NotificationKind.ATTACHMENT_BLOCKED
        ):
            from django.conf import settings

            queue_email(
                to=chat_file.uploaded_by.email,
                subject=titulo,
                # mesmo template do anexo de ticket: o e-mail é idêntico nos
                # dois canais, só muda o link de volta
                template="attachment_blocked",
                context={
                    "user_name": chat_file.uploaded_by.full_name,
                    "filename": chat_file.filename,
                    "link": f"{settings.SITE_URL}{url}",
                },
                dedupe_key=f"attachment-blocked-chat:{chat_file.pk}",
            )


@shared_task
def notify_queued_chats() -> int:
    """Chat esquecido na fila (ninguém pegou ainda) → aviso PERSISTENTE para
    os agentes com vaga, antes do timeout que converte em ticket.

    `_avisar_fila` (chat_service) já cobre o instante em que o chat ENTRA na
    fila: um popup em tempo real via WebSocket para todo agente conectado
    com vaga. O que faltava é diferente — um chat que fica esperando SEM ser
    pego por um tempo (mas ainda antes da conversão) merece um aviso que não
    se perde se ninguém estava olhando a tela naquele instante: sino +
    e-mail, cada um respeitando a preferência da própria conta. O gatilho é
    a METADE do timeout de fila (mínimo 1 minuto) — dá tempo de alguém agir
    antes da conversão automática, sem ser o mesmo instante dela.

    Sem campo novo para o dedupe: mesma régua de `apps.announcements.tasks`
    — `Notification(recipient, kind, url)` já gravado é "já avisado". Uma
    vez que um agente foi avisado DESTE chat, a rodada seguinte não avisa de
    novo — e como o chat só sai de `esquecidos` ao ser pego ou fechado
    (muda de status), reprocessar o mesmo chat a cada rodada não gera
    notificação repetida.
    """
    from apps.accounts.models import User, UserKind
    from apps.chat.models import Chat, ChatConfig, ChatStatus
    from apps.chat.services.chat_service import sob_o_limite
    from apps.notifications.models import Notification, NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email

    config = ChatConfig.load()
    metade = max(1, config.queue_timeout_minutes / 2)
    corte = timezone.now() - timezone.timedelta(minutes=metade)

    esquecidos = list(
        Chat.objects.filter(status=ChatStatus.QUEUED, queued_at__lt=corte)
        .select_related("client", "company")
    )
    if not esquecidos:
        return 0

    # elegibilidade é por AGENTE, calculada uma vez fora do loop de chats —
    # repetir `sob_o_limite` (uma query) para CADA chat esquecido multiplicaria
    # a mesma consulta à toa (N chats × M agentes vira só M consultas)
    elegiveis = [
        agente for agente in User.objects.filter(kind=UserKind.INTERNAL, is_active=True)
        if sob_o_limite(agente)
    ]
    if not elegiveis:
        return 0

    urls = {chat.pk: f"/chat?chat={chat.pk}" for chat in esquecidos}
    # idem: um SELECT para os pares (agente, chat) já avisados, não um
    # `.exists()` por combinação — o produto chats × agentes pode não ser
    # pequeno numa fila cheia
    ja_avisados = set(
        Notification.objects.filter(
            kind=NotificationKind.CHAT_INCOMING,
            recipient_id__in=[a.pk for a in elegiveis],
            url__in=urls.values(),
        ).values_list("recipient_id", "url")
    )

    avisados = 0
    for chat in esquecidos:
        url = urls[chat.pk]
        titulo = f"Chat aguardando: {chat.client.full_name}"
        corpo = f"Na fila desde {chat.queued_at:%d/%m %H:%M} — {chat.company.name}."
        for agente in elegiveis:
            if (agente.pk, url) in ja_avisados:
                continue
            notify(
                recipient=agente,
                kind=NotificationKind.CHAT_INCOMING,
                title=titulo,
                body=corpo,
                url=url,
            )
            if agente.email and quer_email(agente, NotificationKind.CHAT_INCOMING):
                from django.conf import settings

                queue_email(
                    to=agente.email,
                    subject=titulo,
                    template="chat_incoming",
                    context={
                        "agent_name": agente.full_name,
                        "client_name": chat.client.full_name,
                        "company": chat.company.name,
                        "link": f"{settings.SITE_URL}{url}",
                    },
                    dedupe_key=f"chat-incoming:{chat.pk}:{agente.pk}",
                )
            avisados += 1
    return avisados
