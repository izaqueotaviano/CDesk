"""Métricas do atendimento por chat — a leitura gerencial que faltava.

Irmã de `apps.reports.services.chat_stats`, que responde "quantos chats cada
agente atendeu ao longo do tempo". Aqui a pergunta é outra: **como foram** os
atendimentos de um período — quanto se esperou, quanto durou, como
terminaram e que nota tiraram.

Três decisões que mudam o que os números significam:

1. **O recorte é por ENCERRAMENTO, não por abertura.** Um chat aberto ontem
   e fechado hoje pertence a hoje: as medidas de duração e desfecho só
   existem depois que ele fecha, e contá-lo pela abertura deixaria o mês
   passado mudando de valor conforme conversas antigas vão terminando.

2. **Espera e duração saem de carimbos, não de campos.** `queued_at →
   accepted_at` é a espera; `accepted_at → closed_at` é a duração. Guardar
   os dois como colunas seria uma segunda verdade para discordar da
   primeira na primeira reabertura.

3. **A MEDIANA acompanha a média.** Numa fila de atendimento a média mente
   com facilidade: um chat esquecido aberto no fim de semana leva a média
   de espera para as alturas enquanto a experiência de quase todo mundo foi
   outra. As duas juntas dizem se houve outlier.
"""

from __future__ import annotations

import datetime as dt

from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.db.models.functions import Extract, TruncDate

from apps.chat.models import Chat, ChatRating, ChatStatus


def _minutos(campo_fim: str, campo_inicio: str):
    """Diferença entre dois carimbos, em MINUTOS, como número.

    Passa por `Extract('epoch')` e não por uma divisão de intervalos: o
    Postgres não define `interval / interval`, e dividir por um timedelta
    literal estoura no banco. Somar `Avg()` sobre o intervalo cru também
    devolveria um timedelta, e a tela quer número.
    """
    intervalo = ExpressionWrapper(
        F(campo_fim) - F(campo_inicio), output_field=DurationField()
    )
    return Extract(intervalo, "epoch") / 60.0


def _mediana(valores: list[float]) -> float | None:
    if not valores:
        return None
    ordenados = sorted(valores)
    meio = len(ordenados) // 2
    if len(ordenados) % 2:
        return round(ordenados[meio], 1)
    return round((ordenados[meio - 1] + ordenados[meio]) / 2, 1)


def _arredonda(v) -> float | None:
    return round(v, 1) if v is not None else None


def metricas(*, desde: dt.datetime, ate: dt.datetime, agente=None) -> dict:
    """Os números do período, prontos para a tela.

    `agente` recorta por quem atendeu — a mesma pergunta feita de uma pessoa
    só. Não há recorte por empresa aqui de propósito: a fila do chat é única
    (ver `chat_service.visible_chats`), e um filtro que a tela não tem seria
    peso morto no contrato.
    """
    encerrados = Chat.objects.filter(
        status=ChatStatus.CLOSED, closed_at__gte=desde, closed_at__lt=ate
    )
    if agente is not None:
        encerrados = encerrados.filter(agent=agente)

    # Atendidos de verdade: sem `accepted_at` ninguém pegou, e um chat que
    # virou ticket por timeout não diz nada sobre a qualidade do atendimento
    # — ele diz sobre a fila, e está contado à parte em `nao_atendidos`.
    atendidos = encerrados.filter(accepted_at__isnull=False)

    esperas = list(
        atendidos.annotate(v=_minutos("accepted_at", "queued_at")).values_list("v", flat=True)
    )
    duracoes = list(
        atendidos.filter(closed_at__isnull=False)
        .annotate(v=_minutos("closed_at", "accepted_at"))
        .values_list("v", flat=True)
    )

    notas = ChatRating.objects.filter(chat__in=atendidos)
    resumo_notas = notas.aggregate(
        media_atendimento=Avg("service_score"),
        media_resolucao=Avg("resolution_score"),
        total=Count("pk"),
    )

    total = encerrados.count()
    return {
        "periodo": {"desde": desde.isoformat(), "ate": ate.isoformat()},
        "total": total,
        "atendidos": atendidos.count(),
        # Nunca pegos: viraram ticket pelo timeout de fila. Ficam separados
        # porque misturá-los na média de espera contaria como "espera" um
        # atendimento que não aconteceu.
        "nao_atendidos": encerrados.filter(accepted_at__isnull=True).count(),
        "encerrados_automaticamente": encerrados.filter(closed_automatically=True).count(),
        "reabertos": encerrados.filter(reopen_count__gt=0).count(),
        "espera_minutos": {
            "media": _arredonda(sum(esperas) / len(esperas)) if esperas else None,
            "mediana": _mediana(esperas),
        },
        "duracao_minutos": {
            "media": _arredonda(sum(duracoes) / len(duracoes)) if duracoes else None,
            "mediana": _mediana(duracoes),
        },
        "avaliacao": {
            "respondidas": resumo_notas["total"],
            # quantos DEIXARAM de avaliar importa tanto quanto a nota: uma
            # média 9 sobre 5% dos atendimentos não é uma média 9
            "sem_resposta": atendidos.count() - resumo_notas["total"],
            "media_atendimento": _arredonda(resumo_notas["media_atendimento"]),
            "media_resolucao": _arredonda(resumo_notas["media_resolucao"]),
            "detratoras": notas.filter(service_score__lte=6).count(),
        },
        "por_motivo": _por_motivo(encerrados),
        "por_agente": _por_agente(atendidos),
        "por_dia": _por_dia(encerrados),
    }


def _por_motivo(qs) -> list[dict]:
    """Desfechos, do mais comum ao menos. "Sem motivo" entra na lista em vez
    de sumir: se metade dos encerramentos não tem motivo, é isso que a tela
    precisa mostrar — e não uma lista curta que parece completa."""
    linhas = (
        qs.values("close_reason", "close_reason__name")
        .annotate(total=Count("pk"))
        .order_by("-total")
    )
    return [
        {
            "id": ligacao["close_reason"],
            "nome": ligacao["close_reason__name"] or "Sem motivo",
            "total": ligacao["total"],
        }
        for ligacao in linhas
    ]


def _por_agente(qs) -> list[dict]:
    linhas = (
        qs.filter(agent__isnull=False)
        .values("agent", "agent__full_name")
        .annotate(
            total=Count("pk"),
            media_nota=Avg("rating__service_score"),
            duracao=Avg(_minutos("closed_at", "accepted_at"), filter=Q(closed_at__isnull=False)),
        )
        .order_by("-total")
    )
    return [
        {
            "id": ligacao["agent"],
            "nome": ligacao["agent__full_name"],
            "total": ligacao["total"],
            "media_nota": _arredonda(ligacao["media_nota"]),
            "duracao_media": _arredonda(ligacao["duracao"]),
        }
        for ligacao in linhas
    ]


def _por_dia(qs) -> list[dict]:
    """Volume por dia, para o gráfico. Só os dias COM atendimento — preencher
    os vazios é trabalho da tela, que sabe o intervalo pedido; devolvê-los
    daqui inflaria a resposta de um recorte anual sem dizer nada novo."""
    linhas = (
        qs.annotate(dia=TruncDate("closed_at"))
        .values("dia")
        .annotate(total=Count("pk"))
        .order_by("dia")
    )
    return [{"dia": ligacao["dia"].isoformat(), "total": ligacao["total"]} for ligacao in linhas]
