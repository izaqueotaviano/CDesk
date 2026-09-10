"""Camada de aplicação de `notifications`.

Dois canais, um contrato:
- `notify()` — in-app: grava `Notification` e empurra pelo canal pessoal
  (`user_<id>` no UserConsumer) para o badge chegar em qualquer tela.
- `queue_email()` — outbox: grava `OutboundEmail` e agenda o envio por task
  Celery após o commit. `dedupe_key` torna o par gravação+envio idempotente.

Nenhum app manda e-mail ou cria Notification direto — sempre por aqui.
"""

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import IntegrityError, transaction

from apps.notifications.models import Notification, NotificationPreference, OutboundEmail


def _preferencias(user) -> NotificationPreference | None:
    return NotificationPreference.objects.filter(user=user).first()


def quer_in_app(user, kind) -> bool:
    """A preferência da conta VALE: tipo desligado não gera notificação.
    Sem preferência gravada (ou tipo ausente do dict), o padrão é ligado."""
    pref = _preferencias(user)
    if pref is None:
        return True
    return bool(pref.in_app.get(str(kind), True))


def quer_email(user, kind) -> bool:
    """Idem para o canal de e-mail — consultado por quem monta o e-mail de
    notificação (e-mails operacionais, como código de login, não passam
    por aqui: não são notificação, são o próprio serviço)."""
    pref = _preferencias(user)
    if pref is None:
        return True
    return bool(pref.email.get(str(kind), True))


def notify(*, recipient, kind, title, body="", url="", ticket=None, actor=None):
    if not quer_in_app(recipient, kind):
        return None
    notification = Notification.objects.create(
        recipient=recipient, kind=kind, title=title, body=body, url=url,
        ticket=ticket, actor=actor,
    )
    _push(recipient.pk, {
        "kind": kind,
        "notification_id": notification.pk,
        "title": title,
        "body": body,
        "url": url,
        "ticket_id": ticket.pk if ticket else None,
    })
    return notification


def already_notified(*, recipient, kind, ticket, since=None) -> bool:
    """Evita spam de avisos repetidos (ex.: SLA warning a cada varredura).

    `since` recomeça a régua: depois de uma reabertura, o alerta antigo não
    pode calar o estouro do prazo NOVO — quem chama passa o instante da
    reabertura e só avisos posteriores a ele contam como "já avisado"."""
    qs = Notification.objects.filter(recipient=recipient, kind=kind, ticket=ticket)
    if since is not None:
        qs = qs.filter(created_at__gte=since)
    return qs.exists()


def queue_email(*, to, subject, template, context, ticket=None, dedupe_key=None):
    """Grava no outbox e agenda envio no commit. Retorna None se deduplicado."""
    if not to:
        return None
    try:
        # atomic PRÓPRIO (savepoint): capturar IntegrityError dentro da
        # transação de quem chamou, sem isto, envenena a transação inteira —
        # o Django desfazia TUDO do chamador em silêncio na saída do bloco
        # (visto ao vivo: dedupe colidiu e a mudança de status do ticket
        # evaporou junto).
        with transaction.atomic():
            email = OutboundEmail.objects.create(
                to_email=to, subject=subject, template=template, context=context,
                ticket=ticket, dedupe_key=dedupe_key,
            )
    except IntegrityError:
        return None  # já enfileirado por outra transação

    from apps.notifications.tasks import send_outbound_email
    transaction.on_commit(lambda: send_outbound_email.delay(email.pk))
    return email


def _push(user_id: int, payload: dict) -> None:
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f"user_{user_id}", {"type": "notify", **payload}
    )


def broadcast_ticket_event(*, ticket, kind: str, actor=None) -> None:
    """DICA de que o ticket mudou, empurrada pelo ws/me/ de quem o acompanha.

    Ao contrário de `notify()`, NÃO persiste, NÃO respeita preferência e NÃO
    vira sino: é só "o ticket X mudou (kind)", para o front revalidar por REST
    (`invalidateQueries`). Mantém o princípio de docs/07 — "evento é dica, REST
    é a verdade": o payload não carrega conteúdo, então mandar a dica ao próprio
    solicitante é seguro (o refetch dele é mascarado no backend como sempre).

    Sai só depois do commit (on_commit): reconectar/revalidar antes da escrita
    estar visível traria o estado velho. `actor` é excluído — quem agiu já tem
    a resposta REST da própria ação.
    """
    layer = get_channel_layer()
    if layer is None:
        return

    destinos: set[int] = set()
    for uid in (ticket.requester_id, ticket.assignee_id, ticket.owner_id):
        if uid:
            destinos.add(uid)
    destinos.update(ticket.watchers.values_list("user_id", flat=True))
    if actor is not None:
        destinos.discard(actor.pk)
    if not destinos:
        return

    ticket_id = ticket.pk

    def _enviar() -> None:
        for uid in destinos:
            async_to_sync(layer.group_send)(
                f"user_{uid}",
                {"type": "ticket_event", "ticket_id": ticket_id, "kind": kind},
            )

    transaction.on_commit(_enviar)
