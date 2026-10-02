"""Presença no detalhe do ticket: quem mais está com ele aberto AGORA.

É a detecção de colisão ("Samuel está vendo", "Samuel está respondendo…"):
dois agentes respondendo o mesmo cliente ao mesmo tempo é o erro que esta
peça existe para evitar. Por isso ela é deliberadamente EFÊMERA — nada vai
para o banco:

- cada aba aberta no detalhe manda um batimento (`registrar`) ao abrir, a
  cada `BATIMENTO_S` segundos e quando começa/para de digitar;
- a entrada de cada pessoa vive no cache com TTL (`TTL_PRESENCA_S`). Aba que
  morre sem avisar (bateria, rede, processo morto) some sozinha quando o TTL
  vence — não existe presença presa, e nenhuma tarefa de limpeza;
- "digitando" tem prazo PRÓPRIO e mais curto (`TTL_DIGITANDO_S`): se o
  "parei de digitar" se perder no caminho, o aviso não fica aceso por quase
  um minuto na tela do colega;
- quando o estado visível muda (entrou, saiu, começou/parou de digitar), os
  OUTROS presentes recebem a lista nova pelo canal pessoal (ws/me/,
  `ticket_presence`). O batimento de rotina, sem mudança, não empurra nada.

Por que cache e não um modelo: presença é um fato de segundos. Uma tabela
pediria migração, limpeza periódica e escrita no banco a cada 15s por aba
aberta — para guardar algo que ninguém consulta depois. O cache já é Redis
em produção (config/settings/base.py) e LocMem nos testes; a API usada aqui é
só a portável do Django (`get`/`set`/`get_many`/`delete`), então o mesmo
código roda nos dois.

Formato no cache, uma chave por pessoa + um índice por ticket:

    resolv:presenca-ticket:<ticket>:u<user>  -> entrada (TTL_PRESENCA_S)
    resolv:presenca-ticket:<ticket>:ids      -> [user_id, ...]

A chave por pessoa é o que torna o batimento atômico (um `set` só, sem
ler-mudar-gravar sobre um dicionário compartilhado). O índice pode perder um
id numa corrida rara (duas pessoas ENTRANDO no mesmo instante); o próximo
batimento da pessoa o recoloca — no máximo `BATIMENTO_S` de atraso, nunca
presença errada.

Quem pode: só interno, e só em ticket que `visible_tickets` devolve — a view
garante as duas coisas antes de chegar aqui. Cliente nunca registra nem
recebe presença.
"""

from __future__ import annotations

import time
from typing import Literal, TypedDict

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.core.cache import cache

PREFIXO = "resolv:presenca-ticket"

# O front bate a cada 15s. 45s de TTL = dois batimentos perdidos antes de a
# pessoa sumir: folga para uma rede ruim sem piscar "saiu/entrou".
BATIMENTO_S = 15
TTL_PRESENCA_S = 45
# Mais que um batimento (o de rotina renova quem continua digitando), bem
# menos que o TTL da presença.
TTL_DIGITANDO_S = 25

ModoDigitacao = Literal["resposta", "nota"]
MODOS_DIGITACAO = ("resposta", "nota")


class Presente(TypedDict):
    user_id: int
    nome: str
    avatar_url: str | None
    # "resposta" = resposta ao cliente; "nota" = nota interna; None = só vendo
    digitando: ModoDigitacao | None


def _chave_pessoa(ticket_id: int, user_id: int) -> str:
    return f"{PREFIXO}:{ticket_id}:u{user_id}"


def _chave_indice(ticket_id: int) -> str:
    return f"{PREFIXO}:{ticket_id}:ids"


def _publico(entrada: dict, agora: float) -> Presente:
    """O que sai para a tela. `digitando_ate` vencido vira "só vendo"."""
    digitando = entrada.get("digitando")
    if digitando and (entrada.get("digitando_ate") or 0) < agora:
        digitando = None
    return {
        "user_id": entrada["user_id"],
        "nome": entrada["nome"],
        "avatar_url": entrada.get("avatar_url") or None,
        "digitando": digitando,
    }


