"""Portabilidade de dados do titular (LGPD art. 18 §V e art. 19).

Entrega um ZIP com três coisas:

- `dados.json` — legível por máquina, que é o que a lei pede ao falar em
  "formato que permita a portabilidade";
- `dados.html` — legível por humano, que é o que o titular realmente quer;
- `anexos/` — os arquivos que o **próprio titular** enviou.

⚠️ Desvio do desenho: o doc 09 falava em JSON + PDF. Virou JSON + HTML dentro
de um ZIP porque PDF exigiria WeasyPrint, que é extra opcional (`.[reports]`) e
não está instalado por padrão — a portabilidade falharia numa instalação limpa
justamente no pedido que tem prazo legal. HTML abre em qualquer navegador e
imprime em PDF de lá.

O cuidado que importa neste módulo é o que **não** entra. Um export de LGPD é
uma via legítima de exfiltração se o escopo for frouxo: o titular pede os
"próprios" dados e leva junto nota interna, ticket de colega e o telefone
pessoal do agente que o atendeu.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import logging
import zipfile
from html import escape

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils import timezone

logger = logging.getLogger(__name__)

# o que deliberadamente fica de fora — vai no próprio JSON, para o titular
# saber que houve recorte e por quê
EXCLUSIONS = [
    "Notas internas da equipe (não são comunicação dirigida a você).",
    "Tickets de outros usuários da sua empresa.",
    "Tickets de equipe restrita abertos por outra pessoa.",
    "Dados de contato pessoal dos agentes (o nome de quem atendeu é mantido).",
]


def build_export(dsr) -> dict:
    """Monta o pacote e grava em `dsr.export_file`. Devolve o inventário."""
    payload = collect(dsr)
    archive, attachment_count = _zip(payload, dsr)

    stamp = timezone.now().strftime("%Y%m%d-%H%M%S")
    dsr.export_file.save(f"lgpd-{dsr.pk}-{stamp}.zip", ContentFile(archive), save=False)
    dsr.export_expires_at = timezone.now() + dt.timedelta(
        days=settings.RETENTION_DAYS["lgpd_export_file"]
    )
    dsr.save(update_fields=["export_file", "export_expires_at"])

    return {
        "tickets": len(payload["tickets"]),
        "chats": len(payload["chats"]),
        "attachments": attachment_count,
        "expires_at": dsr.export_expires_at.isoformat(),
    }


def collect(dsr) -> dict:
    """Levanta os dados do titular respeitando o escopo."""
    from apps.chat.models import Chat, ChatMessage
    from apps.tickets.models import Ticket, TicketAttachment

    user = dsr.subject_user
    if user is None:
        # pedido de empresa não é portabilidade de titular: a empresa não é
        # "o titular" no sentido da lei, e devolver tudo dela vazaria dado de
        # todos os funcionários para quem pediu.
        raise ValueError(
            "Exportação exige um usuário titular; pedido de empresa não se aplica."
        )

    tickets = (
        Ticket.objects.filter(requester=user)
        .select_related("team", "company")
        .prefetch_related("messages__author")
        .order_by("created_at")
    )

    ticket_payload = []
    for ticket in tickets:
        ticket_payload.append({
            "referencia": ticket.reference,
            "assunto": ticket.subject,
            "equipe": ticket.team.name,
            "status": ticket.get_status_display(),
            "prioridade": ticket.get_priority_display(),
            "aberto_em": _iso(ticket.created_at),
            "fechado_em": _iso(ticket.closed_at),
            "mensagens": [
                {
                    "autor": _author_label(message),
                    "em": _iso(message.created_at),
                    "texto": message.body,
                }
                # nota interna nunca sai: não é comunicação dirigida ao titular
                for message in ticket.messages.all() if message.is_public
            ],
        })

    chats = Chat.objects.filter(client=user).order_by("queued_at")
    chat_payload = []
    for chat in chats:
        chat_payload.append({
            "iniciado_em": _iso(chat.queued_at),
            "encerrado_em": _iso(chat.closed_at),
            "mensagens": [
                {"autor": _author_label(m), "em": _iso(m.sent_at), "texto": m.body}
                for m in ChatMessage.objects.filter(chat=chat).order_by("id")
            ],
        })

    attachments = TicketAttachment.objects.filter(
        uploaded_by=user, purged_at__isnull=True
    ).select_related("message__ticket")

    return {
        "gerado_em": _iso(timezone.now()),
        "pedido": {"id": dsr.pk, "tipo": dsr.get_kind_display()},
        "titular": {
            "nome": user.full_name,
            "email": user.email,
            "telefone": user.phone,
            "cargo": user.job_title,
            "empresa": user.company.name if user.company_id else None,
            "cadastrado_em": _iso(user.created_at),
            "ultimo_acesso": _iso(user.last_login),
            "visto_por_ultimo_em": _iso(user.last_seen_at),
        },
        "tickets": ticket_payload,
        "chats": chat_payload,
        "anexos": [
            {
                "arquivo": a.filename,
                "tamanho_bytes": a.size_bytes,
                "ticket": a.message.ticket.reference,
                "enviado_em": _iso(a.created_at),
            }
            for a in attachments
        ],
        "nao_incluido": EXCLUSIONS,
        "politica_de_dados": {
            "retencao_ticket_anos": round(
                settings.RETENTION_DAYS["ticket_after_close"] / 365
            ),
            "retencao_descricao": (
                "Tickets fechados são mantidos por este período; depois disso o "
                "conteúdo é expurgado e só permanecem os dados estatísticos."
            ),
            "backup_rotacao_dias": settings.BACKUP_ROTATION_DAYS,
            "backup_descricao": (
                "Cópias de segurança são rotacionadas neste prazo. Uma exclusão "
                "solicitada hoje sai do banco imediatamente e se completa nos "
                "backups ao fim da rotação."
            ),
            "validade_deste_pacote_dias": settings.RETENTION_DAYS["lgpd_export_file"],
        },
        "_attachment_objects": list(attachments),  # removido antes de serializar
    }


def _author_label(message) -> str:
    """Nome do agente fica (é parte do histórico do titular); contato dele, não."""
    author = getattr(message, "author", None)
    if author is None:
        return "Sistema"
    return author.full_name


def _iso(value) -> str | None:
    return value.isoformat() if value else None


def _zip(payload: dict, dsr) -> tuple[bytes, int]:
    attachments = payload.pop("_attachment_objects", [])

    buffer = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "dados.json", json.dumps(payload, ensure_ascii=False, indent=2)
        )
        archive.writestr("dados.html", _html(payload))

        seen = set()
        for attachment in attachments:
            if not attachment.file:
                continue
            name = attachment.filename
            # dois arquivos com o mesmo nome não podem se sobrescrever no ZIP
            if name in seen:
                name = f"{attachment.pk}-{name}"
            seen.add(name)
            try:
                with attachment.file.open("rb") as handle:
                    archive.writestr(f"anexos/{name}", handle.read())
                count += 1
            except (FileNotFoundError, OSError):
                logger.warning("Anexo %s ausente no storage, ignorado", attachment.pk)

    return buffer.getvalue(), count


def _html(payload: dict) -> str:
    """Versão para gente ler. Sem CSS externo: o arquivo precisa funcionar
    offline, dentro de um ZIP, anos depois."""
    titular = payload["titular"]
    parts = [
        "<!doctype html><meta charset='utf-8'>",
        "<title>Seus dados · Resolv</title>",
        "<style>body{font:15px/1.6 system-ui,sans-serif;max-width:52rem;"
        "margin:2rem auto;padding:0 1rem;color:#141413}"
        "h1,h2{line-height:1.25}h2{margin-top:2.5rem;border-bottom:1px solid #ddd;"
        "padding-bottom:.3rem}.msg{border-left:3px solid #ddd;padding:.2rem 0 .2rem .8rem;"
        "margin:.8rem 0}.meta{color:#666;font-size:13px}</style>",
        "<h1>Seus dados no Resolv</h1>",
        f"<p class='meta'>Gerado em {escape(payload['gerado_em'] or '')}.</p>",
        "<h2>Cadastro</h2><ul>",
    ]
    for label, value in titular.items():
        parts.append(f"<li><b>{escape(label)}:</b> {escape(str(value or '—'))}</li>")
    parts.append("</ul>")

    parts.append(f"<h2>Tickets ({len(payload['tickets'])})</h2>")
    for ticket in payload["tickets"]:
        parts.append(
            f"<h3>{escape(ticket['referencia'])}: {escape(ticket['assunto'])}</h3>"
            f"<p class='meta'>{escape(ticket['equipe'])} · "
            f"{escape(ticket['status'])} · aberto em {escape(ticket['aberto_em'] or '')}</p>"
        )
        for message in ticket["mensagens"]:
            parts.append(
                f"<div class='msg'><span class='meta'>{escape(message['autor'])} · "
                f"{escape(message['em'] or '')}</span><br>{escape(message['texto'])}</div>"
            )

    if payload["chats"]:
        parts.append(f"<h2>Conversas de chat ({len(payload['chats'])})</h2>")
        for session in payload["chats"]:
            # Chat não tem assunto (só ticket tem) — achado real testando
            # a tela nova de Auditoria ao vivo: `collect()` nunca gravou
            # essa chave em chat_payload, então isto aqui sempre estourava
            # KeyError pra qualquer titular com ao menos uma conversa.
            inicio = escape(session["iniciado_em"] or "data desconhecida")
            parts.append(f"<h3>Conversa iniciada em {inicio}</h3>")
            for message in session["mensagens"]:
                parts.append(
                    f"<div class='msg'><span class='meta'>{escape(message['autor'])}"
                    f"</span><br>{escape(message['texto'])}</div>"
                )

    parts.append(f"<h2>Anexos ({len(payload['anexos'])})</h2><ul>")
    for attachment in payload["anexos"]:
        parts.append(
            f"<li>{escape(attachment['arquivo'])} "
            f"<span class='meta'>({attachment['tamanho_bytes']} bytes, "
            f"ticket {escape(attachment['ticket'])})</span></li>"
        )
    parts.append("</ul><h2>O que não está incluído</h2><ul>")
    for item in payload["nao_incluido"]:
        parts.append(f"<li>{escape(item)}</li>")
    parts.append("</ul>")

    policy = payload["politica_de_dados"]
    parts.append(
        "<h2>Por quanto tempo guardamos</h2><ul>"
        f"<li><b>{policy['retencao_ticket_anos']} anos</b> após o fechamento do "
        f"ticket. {escape(policy['retencao_descricao'])}</li>"
        f"<li><b>{policy['backup_rotacao_dias']} dias</b> de rotação de backup. "
        f"{escape(policy['backup_descricao'])}</li>"
        f"<li>Este pacote expira em <b>{policy['validade_deste_pacote_dias']} "
        "dias</b>.</li></ul>"
    )

    return "".join(parts)
