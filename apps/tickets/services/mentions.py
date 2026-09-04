"""Menção com `@` dentro do ticket.

O que é uma menção aqui: uma REFERÊNCIA gravada no corpo da nota interna como
marcação inerte — `@[user:12]` para uma pessoa, `@[team:3]` para uma equipe.
Nunca o texto "@Izaque". O porquê dessa forma está no docstring de
`TicketMention` (apps/tickets/models.py); este módulo é quem a lê, escreve e
resolve.

Três responsabilidades, nesta ordem de importância:

1. `registrar_mencoes()` — o efeito. Grava as menções, faz de quem foi citado
   um SEGUIDOR do ticket, notifica UMA vez por pessoa e deixa o rastro no
   histórico. Nota interna apenas: em resposta pública a marcação é texto
   morto, e é aqui que essa regra é aplicada de verdade.
2. `alvos_de_mencao()` — a lista do autocomplete, já na ordem que o dono pediu.
3. `mencoes_de()` — a resolução para a serialização, que é o que faz a menção
   antiga mostrar o nome NOVO de quem trocou de nome.
"""

from __future__ import annotations

import re
import unicodedata

from apps.accounts.models import Team, User, UserKind

# A marcação: `@` + tipo + id entre colchetes. Deliberadamente feia de digitar
# à mão — quem escreve é o editor, e o que um humano digita ("@iza") nunca casa
# com ela por acidente.
MARCACAO = re.compile(r"@\[(user|team):(\d+)\]")

# limite de `TicketStatusEvent.note`, onde o rastro da menção é gravado
_LIMITE_NOTA = 200


def extrair_referencias(body: str) -> tuple[list[int], list[int]]:
    """Ids citados no corpo, sem repetição e na ordem em que aparecem.

    Só lê o texto: não valida se o id existe, se a pessoa está ativa nem se é
    interna. Quem faz esse filtro é quem for usar o resultado — este módulo
    separa "o que está escrito" de "o que vale".
    """
    usuarios: list[int] = []
    equipes: list[int] = []
    for tipo, valor in MARCACAO.findall(body or ""):
        destino = usuarios if tipo == "user" else equipes
        numero = int(valor)
        if numero not in destino:
            destino.append(numero)
    return usuarios, equipes


def registrar_mencoes(*, message, author) -> list[User]:
    """Aplica o efeito das menções da mensagem. Devolve quem foi notificado.

    ⚑ REGRA DURA: menção só existe em NOTA INTERNA. Numa resposta ao cliente a
    marcação não vira menção, não notifica ninguém e não gera linha em
    `TicketMention` — e, sem linha, a serialização a devolve como texto literal,
    de modo que nem o chip aparece. O front também não abre o autocomplete lá,
    mas isso é conforto: a garantia de que a menção não vaza para o cliente é
    esta linha, não a tela.
    """
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify
    from apps.tickets.models import TicketMention, TicketWatcher

    if message.is_public or author is None or not author.is_internal:
        return []

    ids_usuarios, ids_equipes = extrair_referencias(message.body)
    if not ids_usuarios and not ids_equipes:
        return []

    # Só entra quem PODE ser mencionado: agente ativo e equipe ativa. Um id
    # forjado no corpo (ou o de um agente desativado entre o rascunho e o
    # envio) é ignorado em silêncio — vira texto, não vira notificação.
    usuarios = list(
        User.objects.filter(
            pk__in=ids_usuarios, kind=UserKind.INTERNAL, is_active=True
        )
    )
    equipes = list(Team.objects.filter(pk__in=ids_equipes, is_active=True))
    if not usuarios and not equipes:
        return []

    ticket = message.ticket
    for user in usuarios:
        TicketMention.objects.get_or_create(message=message, user=user)
    for team in equipes:
        TicketMention.objects.get_or_create(message=message, team=team)

    # Quem recebe: os citados individualmente MAIS os agentes ativos das equipes
    # citadas. É um conjunto — quem foi chamado pelo nome E pela equipe recebe
    # uma notificação só, e o próprio autor nunca recebe (mencionar a si mesmo
    # é organização pessoal, não aviso).
    destinatarios: dict[int, User] = {u.pk: u for u in usuarios}
    if equipes:
        for agente in _agentes_ativos_das_equipes(equipes):
            destinatarios.setdefault(agente.pk, agente)
    destinatarios.pop(author.pk, None)

    for user in destinatarios.values():
        # Seguidor (CC) já existia como conceito: `TicketWatcher`. Ser citado
        # passa a criar o vínculo, porque quem foi chamado para o caso quer o
        # resto da conversa — e `get_or_create` mantém idempotente quem já seguia.
        # Vale lembrar o que o model avisa: seguir NÃO dá acesso a ticket
        # restrito; a leitura continua decidida por `is_content_visible_to`.
        TicketWatcher.objects.get_or_create(ticket=ticket, user=user)
        notify(
            recipient=user,
            kind=NotificationKind.MENTION,
            title=f"{author.full_name} mencionou você em {ticket.reference}",
            # o corpo cru traria a marcação (`@[user:12]`) para dentro do sino;
            # o resumo já sai com os nomes trocados, legível fora do ticket
            body=resumir(message.body)[:200],
            # âncora da nota: o sino leva à MENSAGEM, não ao topo do ticket
            url=f"/tickets/{ticket.pk}#mensagem-{message.pk}",
            ticket=ticket,
            actor=author,
        )

    _registrar_no_historico(ticket, author, usuarios, equipes)
    return list(destinatarios.values())


def _agentes_ativos_das_equipes(equipes) -> list[User]:
    """Agentes ATIVOS das equipes citadas.

    Desativado não entra: ele não aparece no autocomplete e também não pode
    entrar por tabela, senão mencionar `@design` reviveria quem saiu da empresa.
    """
    return list(
        User.objects.filter(
            team_links__team__in=equipes, kind=UserKind.INTERNAL, is_active=True
        ).distinct()
    )