def listar(ticket_id: int) -> list[Presente]:
    """Quem está com o ticket aberto agora, em ordem de chegada."""
    ids: list[int] = cache.get(_chave_indice(ticket_id)) or []
    if not ids:
        return []
    entradas = cache.get_many([_chave_pessoa(ticket_id, uid) for uid in ids])
    agora = time.time()
    vivos = [
        entradas[_chave_pessoa(ticket_id, uid)]
        for uid in ids
        if _chave_pessoa(ticket_id, uid) in entradas
    ]
    if len(vivos) != len(ids):
        # Poda preguiçosa: quem venceu o TTL sai do índice na próxima leitura.
        # Se ninguém sobrou, o índice some junto.
        restantes = [e["user_id"] for e in vivos]
        if restantes:
            cache.set(_chave_indice(ticket_id), restantes, timeout=TTL_PRESENCA_S)
        else:
            cache.delete(_chave_indice(ticket_id))
    vivos.sort(key=lambda e: e.get("chegou_em", 0))
    return [_publico(e, agora) for e in vivos]


def registrar(*, ticket, user, digitando: ModoDigitacao | None = None) -> list[Presente]:
    """Batimento de `user` no detalhe de `ticket`. Devolve a lista atual.

    Idempotente: repetir o mesmo batimento só renova os prazos. Quando o que
    os OUTROS veem muda (entrada nova, começou/parou de digitar, trocou de
    resposta para nota), avisa quem mais está presente.
    """
    if digitando not in MODOS_DIGITACAO:
        digitando = None
    agora = time.time()
    chave = _chave_pessoa(ticket.pk, user.pk)
    anterior = cache.get(chave)
    entrada = {
        "user_id": user.pk,
        "nome": user.full_name or user.email,
        "avatar_url": getattr(user, "avatar_url", "") or None,
        "digitando": digitando,
        "digitando_ate": agora + TTL_DIGITANDO_S if digitando else None,
        # ordem estável na tela: quem chegou primeiro fica primeiro, e o
        # batimento de rotina não embaralha a fila de avatares
        "chegou_em": anterior.get("chegou_em", agora) if anterior else agora,
    }
    cache.set(chave, entrada, timeout=TTL_PRESENCA_S)

    indice = _chave_indice(ticket.pk)
    ids: list[int] = cache.get(indice) or []
    if user.pk not in ids:
        ids = [*ids, user.pk]
    # regrava sempre: o índice precisa viver tanto quanto a entrada mais nova
    cache.set(indice, ids, timeout=TTL_PRESENCA_S)

    presentes = listar(ticket.pk)
    estado_anterior = _publico(anterior, agora)["digitando"] if anterior else "ausente"
    if estado_anterior != digitando:
        _difundir(ticket.pk, presentes, exceto=user.pk)
    return presentes


def sair(*, ticket, user) -> list[Presente]:
    """A aba fechou o detalhe (navegou, fechou a aba). Some na hora, sem
    esperar o TTL — e quem ficou fica sabendo."""
    chave = _chave_pessoa(ticket.pk, user.pk)
    estava = cache.get(chave) is not None
    cache.delete(chave)
    presentes = listar(ticket.pk)
    if estava:
        _difundir(ticket.pk, presentes, exceto=user.pk)
    return presentes


def _difundir(ticket_id: int, presentes: list[Presente], *, exceto: int) -> None:
    """Empurra a lista nova para os OUTROS presentes, pelo ws/me/ de cada um.

    Destinatário = quem está na própria lista de presença, e só: todo mundo
    ali passou pela view (interno + ticket visível) para entrar. Não há
    `on_commit` porque não há escrita no banco para esperar.
    """
    layer = get_channel_layer()
    if layer is None:
        return
    for p in presentes:
        if p["user_id"] == exceto:
            continue
        async_to_sync(layer.group_send)(
            f"user_{p['user_id']}",
            {"type": "ticket_presence", "ticket_id": ticket_id, "presentes": presentes},
        )
