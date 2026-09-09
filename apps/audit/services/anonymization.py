"""Anonimização de titular (D11).

Anonimizar ≠ apagar. As linhas ficam, as FKs continuam válidas, as contagens de
relatório não mudam, e o histórico das outras empresas fica intacto. O que sai é
o vínculo com a pessoa.

Três camadas, em ordem de dificuldade:

1. **Campos estruturados** (`User`, `Company`) — sobrescrever é trivial e exato.
2. **Binários** (anexos) — não dá para "anonimizar" um PDF: ou o blob sai ou
   fica. Sai, mantendo a linha (`purged_at`).
3. **Texto livre** (assunto e corpo de mensagem) — é onde mora o CPF digitado à
   mão. Aqui a varredura é **assistida, não automática**: o serviço *encontra*
   os candidatos e o admin decide. Regex que apaga sozinho destrói conteúdo
   legítimo de forma irreversível, e "irreversível" é a palavra que desqualifica
   o automático.
"""

from __future__ import annotations

import logging
import re

from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

REDACTED = "[redigido a pedido do titular]"

# Padrões de PII brasileira em texto livre. Servem para SUGERIR revisão —
# nenhum deles apaga nada sozinho.
PII_PATTERNS = {
    "cpf": re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b"),
    "cnpj": re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b"),
    "email": re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"),
    "telefone": re.compile(r"\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b"),
    "cartao": re.compile(r"\b(?:\d{4}[\s-]?){3}\d{4}\b"),
}


def anonymize(dsr) -> dict:
    """Executa o pedido. Devolve o inventário do que foi tocado."""
    from apps.accounts.models import User

    with transaction.atomic():
        users = _subjects(dsr, User)
        touched = {
            "users": [],
            "company": None,
            "attachments_purged": 0,
            "chat_messages_redacted": 0,
            "free_text_candidates": [],
        }

        for user in users:
            if user.anonymized_at:
                continue
            _scrub_user(user)
            touched["users"].append(user.pk)

        if dsr.subject_company_id:
            touched["company"] = _scrub_company(dsr.subject_company)

        touched["attachments_purged"] = _purge_attachments(users)
        touched["chat_messages_redacted"] = _redact_chat(users)
        touched["free_text_candidates"] = find_free_text_pii(users)

    logger.info(
        "LGPD: %s usuário(s), %s anexo(s), %s mensagem(ns) de chat",
        len(touched["users"]), touched["attachments_purged"],
        touched["chat_messages_redacted"],
    )
    return touched


def _subjects(dsr, user_model) -> list:
    """Pedido de empresa arrasta todos os usuários dela — mas só quando a
    empresa é o alvo explícito, nunca como efeito colateral."""
    if dsr.subject_user_id:
        return [dsr.subject_user]
    if dsr.subject_company_id:
        return list(user_model.objects.filter(company_id=dsr.subject_company_id))
    return []


def _scrub_user(user) -> None:
    # o pk fica embutido no e-mail: pseudônimo estável. Sem ele, dois titulares
    # anonimizados viram indistinguíveis e a auditoria perde a capacidade de
    # dizer "estas 40 ações foram da mesma pessoa".
    user.full_name = "Usuário anonimizado"
    user.email = f"anonimizado-{user.pk}@anonimizado.invalid"
    user.phone = ""
    user.job_title = ""
    user.avatar_url = ""
    user.google_sub = None
    user.is_active = False
    user.anonymized_at = timezone.now()
    user.set_unusable_password()
    user.save()


def _scrub_company(company) -> int:
    company.legal_name = ""
    company.tax_id = None
    company.notes = ""
    company.is_active = False
    company.anonymized_at = timezone.now()
    company.save(update_fields=[
        "legal_name", "tax_id", "notes", "is_active", "anonymized_at",
    ])
    return company.pk


def _purge_attachments(users) -> int:
    """Anexos enviados pelo titular: blob sai, linha fica."""
    from apps.tickets.models import TicketAttachment
    from apps.tickets.services.attachments import purge_blob

    if not users:
        return 0
    queryset = TicketAttachment.objects.filter(
        uploaded_by__in=users, purged_at__isnull=True
    )
    return sum(1 for attachment in queryset if purge_blob(attachment))