def _registrar_no_historico(ticket, author, usuarios, equipes) -> None:
    """"Fulano mencionou Izaque" no histórico do ticket.

    Usa `TicketStatusEvent` com o status parado (de = para), como já faz a
    atribuição: o histórico do ticket é essa tabela, e inventar uma segunda
    linha do tempo para a menção deixaria a tela com duas fontes para ordenar.
    """
    from apps.tickets.models import TicketStatusEvent

    nomes = [u.full_name for u in usuarios] + [f"{t.name} (equipe)" for t in equipes]
    nota = f"mencionou {', '.join(nomes)}"
    if len(nota) > _LIMITE_NOTA:
        nota = nota[: _LIMITE_NOTA - 1] + "…"
    TicketStatusEvent.objects.create(
        ticket=ticket,
        from_status=ticket.status,
        to_status=ticket.status,
        changed_by=author,
        note=nota,
    )


# --------------------------------------------------------------------------- #
# Resolução para leitura


def mencoes_de(message) -> list[dict]:
    """As menções de uma mensagem, com o nome ATUAL de cada citado.

    É esta resolução tardia que cumpre o pedido do dono: a nota guardou o id, e
    quem trocou de nome aparece com o nome novo na nota de seis meses atrás.

    `is_active=False` não some da lista — a menção a quem foi desativado depois
    continua legível (o front a pinta em cinza). Sumir reescreveria a nota.
    """
    saida = []
    for mencao in message.mentions.select_related("user", "team").all():
        if mencao.user_id:
            saida.append({
                "key": f"user:{mencao.user_id}",
                "type": "user",
                "id": mencao.user_id,
                "name": mencao.user.full_name,
                "is_active": mencao.user.is_active,
            })
        else:
            saida.append({
                "key": f"team:{mencao.team_id}",
                "type": "team",
                "id": mencao.team_id,
                "name": mencao.team.name,
                "is_active": mencao.team.is_active,
            })
    return saida


def resumir(body: str) -> str:
    """Troca a marcação pelo nome, para onde o chip não existe (sino, e-mail)."""
    usuarios, equipes = extrair_referencias(body)
    nomes = {
        f"user:{u.pk}": u.full_name
        for u in User.objects.filter(pk__in=usuarios)
    }
    nomes.update({
        f"team:{t.pk}": t.name for t in Team.objects.filter(pk__in=equipes)
    })
    return MARCACAO.sub(
        lambda m: "@" + nomes.get(f"{m.group(1)}:{m.group(2)}", "?"), body or ""
    )


# --------------------------------------------------------------------------- #
# Autocomplete


def normalizar(texto: str) -> str:
    """Minúsculas e sem acento — `@iza` precisa achar "Izaque" e "Ízaque"."""
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    return "".join(c for c in sem_acento if not unicodedata.combining(c)).casefold()


def alvos_de_mencao(*, ticket, requester) -> list[dict]:
    """Tudo que pode ser mencionado neste ticket, na ordem em que se oferece.

    A lista sai INTEIRA e pequena de propósito: quem atende cabe em uma
    requisição, e filtrar no cliente responde a cada tecla sem ida ao servidor
    (o autocomplete abre no primeiro caractere — uma consulta por tecla seria
    uma consulta por tecla de verdade).

    Quem entra: agente ATIVO e equipe ATIVA. Usuário de cliente nunca — nem o
    solicitante do próprio ticket. Mencionar é conversa interna; oferecer o
    cliente na lista é oferecer o vazamento.

    Ordem (`group`), como o dono pediu:
      `ticket`  — quem já está no caso: responsável, proprietário, seguidores;
      `equipe`  — quem atende a equipe do ticket;
      `outros`  — o resto dos agentes;
      `equipes` — as equipes, em GRUPO PRÓPRIO no fim. Decisão: chamar um time
                  inteiro é mais raro e mais barulhento que chamar uma pessoa,
                  então ele não disputa as primeiras posições com as pessoas —
                  quem quer a equipe digita o nome dela e a acha na hora.

    O próprio usuário fica de fora: ele nunca é notificado da própria menção
    (ver `registrar_mencoes`), e oferecer na lista seria prometer um aviso que
    não chega.
    """
    do_ticket: set[int] = {
        pk for pk in (ticket.assignee_id, ticket.owner_id) if pk is not None
    }
    do_ticket.update(
        ticket.watchers.values_list("user_id", flat=True)
    )
    da_equipe = set(
        User.objects.filter(team_links__team_id=ticket.team_id).values_list(
            "pk", flat=True
        )
    )

    agentes = (
        User.objects.filter(kind=UserKind.INTERNAL, is_active=True)
        .exclude(pk=requester.pk)
        .order_by("full_name")
    )

    resultados: list[dict] = []
    for grupo, filtro in (
        ("ticket", lambda u: u.pk in do_ticket),
        ("equipe", lambda u: u.pk not in do_ticket and u.pk in da_equipe),
        ("outros", lambda u: u.pk not in do_ticket and u.pk not in da_equipe),
    ):
        for agente in agentes:
            if filtro(agente):
                resultados.append({
                    "type": "user",
                    "id": agente.pk,
                    "name": agente.full_name,
                    "email": agente.email,
                    "avatar_url": agente.avatar_url or "",
                    "group": grupo,
                })

    for equipe in Team.objects.filter(is_active=True).order_by("order", "name"):
        resultados.append({
            "type": "team",
            "id": equipe.pk,
            "name": equipe.name,
            "email": "",
            "avatar_url": "",
            "group": "equipes",
        })
    return resultados
