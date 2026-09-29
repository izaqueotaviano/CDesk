"""Posição na fila do chat, como o CLIENTE a vê.

"Aguardando um atendente" sozinho não responde à pergunta de quem espera:
vale esperar ou é melhor abrir um chamado? A resposta honesta tem dois
números — quantos estão na frente e quanto isso costuma levar — e um caso
especial: fora do expediente não há ninguém para pegar, então a estimativa
some e a tela diz quando o atendimento volta.

Três decisões:

1. **A fila é única** (ver `apps/chat/models.py`): não há equipe nem
   prioridade na ordem, só a chegada. A posição é "quantos chats na fila
   entraram antes do meu" + 1, com o `id` desempatando dois `queued_at`
   iguais — a mesma ordem da fila do console (`order_by("queued_at")`).

2. **Só números saem daqui.** Nada de id, nome ou empresa de quem está na
   frente: o cliente descobre QUANTOS, nunca QUEM. O aviso ao vivo vai para
   a sala de CADA chat (`chat_<id>`), com a posição daquele chat e mais
   nada — a sala só tem o dono e quem atende.

3. **A estimativa sai do tempo de espera recente**, e some quando não há
   base: menos de `AMOSTRA_MINIMA` atendimentos nos últimos
   `JANELA_DIAS` dias não é histórico, é chute. Usa a MEDIANA, pelo mesmo
   motivo de `services/metrics.py`: um chat esquecido no fim de semana
   levaria a média para as alturas e prometeria uma espera que quase
   ninguém teve. A conta é propositalmente simples (espera típica × posição):
   é uma ordem de grandeza para decidir entre esperar e voltar depois, e a
   tela a escreve como "cerca de".
"""

from __future__ import annotations

import datetime as dt
import math

from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone

from apps.chat.models import Chat, ChatStatus

#: Quantos atendimentos recentes entram na conta da espera típica.
AMOSTRA_MAXIMA = 20
#: Abaixo disto não há estimativa — a tela mostra só a posição.
AMOSTRA_MINIMA = 3
#: O que conta como "recente": a fila de um mês atrás não diz nada de hoje.
JANELA_DIAS = 7

_CHAVE_ESPERA = "chat:fila:espera-tipica"
_SEM_BASE = "sem-base"  # o cache não distingue None de "não calculado"


def posicao_na_fila(chat: Chat) -> int | None:
    """1 = o próximo a ser atendido. `None` fora da fila."""
    if chat.status != ChatStatus.QUEUED:
        return None
    na_frente = Chat.objects.filter(status=ChatStatus.QUEUED).filter(
        Q(queued_at__lt=chat.queued_at) | Q(queued_at=chat.queued_at, pk__lt=chat.pk)
    )
    return na_frente.count() + 1


def fila_em_ordem() -> list[int]:
    """Os ids da fila, do primeiro ao último — uma consulta para N posições."""
    return list(
        Chat.objects.filter(status=ChatStatus.QUEUED)
        .order_by("queued_at", "pk")
        .values_list("pk", flat=True)
    )


def espera_tipica_minutos(agora: dt.datetime | None = None) -> float | None:
    """Mediana de `queued_at → accepted_at` dos atendimentos recentes.

    Cacheada por um minuto: a fila muda a cada chat pego, e cada mudança
    recalcula a posição de todo mundo — refazer esta consulta por chat
    esperando seria a mesma conta N vezes.
    """
    guardado = cache.get(_CHAVE_ESPERA)
    if guardado is not None:
        return None if guardado == _SEM_BASE else guardado

    agora = agora or timezone.now()
    pares = (
        Chat.objects.filter(
            accepted_at__isnull=False,
            accepted_at__gte=agora - dt.timedelta(days=JANELA_DIAS),
        )
        .order_by("-accepted_at")
        .values_list("queued_at", "accepted_at")[:AMOSTRA_MAXIMA]
    )
    esperas = sorted(
        (aceito - entrou).total_seconds() / 60
        for entrou, aceito in pares
        if entrou is not None and aceito >= entrou
    )
    if len(esperas) < AMOSTRA_MINIMA:
        cache.set(_CHAVE_ESPERA, _SEM_BASE, 60)
        return None
    meio = len(esperas) // 2
    mediana = esperas[meio] if len(esperas) % 2 else (esperas[meio - 1] + esperas[meio]) / 2
    cache.set(_CHAVE_ESPERA, mediana, 60)
    return mediana