def _redact_chat(users) -> int:
    """Chat é conversa do titular como qualquer outra — não podia ficar de fora.

    Três lugares, não um. O corpo das mensagens que o titular ESCREVEU é o
    óbvio; os outros dois passavam batido e guardam texto livre dele do mesmo
    jeito:

    - a **justificativa da avaliação**, que é o titular escrevendo o que achou
      do atendimento (a NOTA fica: é número, sustenta métrica e não identifica
      ninguém sozinha);
    - a **observação de encerramento** da equipe nos chats DELE, que costuma
      citar o caso pelo nome — "cliente pediu estorno do pedido 998".

    O que a equipe escreveu NA CONVERSA não é apagado: aquilo é fala de outra
    pessoa, e um pedido do titular não apaga o registro de terceiros. O que
    some é o que é dele.
    """
    from apps.chat.models import Chat, ChatMessage, ChatRating

    if not users:
        return 0

    tocados = ChatMessage.objects.filter(
        author__in=users, is_system=False
    ).exclude(body=REDACTED).update(body=REDACTED)

    tocados += (
        ChatRating.objects.filter(chat__client__in=users)
        .exclude(justification="")
        .exclude(justification=REDACTED)
        .update(justification=REDACTED)
    )

    tocados += (
        Chat.objects.filter(client__in=users)
        .exclude(close_note="")
        .exclude(close_note=REDACTED)
        .update(close_note=REDACTED)
    )
    return tocados


def find_free_text_pii(users) -> list[dict]:
    """Encontra PII provável em assunto/corpo — **não** altera nada.

    A saída alimenta a tela de redação assistida: o admin vê o trecho, o
    padrão que casou, e decide. É mais lento que regex automático e é o único
    caminho que não apaga o que não devia.
    """
    from apps.tickets.models import Ticket, TicketMessage

    if not users:
        return []

    found = []
    tickets = Ticket.objects.filter(requester__in=users).exclude(
        retention_purged_at__isnull=False
    )
    for ticket in tickets.only("pk", "reference", "subject"):
        for label in _match_labels(ticket.subject):
            found.append({
                "model": "ticket", "pk": ticket.pk, "field": "subject",
                "reference": ticket.reference, "pattern": label,
            })

    messages = TicketMessage.objects.filter(author__in=users).select_related("ticket")
    for message in messages.only("pk", "body", "ticket__reference"):
        for label in _match_labels(message.body):
            found.append({
                "model": "message", "pk": message.pk, "field": "body",
                "reference": message.ticket.reference, "pattern": label,
            })

    # O CHAT faltava aqui: a revisão assistida varria só o chamado, e quem
    # mandou o CPF por chat passava batido — o admin aprovava uma lista que
    # dizia "nada encontrado" sobre metade do conteúdo do titular.
    from apps.chat.models import ChatMessage

    chat_messages = (
        ChatMessage.objects.filter(author__in=users, is_system=False)
        .exclude(body=REDACTED)
        .select_related("chat")
    )
    for message in chat_messages.only("pk", "body", "chat_id"):
        for label in _match_labels(message.body):
            found.append({
                "model": "chat_message", "pk": message.pk, "field": "body",
                "reference": f"Chat #{message.chat_id}", "pattern": label,
            })

    return found


def _match_labels(text: str) -> list[str]:
    if not text:
        return []
    return [name for name, pattern in PII_PATTERNS.items() if pattern.search(text)]


def redact_free_text(*, model: str, pk: int, actor) -> bool:
    """Redige um campo específico, guardando o original na auditoria.

    O original vai para `AuditLog.changes`: sem isso, uma redação equivocada é
    irreversível e ninguém consegue nem dizer o que havia ali.
    """
    from django.contrib.contenttypes.models import ContentType

    from apps.audit.models import AuditAction, AuditLog
    from apps.chat.models import ChatMessage
    from apps.tickets.models import Ticket, TicketMessage

    if model == "ticket":
        obj, field = Ticket.objects.filter(pk=pk).first(), "subject"
    elif model == "message":
        obj, field = TicketMessage.objects.filter(pk=pk).first(), "body"
    elif model == "chat_message":
        obj, field = ChatMessage.objects.filter(pk=pk).first(), "body"
    else:
        raise ValueError(f"Alvo de redação desconhecido: {model!r}")

    if obj is None:
        return False
    original = getattr(obj, field)
    if original == REDACTED:
        return False

    setattr(obj, field, REDACTED)
    obj.save(update_fields=[field])

    AuditLog.objects.create(
        actor=actor,
        action=AuditAction.ANONYMIZE,
        content_type=ContentType.objects.get_for_model(obj),
        object_id=str(obj.pk),
        summary=f"Redação de {field} a pedido do titular",
        changes={field: [original, REDACTED]},
    )
    return True
