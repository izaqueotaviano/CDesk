"""Pesquisa de satisfação (CSAT 0–10).

Fluxo: o ticket fecha → nasce a pesquisa → a nota alimenta o painel de
indicadores. Uma porta só para responder: **o portal, logado**.
`pending_for()` lista as pesquisas do próprio solicitante ainda sem
resposta, e é isso que faz o aviso aparecer na home e o botão aparecer na
tela do chamado.

Não existe avaliação por e-mail. Havia um convite com link e um endpoint
público que respondia por token, sem login; os dois saíram por decisão de
produto — a nota é dada dentro do portal, por quem já está autenticado.
Com isso saiu o único endpoint que servia DADO DE TICKET sem sessão: os
`AllowAny` que restam são os do próprio login (entrar, 2FA, reenvio), que
por definição atendem quem ainda não tem sessão.

Três decisões que valem registro:

- **Uma pesquisa por ticket.** Reabrir e fechar de novo NÃO gera outra: seria
  duas notas para o mesmo atendimento, e a média mentiria. O modelo é OneToOne
  justamente para o banco garantir isso.
- **Resposta única.** Depois de respondida não aceita nova nota — senão
  bastaria repetir a chamada para inflar o indicador.
- **A pesquisa não depende de e-mail.** Enquanto o convite existia, quem não
  tinha e-mail cadastrado não ganhava pesquisa nenhuma (não havia para onde
  mandar). Agora a nota é dada no portal, então a pesquisa nasce para todo
  solicitante — o e-mail deixou de ser condição.
"""

import secrets

from django.utils import timezone

from apps.core.models import SystemConfig

TOKEN_BYTES = 32  # ~43 caracteres em base64url


class SurveyClosed(Exception):
    """Pesquisa expirada ou já respondida — a view devolve 409."""


def create_for_ticket(ticket):
    """Cria a pesquisa do ticket. Idempotente."""
    from apps.tickets.models import SatisfactionSurvey

    config = SystemConfig.load()
    if not config.csat_enabled:
        return None

    survey, _ = SatisfactionSurvey.objects.get_or_create(
        ticket=ticket,
        defaults={
            "token": secrets.token_urlsafe(TOKEN_BYTES),
            "expires_at": timezone.now()
            + timezone.timedelta(days=config.csat_expires_days),
        },
    )
    return survey


def answer(survey, *, score: int, comment: str = ""):
    """Registra a nota. Levanta `SurveyClosed` se expirada ou já respondida."""
    if survey.is_answered:
        raise SurveyClosed("Esta pesquisa já foi respondida.")
    if survey.is_expired:
        raise SurveyClosed("O prazo para responder esta pesquisa terminou.")
    if not 0 <= score <= 10:
        raise ValueError("Nota deve estar entre 0 e 10.")

    survey.score = score
    survey.comment = comment[:2000]
    survey.responded_at = timezone.now()
    survey.save(update_fields=["score", "comment", "responded_at"])
    return survey


def pending_for(client):
    """Pesquisas do PRÓPRIO solicitante, sem resposta e ainda no prazo —
    é o que faz o aviso aparecer na home e o botão na tela do chamado.

    Escopo por `requester`, não por empresa: só quem abriu o chamado dá a
    nota dele (mesma regra do chat, onde só quem abriu a conversa avalia)."""
    from apps.tickets.models import SatisfactionSurvey

    return (
        SatisfactionSurvey.objects.filter(
            ticket__requester=client,
            responded_at__isnull=True,
            expires_at__gt=timezone.now(),
        )
        .select_related("ticket")
        .order_by("ticket__closed_at")
    )


def summarize(queryset):
    """Agregado para o painel: distribuição 0–10, total e média.

    Só conta o que foi RESPONDIDO — dividir por pesquisas enviadas misturaria
    "nota baixa" com "não respondeu", que são coisas diferentes.
    """
    respondidas = [s for s in queryset if s.score is not None]
    dist = {n: 0 for n in range(11)}
    for s in respondidas:
        dist[s.score] += 1
    total = len(respondidas)
    return {
        "enviadas": len(queryset),
        "respostas": total,
        "media": round(sum(s.score for s in respondidas) / total, 2) if total else None,
        "distribuicao": dist,
    }