def estimativa_minutos(posicao: int, espera_tipica: float | None) -> int | None:
    """Espera típica × posição, arredondada para cima (mínimo 1 min).

    Arredondar para cima de propósito: prometer 2 minutos e atender em 3
    frustra mais do que o contrário.
    """
    if espera_tipica is None or posicao < 1:
        return None
    return max(1, math.ceil(espera_tipica * posicao))


def situacao(
    chat: Chat,
    *,
    ordem: list[int] | None = None,
    estado: tuple[bool, dt.datetime | None] | None = None,
    espera_tipica: float | None | object = ...,
) -> dict | None:
    """O bloco `queue_position` do payload — ou `None` fora da fila.

    `ordem`, `estado` e `espera_tipica` podem vir prontos de quem calcula a
    fila inteira de uma vez (o aviso ao vivo, a lista do serializer); sem
    eles, cada um é consultado aqui.
    """
    if chat.status != ChatStatus.QUEUED:
        return None
    if ordem is not None and chat.pk in ordem:
        posicao = ordem.index(chat.pk) + 1
    else:
        posicao = posicao_na_fila(chat)
    if estado is None:
        from apps.chat.services.chat_service import estado_da_fila

        estado = estado_da_fila()
    aberta, abre_em = estado
    if espera_tipica is ...:
        espera_tipica = espera_tipica_minutos() if aberta else None
    return {
        "position": posicao,
        "ahead": posicao - 1,
        # fila fechada não tem quem atenda: qualquer número aqui seria
        # inventado, e a tela diz quando o expediente volta no lugar dele
        "estimated_wait_minutes": estimativa_minutos(posicao, espera_tipica) if aberta else None,
        "queue_open": aberta,
        "queue_opens_at": abre_em.isoformat() if abre_em else None,
    }


def avisar_posicoes() -> int:
    """Manda a cada chat da fila a posição DELE, pela sala dele.

    Chamada depois do commit de qualquer mudança que mexa na fila (entrou,
    foi pego, desistiu, virou chamado — ver `_fila_mudou`). Devolve quantas
    salas foram avisadas, para teste e log.
    """
    from apps.chat.services.chat_service import _sala, estado_da_fila

    ordem = fila_em_ordem()
    if not ordem:
        return 0
    estado = estado_da_fila()
    espera = espera_tipica_minutos() if estado[0] else None
    for posicao, chat_id in enumerate(ordem, start=1):
        _sala(chat_id, {
            "type": "chat.queue_position",
            "chat_id": chat_id,
            "position": posicao,
            "ahead": posicao - 1,
            "estimated_wait_minutes": estimativa_minutos(posicao, espera) if estado[0] else None,
            "queue_open": estado[0],
            "queue_opens_at": estado[1].isoformat() if estado[1] else None,
        })
    return len(ordem)


@receiver(post_save, sender=Chat, dispatch_uid="chat_fila_posicoes")
def _fila_mudou(sender, instance: Chat, created: bool, update_fields=None, **kwargs):
    """Toda entrada e saída da fila passa por um `save()` de `Chat` com
    `status` (ou `queued_at`, na reabertura) — abrir, pegar, encerrar,
    reabrir e as duas conversões. Ouvir o modelo, e não cada operação do
    serviço, é o que garante que uma saída nova da fila (escrita amanhã, por
    outra pessoa) também atualize quem está esperando.

    Depois do commit: posição anunciada de uma mudança desfeita seria
    mentira, e dentro da transação a consulta ainda veria a fila velha.
    """
    campos = set(update_fields or ())
    if created or update_fields is None or campos & {"status", "queued_at"}:
        transaction.on_commit(avisar_posicoes)
