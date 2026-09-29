"""Ciclo de vida do chat v2.

Fila única (sem equipe), um chat vivo por login, lock atômico no "pegar",
transferência direta, encerramento com confirmação dos dois lados, avaliação
obrigatória (a pendência bloqueia chat novo) e duas saídas para ticket —
a manual (agente escolhe a equipe) e a automática (timeout, equipe padrão).

Sessão ≠ conexão: socket cair não fecha chat nenhum. O banco é a fonte da
verdade; o WebSocket transporta o que o banco já registrou.
"""

from __future__ import annotations

import datetime as dt
import logging
import re

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.chat.models import (
    BannedWord,
    Chat,
    ChatConfig,
    ChatFile,
    ChatMessage,
    ChatStatus,
)

logger = logging.getLogger(__name__)

GRUPO_AGENTES = "chat_agentes"  # todo interno conectado escuta a fila aqui


def auditar(*, chat: Chat, actor, action: str, summary: str, changes: dict | None = None):
    """Grava o evento do chat na trilha de auditoria GERAL (`audit.AuditLog`).

    Trilha própria do chat seria uma segunda tabela append-only com as mesmas
    colunas e a mesma disciplina — e a tela de Auditoria teria de aprender a
    juntar duas fontes. `AuditLog` é genérico (GenericForeignKey), já é
    append-only de verdade (`AppendOnlyModel` barra update/delete de linha) e
    já entra no expurgo de retenção da LGPD. O chat só precisava passar a
    escrever nela.

    Nunca derruba a operação que auditou: um erro aqui (banco de auditoria
    indisponível, content type ausente numa migração pela metade) não pode
    desfazer um encerramento que já aconteceu — some no log da aplicação, e o
    atendimento segue. O inverso (perder o encerramento para salvar o log)
    seria pior.
    """
    from apps.audit.models import AuditLog

    try:
        AuditLog.objects.create(
            actor=actor if (actor is not None and getattr(actor, "pk", None)) else None,
            action=action,
            content_type=ContentType.objects.get_for_model(Chat),
            object_id=str(chat.pk),
            changes=changes or {},
            summary=summary[:250],
        )
    except Exception:  # noqa: BLE001 — auditoria não derruba atendimento
        logger.warning("auditoria do chat %s falhou (%s)", chat.pk, action, exc_info=True)


class ChatRuleViolation(Exception):
    """Regra de negócio violada — a view converte em 4xx.

    `code` distingue o motivo quando o front precisa REAGIR diferente (fora
    de expediente → oferecer o ticket), não só mostrar a mensagem.
    """

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        self.code = code


def fora_do_expediente() -> bool:
    """Fora do horário comercial do calendário PADRÃO (Configurações →
    Horário de atendimento). Sem calendário padrão, o chat nunca fecha."""
    from apps.core.business_hours import is_open_now
    from apps.core.models import BusinessCalendar

    padrao = BusinessCalendar.objects.filter(is_default=True).first()
    return not is_open_now(padrao)


def estado_da_fila(at: dt.datetime | None = None) -> tuple[bool, dt.datetime | None]:
    """A fila do chat está aberta agora e, se não, quando reabre?

    Mesma regra do `fora_do_expediente` — quem decide é o calendário PADRÃO,
    e sem calendário a fila nunca fecha. `abre_em` sai do próprio
    `add_business_minutes(agora, 0)`: com zero minutos pra andar, ele devolve
    o primeiro instante DENTRO do expediente, que é exatamente a resposta.
    Fica `None` com a fila aberta — não há o que esperar.

    A conta é do servidor de propósito: o agente lê "fila fechada até
    amanhã, 8h" na tela, e refazer isso no navegador (fuso, feriado de meio
    período) só criaria uma segunda verdade pra discordar desta.
    """
    from apps.core.business_hours import add_business_minutes, is_open_now
    from apps.core.models import BusinessCalendar

    padrao = BusinessCalendar.objects.filter(is_default=True).first()
    agora = at or timezone.now()
    if is_open_now(padrao, agora):
        return True, None
    return False, add_business_minutes(agora, 0, padrao)


# ---------------------------------------------------------------------- #
# Filtro de palavrões — censura na EXIBIÇÃO, para os dois lados
# ---------------------------------------------------------------------- #

def _palavras_banidas() -> list[str]:
    palavras = cache.get("chat:banned-words")
    if palavras is None:
        palavras = list(BannedWord.objects.values_list("word", flat=True))
        cache.set("chat:banned-words", palavras, 300)
    return palavras


def censor(text: str) -> str:
    """Troca cada palavra banida por `****` — case-insensitive, palavra
    inteira (banir "pato" não censura "sapato"). Roda na serialização, então
    a lista vale retroativamente e um falso positivo removido volta intacto."""
    for palavra in _palavras_banidas():
        if not palavra:
            continue
        text = re.sub(
            rf"\b{re.escape(palavra)}\b", "****", text, flags=re.IGNORECASE
        )
    return text


def render_welcome(client) -> str:
    modelo = ChatConfig.load().welcome_message
    primeiro_nome = client.full_name.split()[0] if client.full_name else ""
    return modelo.replace("{{nome_do_cliente}}", primeiro_nome)


# ---------------------------------------------------------------------- #
# Autorização
# ---------------------------------------------------------------------- #

def visible_chats(user):
    """Interno vê tudo (fila única, sem recorte de equipe); cliente, os seus."""
    qs = Chat.objects.select_related("client", "agent", "company", "category")
    if user.is_internal:
        return qs
    return qs.filter(client=user)


def mensagens_visiveis(qs, user):
    """O filtro de NOTA INTERNA — o único lugar que decide o que o cliente vê.

    Existe como função, e não como um `if user.is_internal` repetido, porque
    é assim que um vazamento destes acontece de verdade: a sétima consulta a
    mensagens é escrita meses depois, por outra pessoa, e ninguém lembra da
    condição. Aqui, esquecer é impossível de um jeito silencioso — ou a
    consulta passa por esta função, ou ela não filtra nada e isso salta aos
    olhos na revisão.

    O socket é o outro caminho por onde a nota poderia escapar, e ele tem a
    mesma trava no `chat_message` do consumer.
    """
    if user is not None and getattr(user, "is_internal", False):
        return qs
    return qs.filter(is_internal_note=False)


def can_send(user, chat: Chat) -> bool:
    """Quem pode ESCREVER: o dono do chat, ou — em atendimento — só o agente
    que pegou. Chat em fila não recebe mensagem de interno (pegue primeiro);
    chat fechado não recebe mensagem de ninguém (reabra primeiro)."""
    chat.refresh_from_db(fields=["status", "agent", "client"])
    if chat.status == ChatStatus.CLOSED:
        return False
    if not user.is_internal:
        return chat.client_id == user.id
    if chat.status != ChatStatus.ACTIVE:
        return False
    # quem ENTROU na conversa (supervisor, `join_chat`) escreve junto do dono
    return chat.agent_id == user.id or participa(user, chat)


# ---------------------------------------------------------------------- #
# Limite de simultâneos e elegibilidade pro aviso de fila
# ---------------------------------------------------------------------- #

def active_count(agent) -> int:
    return Chat.objects.filter(agent=agent, status=ChatStatus.ACTIVE).count()


def sob_o_limite(agent) -> bool:
    return active_count(agent) < ChatConfig.load().max_chats_per_agent


# ---------------------------------------------------------------------- #
# Operações
# ---------------------------------------------------------------------- #

def open_chat(*, client) -> tuple[Chat, bool]:
    """Abre (ou retoma) o chat do cliente e avisa a fila dos agentes.

    Bloqueios, na ordem em que doem menos: interno não abre chat; plano sem
    chat não abre; avaliação pendente TRAVA — o cliente precisa dar a nota
    dos fechados antes de abrir um novo (a view devolve os pendentes para o
    front forçar a avaliação).
    """
    if client.is_internal:
        raise ChatRuleViolation("Chat é iniciado pelo cliente.")
    if not client.company.plan.chat_enabled:
        raise ChatRuleViolation("Chat indisponível para o plano da sua empresa.")

    vivo = Chat.objects.filter(
        client=client, status__in=[ChatStatus.QUEUED, ChatStatus.ACTIVE]
    ).first()
    if vivo:
        # o já-aberto continua acessível fora de expediente — a regra vale
        # para conversa NOVA, não para expulsar quem já estava na fila
        return vivo, False

    if fora_do_expediente():
        raise ChatRuleViolation(
            "Estamos fora do horário de atendimento por chat. "
            "Abra um ticket e a equipe responde assim que o expediente começar.",
            code="fora_do_expediente",
        )

    if pending_ratings(client).exists():
        raise ChatRuleViolation(
            "Você tem atendimento sem avaliação. Avalie antes de abrir um novo chat."
        )

    try:
        with transaction.atomic():
            chat = Chat.objects.create(company=client.company, client=client)
            # a boas-vindas nasce JUNTO do chat, antes de qualquer agente —
            # e dentro da transação: chat sem boas-vindas não existe
            ChatMessage.objects.create(
                chat=chat, is_system=True, body=render_welcome(client),
            )
    except IntegrityError:
        # corrida de duas abas: a constraint parcial decide, nós retomamos
        vencedor = Chat.objects.filter(
            client=client, status__in=[ChatStatus.QUEUED, ChatStatus.ACTIVE]
        ).first()
        if vencedor is None:
            raise
        return vencedor, False

    transaction.on_commit(lambda: _avisar_fila(chat))
    return chat, True


def pending_ratings(client):
    """Fechados sem nota (e sem ticket gerado — convertido não cobra nota,
    a conversa segue no ticket que tem a própria pesquisa). Mesmo fechado
    sem nunca ter sido atendido cobra nota — espelha `Chat.rating_pending`."""
    return Chat.objects.filter(
        client=client, status=ChatStatus.CLOSED, rating__isnull=True,
    ).filter(generated_ticket__isnull=True).order_by("closed_at")


# ---------------------------------------------------------------------- #
# Linha do tempo do cliente — a conversa contínua
# ---------------------------------------------------------------------- #
#
# O cliente vê UMA conversa com o atendimento; a operação a divide em
# atendimentos, cada um com fila, aceite e nota próprios. A costura é aqui,
# na LEITURA — o modelo continua separado, e é ele que a fila, o SLA e os
# relatórios continuam medindo.
#
# Só faz sentido para cliente: "todas as minhas sessões" não quer dizer nada
# para um interno, que atende várias pessoas. Quem barra isso é a view.

#: http/https explícitos e o `www.` sem esquema. Domínio nu ("resolv.com")
#: fica de fora de propósito: pegaria "versão 2.0" e "R$ 1.500,00" como link.
_URL_RE = re.compile(r"(?i)\b(?:https?://|www\.)[^\s<>\"']+")


def extrair_links(texto: str) -> list[str]:
    """URLs de um corpo de mensagem, sem a pontuação que fecha a frase.

    "veja em https://x.com/a." termina em ponto que é da frase, não da URL; e
    um ")" final costuma fechar um parêntese aberto ANTES do link — só é
    aparado quando não há "(" correspondente dentro da própria URL.
    """
    achados = []
    for bruto in _URL_RE.findall(texto):
        url = bruto.rstrip(".,;:!?")
        while url.endswith(")") and url.count("(") < url.count(")"):
            url = url[:-1]
        if url:
            achados.append(url)
    return achados


def _mensagens_do_cliente(client):
    """Base de toda leitura da linha do tempo: as mensagens das sessões DELE.

    O escopo sai de `visible_chats`, como manda a disciplina do módulo — não
    de `ChatMessage.objects` cru, que não sabe de quem é a conversa.
    """
    return (
        ChatMessage.objects.filter(chat__in=visible_chats(client))
        .select_related(
            "author", "chat", "chat__agent", "chat__rating",
            # o marcador entre atendimentos diz o motivo do encerramento e o
            # chamado que saiu dali — sem isto seriam duas consultas por sessão
            "chat__close_reason", "chat__generated_ticket",
        )
        .prefetch_related("files")
    )


CORPO_APAGADO = "Esta mensagem foi apagada."


def _pode_mexer_na_mensagem(message: ChatMessage, actor) -> None:
    """Só o AUTOR corrige o que escreveu — mesma regra do ticket
    (`ticket_service._pode_mexer_na_mensagem`), e pelo mesmo motivo: nem
    agente, nem admin, edita a fala de outra pessoa numa conversa que o
    cliente já leu. Mensagem de sistema (`author=None`) não se edita."""
    if message.author_id is None:
        raise ChatRuleViolation("Mensagem do sistema não pode ser alterada.")
    if actor.pk != message.author_id:
        raise ChatRuleViolation("Só o autor pode alterar a própria mensagem.")
    if message.deleted_at is not None:
        raise ChatRuleViolation("Esta mensagem já foi apagada.")


def is_last_message(message: ChatMessage) -> bool:
    """Se `message` é a mais recente da sessão — ninguém, nem o próprio autor,
    mandou nada depois dela. Só usada por `edit_message`: apagar uma mensagem
    antiga continua liberado (some da tela pros dois lados, não reescreve o
    que já foi lido), mas CORRIGIR o texto de algo que a conversa já deixou
    pra trás enganaria quem já respondeu àquilo.

    O serializer (`ChatMessageSerializer.get_can_edit`) reimplementa esta
    mesma regra em vez de chamar esta função: precisa cachear o id mais
    recente por chat para não pagar uma query por mensagem num histórico
    de até 100 — ver o comentário lá."""
    return not message.chat.messages.filter(id__gt=message.id).exists()


def edit_message(*, message: ChatMessage, actor, body: str) -> ChatMessage:
    """Corrige o texto de uma mensagem já enviada.

    Diferente do ticket, o chat não guarda o texto anterior numa trilha de
    auditoria própria — `edited_at` é o que a tela mostra como "editada",
    e é o bastante: o chat não é a resposta formal ao cliente que o ticket
    é, e o módulo não tem esse mecanismo em nenhuma outra operação.
    """
    _pode_mexer_na_mensagem(message, actor)
    if not is_last_message(message):
        raise ChatRuleViolation(
            "Só é possível corrigir a última mensagem enviada, e só antes de "
            "chegar uma resposta."
        )
    body = (body or "").strip()
    if not body:
        raise ChatRuleViolation("A mensagem não pode ficar vazia — apague-a.")
    if body == message.body:
        return message

    message.body = body
    message.edited_at = timezone.now()
    message.edited_by = actor
    message.save(update_fields=["body", "edited_at", "edited_by"])
    return message


def delete_message(*, message: ChatMessage, actor) -> ChatMessage:
    """Apaga o CONTEÚDO de uma mensagem, preservando a linha.

    A linha sustenta a ordem da conversa contínua (`timeline()`, que cruza
    várias sessões) e o WebSocket dos dois lados — sumir a linha de verdade
    deixaria um buraco que o outro lado, já com a mensagem na tela, não
    saberia explicar. O corpo vira `CORPO_APAGADO`; anexos desta mensagem
    saem junto, pelo mesmo motivo do texto.
    """
    _pode_mexer_na_mensagem(message, actor)

    message.files.all().delete()
    message.body = CORPO_APAGADO
    message.deleted_at = timezone.now()
    message.deleted_by = actor
    message.save(update_fields=["body", "deleted_at", "deleted_by"])
    return message


def timeline(client, *, before: int | None = None, limit: int | None = None,
             q: str = "", para=None) -> tuple[list, bool]:
    """As mensagens de todas as sessões do cliente e se ainda há anteriores.

    Mesmo contrato de recorte do `messages/` de um chat, de propósito —
    `before` + `limit` — para não existir um segundo jeito de paginar
    conversa neste sistema. `q` filtra pelo corpo (a busca do item 3).

    Devolve `(mensagens, tem_anteriores)`. `tem_anteriores` é o que diz à
    tela se vale desenhar o "carregar mensagens anteriores": contar o total
    de uma conversa de meses para exibir um botão seria caro à toa.
    """
    # `client` é DE QUEM é a conversa; `para` é QUEM está lendo. Eram a
    # mesma pessoa enquanto a conversa contínua existia só no portal; agora
    # o console também a usa, e é a segunda que decide o que aparece — o
    # agente enxerga as notas internas, o cliente não.
    base = mensagens_visiveis(_mensagens_do_cliente(client), para or client)
    qs = base.order_by("id")
    if q:
        qs = qs.filter(body__icontains=q)
    if before is not None:
        qs = qs.filter(id__lt=before)

    if limit is not None:
        # as N MAIS RECENTES do recorte — corta pela cauda e devolve em ordem
        # crescente, que é como a conversa desenha (igual ao `messages/`)
        ids = list(qs.order_by("-id").values_list("id", flat=True)[:limit])
        qs = base.filter(id__in=ids).order_by("id")

    mensagens = list(qs)
    if not mensagens:
        return [], False

    anteriores = base.filter(id__lt=mensagens[0].id)
    if q:
        anteriores = anteriores.filter(body__icontains=q)
    return mensagens, anteriores.exists()


def caixa_de_entrada(agente) -> list[dict]:
    """A lista do console agrupada POR CLIENTE, não por abertura.

    Uma linha por pessoa, ordenada pela atividade mais recente — o formato
    de caixa de entrada que todo mensageiro usa. Com cinquenta clientes e
    várias aberturas cada, uma linha por abertura vira uma lista que ninguém
    navega, e a mesma pessoa aparece cinco vezes sem relação visível entre
    elas.

    O agrupamento é de APRESENTAÇÃO. Cada `Chat` continua sendo uma linha no
    banco, com o próprio SLA, a própria avaliação e o próprio ciclo — nada
    disso muda. O que muda é que a tela do agente pergunta "com quem estou
    falando" em vez de "que aberturas existem".

    A fila (quem ainda não foi pego) NÃO entra aqui: ela é uma lista de
    trabalho a fazer, não uma conversa em andamento, e some assim que
    alguém pega. Continua na sua própria seção.
    """
    from django.contrib.auth import get_user_model
    from django.db.models import Count, Max, OuterRef, Subquery

    ultima = (
        ChatMessage.objects.filter(chat__client=OuterRef("client"), is_system=False)
        .order_by("-id")
        .values("body")[:1]
    )
    linhas = (
        visible_chats(agente)
        .exclude(status=ChatStatus.QUEUED)
        .values("client")
        .annotate(
            atividade=Max("messages__sent_at"),
            aberturas=Count("pk", distinct=True),
            # a abertura mais recente da pessoa: sem nenhuma viva, é nela que
            # a thread abre (em leitura) — a conversa não pode sumir da tela
            # só porque o último atendimento foi encerrado
            ultima_abertura=Max("pk"),
            previa=Subquery(ultima),
        )
        .order_by("-atividade")
    )

    por_cliente = {ligacao["client"]: ligacao for ligacao in linhas}
    if not por_cliente:
        return []

    clientes = {
        u.pk: u
        for u in get_user_model().objects.filter(pk__in=por_cliente).select_related("company")
    }

    # A sessão ABERTA de cada cliente (no máximo uma, pela constraint
    # `uniq_chat_aberto_por_login`) — é ela que decide se dá para escrever.
    abertas = {
        c.client_id: c
        for c in visible_chats(agente).filter(status=ChatStatus.ACTIVE)
    }

    resultado = []
    for cid, dados in por_cliente.items():
        cliente = clientes.get(cid)
        if cliente is None:
            continue
        aberta = abertas.get(cid)
        resultado.append({
            "client_id": cid,
            "client_name": cliente.full_name,
            "client_avatar": cliente.avatar_url or None,
            "client_presence": cliente.presence,
            "company_name": cliente.company.name if cliente.company else "",
            "last_activity": dados["atividade"],
            "last_message_preview": (dados["previa"] or "")[:120],
            "sessions": dados["aberturas"],
            # o chat vivo, quando existe: é nele que a mensagem nova entra
            "open_chat_id": aberta.pk if aberta else None,
            "last_chat_id": dados["ultima_abertura"],
            "open_agent_id": aberta.agent_id if aberta else None,
            "unread": _nao_lidas_do_cliente(agente, cid),
        })
    return resultado


def _nao_lidas_do_cliente(agente, client_id: int) -> int:
    """Não lidas somadas de TODAS as aberturas — a linha é uma só, o contador
    também tem de ser."""
    return (
        mensagens_visiveis(
            ChatMessage.objects.filter(
                chat__in=visible_chats(agente).filter(client_id=client_id),
                read_at__isnull=True,
                is_system=False,
            ),
            agente,
        )
        .exclude(author=agente)
        .count()
    )


def chat_media(chat, user=None) -> tuple[list, list]:
    """Anexos e links DESTE atendimento — o painel lateral da conversa.

    Irmão de `timeline_media`, que faz o mesmo para todas as sessões do
    cliente. São dois porque o recorte é a pergunta: no painel da conversa
    interessa "o que passou por AQUI"; na conversa contínua, "o que essa
    pessoa já mandou algum dia".

    Os links continuam saindo do servidor pelo mesmo motivo de lá — no
    navegador só se acha o que já foi rolado até a tela.
    """
    arquivos = list(
        ChatFile.objects.filter(
            message__in=mensagens_visiveis(chat.messages.all(), user)
        )
        .select_related("message", "message__chat")
        .order_by("-message__sent_at")
    )

    links = []
    vistos = set()
    mensagens = (
        mensagens_visiveis(chat.messages.select_related("author"), user)
        .filter(is_system=False, deleted_at__isnull=True)
        .exclude(body="")
        .order_by("-id")
    )
    for msg in mensagens:
        for url in extrair_links(censor(msg.body)):
            if url in vistos:
                continue
            vistos.add(url)
            links.append({
                "url": url,
                "chat_id": msg.chat_id,
                "message_id": msg.id,
                "sent_at": msg.sent_at,
                "author_name": msg.author.full_name if msg.author else "Sistema",
            })
    return arquivos, links


def marcar_entregues(*, chat, actor, ids: list[int]) -> list[int]:
    """Carimba a entrega das mensagens que o destinatário acabou de receber.

    Só o OUTRO lado entrega: carimbar a própria mensagem como entregue seria
    o remetente confirmando a si mesmo. E só a primeira vez conta — o
    `delivered_at__isnull=True` evita que uma reconexão empurre o horário
    para frente e faça a entrega parecer mais recente do que foi.
    """
    if not ids:
        return []
    alvo = chat.messages.filter(
        id__in=ids[:200], delivered_at__isnull=True, is_system=False
    ).exclude(author=actor)
    marcados = list(alvo.values_list("id", flat=True))
    if marcados:
        chat.messages.filter(id__in=marcados).update(delivered_at=timezone.now())
    return marcados


def timeline_media(client) -> tuple[list, list]:
    """Anexos e links de TODAS as sessões do cliente — o painel do chat.

    Os links são extraídos no SERVIDOR porque é a única forma de alcançar o
    histórico inteiro: fazer isso no navegador só encontraria os links das
    mensagens que já foram roladas até a tela.

    Mensagem de sistema fica de fora dos links — a boas-vindas não é algo
    que alguém mandou, e repeti-la a cada sessão encheria o painel.
    """
    arquivos = list(
        ChatFile.objects.filter(message__chat__in=visible_chats(client))
        .select_related("message", "message__chat")
        .order_by("-message__sent_at")
    )

    links = []
    vistos = set()
    mensagens = (
        mensagens_visiveis(_mensagens_do_cliente(client), client)
        .filter(is_system=False)
        .exclude(body="")
        .order_by("-id")
    )
    for msg in mensagens:
        for url in extrair_links(censor(msg.body)):
            if url in vistos:
                continue  # o mesmo link remandado não vira duas linhas
            vistos.add(url)
            links.append({
                "url": url,
                "chat_id": msg.chat_id,
                "message_id": msg.id,
                "sent_at": msg.sent_at,
                "author_name": msg.author.full_name if msg.author else "Sistema",
            })
    return arquivos, links


def take_chat(*, chat: Chat, agent) -> Chat:
    """Agente assume — lock ATÔMICO: dois cliques simultâneos, um ganha.

    O `select_for_update` é a verdade; o botão desabilitado no front é só
    cortesia. Quem perde a corrida recebe a recusa e o front esconde o popup.
    """
    if not agent.is_internal:
        raise ChatRuleViolation("Apenas agentes atendem chat.")
    if not sob_o_limite(agent):
        raise ChatRuleViolation(
            f"Você já está no limite de {ChatConfig.load().max_chats_per_agent} "
            "chats simultâneos."
        )
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status != ChatStatus.QUEUED:
            raise ChatRuleViolation("Este chat já foi pego por outro agente.")
        chat.status = ChatStatus.ACTIVE
        chat.agent = agent
        chat.accepted_at = timezone.now()
        chat.save(update_fields=["status", "agent", "accepted_at", "updated_at"])
        ChatMessage.objects.create(
            chat=chat, is_system=True,
            body=f"{agent.full_name} entrou na conversa.",
        )
    auditar(chat=chat, actor=agent, action="assign",
            summary=f"{agent.full_name} aceitou o atendimento.")
    _sala(chat.pk, {"type": "chat.accepted", "agent_name": agent.full_name})
    _agentes({"type": "chat.taken", "chat_id": chat.pk, "agent_id": agent.pk})
    return chat


def transfer(*, chat: Chat, actor, to_agent, note: str = "") -> Chat:
    """Passa o atendimento direto pro outro agente — sem novo "pegar".

    Quem pode: o agente da conversa ou um admin. O cliente é avisado por
    mensagem de sistema (a troca de interlocutor é informação dele também).
    """
    if not actor.is_internal or not to_agent.is_internal:
        raise ChatRuleViolation("Só um agente pode receber uma transferência.")
    # Mesmo teto do "pegar" (Fase 3 do prompt de integração: reforçar em
    # ambos, não só na aceitação inicial) — sem isto dava pra empurrar um
    # 4º chat pra um agente já no limite só transferindo em vez de pegar.
    if not sob_o_limite(to_agent):
        raise ChatRuleViolation(
            f"{to_agent.full_name} já está no limite de "
            f"{ChatConfig.load().max_chats_per_agent} chats simultâneos."
        )
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status != ChatStatus.ACTIVE:
            raise ChatRuleViolation("Só dá para transferir um chat em atendimento.")
        if not (actor.is_admin or chat.agent_id == actor.pk):
            raise ChatRuleViolation("Só quem está atendendo — ou um admin — transfere.")
        if chat.agent_id == to_agent.pk:
            raise ChatRuleViolation(f"O chat já é de {to_agent.full_name}.")
        de = chat.agent
        chat.agent = to_agent
        chat.save(update_fields=["agent", "updated_at"])
        # quem já estava na conversa como participante e agora a recebe
        # passa a ser o dono — os dois papéis ao mesmo tempo não existem
        chat.participants.remove(to_agent)
        ChatMessage.objects.create(
            chat=chat, is_system=True,
            body=(f"Atendimento transferido de {de.full_name} para {to_agent.full_name}."
                  if de else f"{to_agent.full_name} assumiu a conversa."),
        )
        # A observação de quem transferiu é INTERNA: vai para a trilha de
        # auditoria (abaixo), não para a conversa — o cliente lê a mensagem
        # de sistema acima, e só ela.
    auditar(
        chat=chat, actor=actor, action="assign",
        summary=(f"Transferido para {to_agent.full_name}"
                 + (f" — {note.strip()}" if note.strip() else "")),
        changes={"agent": [de.full_name if de else None, to_agent.full_name],
                 "note": ["", note.strip()] if note.strip() else {}},
    )
    _sala(chat.pk, {"type": "chat.transferred", "agent_name": to_agent.full_name})
    _pessoal(to_agent.pk, {
        "kind": "chat_transferred", "chat_id": chat.pk,
        "company": chat.company.name, "client_name": chat.client.full_name,
    })
    return chat


# ---------------------------------------------------------------------- #
# Supervisão: entrar na conversa de outro agente, sair dela, assumi-la
# ---------------------------------------------------------------------- #

def pode_supervisionar(user) -> bool:
    """Quem entra na conversa de OUTRO agente, ou a assume: admin e
    supervisor.

    O agente comum continua podendo ACOMPANHAR (a fila é única e todo
    interno lê tudo), mas não fala por cima de um colega nem tira a
    conversa dele — para isso existe a transferência, que é decisão de quem
    atende. Mesmo atalho de papel que `transfer` já usa para o admin."""
    return bool(
        getattr(user, "is_internal", False)
        and (user.is_admin or user.is_supervisor)
    )


def participa(user, chat: Chat) -> bool:
    """`user` entrou nesta conversa como participante (não é o dono)."""
    return chat.participants.filter(pk=user.pk).exists()


def _sistema_na_sala(chat: Chat, body: str) -> ChatMessage:
    """Grava a mensagem de sistema e a entrega AO VIVO na sala.

    `take_chat`/`transfer` avisam a sala com um evento próprio e o front
    recarrega a conversa; aqui a própria mensagem viaja, no mesmo formato
    de uma mensagem comum (o que `tasks._serializar_sistema` já faz para o
    aviso de inatividade) — quem está com a conversa aberta vê "fulano
    entrou" na hora, dos dois lados, sem refetch."""
    from apps.chat.serializers import ChatMessageSerializer

    msg = ChatMessage.objects.create(chat=chat, is_system=True, body=body)
    payload = dict(ChatMessageSerializer(msg).data)
    transaction.on_commit(lambda: _sala(chat.pk, {"type": "chat.message", **payload}))
    return msg


def join_chat(*, chat: Chat, actor) -> Chat:
    """Supervisor ENTRA na conversa de outro agente sem tirá-la dele.

    Passa a escrever como o agente (mensagem e nota interna — ver
    `can_send`), mas o atendimento continua do dono. Por isso entrar NÃO
    consome vaga do limite de simultâneos: o teto conta conversas que a
    pessoa atende, e quem entra para ajudar não passa a atender. Assumir
    (abaixo) consome.

    O cliente é avisado pela mensagem de sistema: é a mesma frase de quando
    um agente pega o chat, porque para ele é a mesma coisa — tem mais alguém
    falando do lado de cá.
    """
    if not pode_supervisionar(actor):
        raise ChatRuleViolation(
            "Só supervisor ou admin entra na conversa de outro agente.",
            code="sem_permissao",
        )
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status != ChatStatus.ACTIVE:
            raise ChatRuleViolation("Só dá para entrar numa conversa em atendimento.")
        if chat.agent_id == actor.pk:
            raise ChatRuleViolation("Esta conversa já é sua.")
        if chat.participants.filter(pk=actor.pk).exists():
            raise ChatRuleViolation("Você já está nesta conversa.")
        chat.participants.add(actor)
        _sistema_na_sala(chat, f"{actor.full_name} entrou na conversa.")
    auditar(
        chat=chat, actor=actor, action="update",
        summary=f"{actor.full_name} entrou na conversa de "
                f"{chat.agent.full_name if chat.agent else 'outro agente'}.",
        changes={"participants": ["", actor.full_name]},
    )
    return chat


def leave_chat(*, chat: Chat, actor) -> Chat:
    """Quem entrou sai — o atendimento segue com o dono, como estava."""
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if not chat.participants.filter(pk=actor.pk).exists():
            raise ChatRuleViolation("Você não está participando desta conversa.")
        chat.participants.remove(actor)
        # conversa já encerrada não ganha mensagem nova: sair dela é só
        # arrumação da lista de participantes, o cliente não precisa saber
        if chat.status == ChatStatus.ACTIVE:
            _sistema_na_sala(chat, f"{actor.full_name} saiu da conversa.")
    auditar(
        chat=chat, actor=actor, action="update",
        summary=f"{actor.full_name} saiu da conversa.",
        changes={"participants": [actor.full_name, ""]},
    )
    return chat


def assume_chat(*, chat: Chat, actor) -> Chat:
    """Supervisor ASSUME o atendimento: a conversa passa a ser dele.

    É uma transferência que parte de quem recebe, então vale a mesma régua
    da transferência — inclusive o limite de simultâneos de quem assume, que
    agora ganha uma conversa para atender. Quem atendia sai da conversa (não
    fica como participante): assumir é tirar, não somar; para somar existe
    "entrar na conversa".
    """
    if not pode_supervisionar(actor):
        raise ChatRuleViolation(
            "Só supervisor ou admin assume a conversa de outro agente.",
            code="sem_permissao",
        )
    if not sob_o_limite(actor):
        raise ChatRuleViolation(
            f"Você já está no limite de {ChatConfig.load().max_chats_per_agent} "
            "chats simultâneos — encerre um para assumir este."
        )
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status != ChatStatus.ACTIVE:
            raise ChatRuleViolation("Só dá para assumir uma conversa em atendimento.")
        if chat.agent_id == actor.pk:
            raise ChatRuleViolation("Esta conversa já é sua.")
        de = chat.agent
        chat.agent = actor
        chat.save(update_fields=["agent", "updated_at"])
        chat.participants.remove(actor)
        ChatMessage.objects.create(
            chat=chat, is_system=True,
            body=(f"{actor.full_name} assumiu o atendimento de {de.full_name}."
                  if de else f"{actor.full_name} assumiu a conversa."),
        )
    auditar(
        chat=chat, actor=actor, action="assign",
        summary=(f"{actor.full_name} assumiu o atendimento"
                 + (f" (antes com {de.full_name})" if de else "")),
        changes={"agent": [de.full_name if de else None, actor.full_name]},
    )
    # o MESMO evento da transferência: quem está com a sala aberta (o agente
    # que atendia, o cliente) recarrega a conversa e as listas. Sem aviso
    # pessoal para quem perdeu a conversa: o `chat_transferred` do canal
    # pessoal toca som e diz "recebeu" — o contrário do que aconteceu com
    # ele; a lista dele se acerta pelo refetch.
    _sala(chat.pk, {"type": "chat.transferred", "agent_name": actor.full_name})
    return chat


def close_chat(*, chat: Chat, actor, agent_score: int | None = None,
               reason=None, note: str = "", automatic: bool = False,
               rating: dict | None = None) -> Chat:
    """Encerra — cliente, agente ou o próprio sistema (inatividade/expediente).

    A confirmação de "tem certeza?" é do front; aqui já chega decidido. Nota do
    agente sobre o cliente é interna e só o lado interno grava.

    `reason`/`note` são o motivo de encerramento (`ChatCloseReason`) e a
    observação INTERNA de quem encerrou — o cliente não vê nenhum dos dois. O
    motivo que se declara `requires_note` cobra a observação aqui, no serviço:
    o seletor do front esconde o campo quando não precisa, mas quem garante é
    o backend (esconder no front não é validação).

    `automatic=True` marca fechamento sem gente do outro lado. `actor` fica
    `None` nesse caso: `closed_by` é "quem clicou", e ninguém clicou.

    `rating` (só o CLIENTE manda) encerra e avalia numa transação só. É o que
    faz valer o "só finaliza depois que a avaliação for salva com sucesso" do
    brief: a avaliação grava com o chat já CLOSED dentro da transação, e se
    ela falhar TUDO desfaz — o chat continua aberto, e a pessoa tenta de novo
    com o que digitou ainda na tela. Encerrar primeiro e avaliar depois, em
    duas chamadas, deixaria a janela onde o chat fecha e a nota se perde.

    Quando quem encerra é o AGENTE (ou o sistema), não há avaliação aqui: o
    cliente não está necessariamente na tela. A nota fica pendente e o portal
    a cobra na próxima vez que ele entrar — é o que `rating_pending` e
    `pending_ratings` já sustentam.

    Idempotente por lock: dois cliques simultâneos disputam o
    `select_for_update`, o segundo encontra CLOSED e é recusado — nunca dois
    encerramentos no mesmo chat.
    """
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status == ChatStatus.CLOSED:
            raise ChatRuleViolation("Este chat já está encerrado.")
        if reason is not None and reason.requires_note and not note.strip():
            raise ChatRuleViolation(
                f'O motivo "{reason.name}" pede uma observação interna.'
            )
        chat.status = ChatStatus.CLOSED
        chat.closed_at = timezone.now()
        chat.closed_by = None if automatic else actor
        chat.closed_automatically = automatic
        chat.close_reason = reason
        chat.close_note = note.strip()
        campos = ["status", "closed_at", "closed_by", "closed_automatically",
                  "close_reason", "close_note", "updated_at"]
        if actor is not None and actor.is_internal and agent_score is not None:
            _validar_nota(agent_score)
            chat.agent_score = agent_score
            campos.append("agent_score")
        chat.save(update_fields=campos)
        ChatMessage.objects.create(chat=chat, is_system=True, body="Conversa encerrada.")
        if rating is not None:
            if actor is None or actor.is_internal:
                raise ChatRuleViolation("Só o cliente avalia o próprio atendimento.")
            # dentro da MESMA transação: `rate` exige CLOSED e já é essa a
            # situação aqui. Se levantar, o encerramento desfaz junto.
            rate(chat=chat, client=actor, **rating)
        transaction.on_commit(lambda: _notify_client_closed(chat.pk))
    quem = "automaticamente" if automatic else (
        actor.full_name if actor is not None else "sistema"
    )
    auditar(
        chat=chat, actor=None if automatic else actor, action="status_change",
        summary=(f"Encerrado {quem}"
                 + (f" — {reason.name}" if reason is not None else "")),
        changes={
            "status": [ChatStatus.ACTIVE, ChatStatus.CLOSED],
            "close_reason": [None, reason.slug if reason is not None else None],
            "automatic": [False, automatic],
        },
    )
    _sala(chat.pk, {
        "type": "chat.closed",
        "by_internal": bool(actor is not None and actor.is_internal),
    })
    _agentes({"type": "chat.taken", "chat_id": chat.pk, "agent_id": 0})  # some da fila
    return chat


def _notify_client_closed(chat_pk: int) -> None:
    """Avisa o CLIENTE que a conversa terminou — quem encerrou não importa.

    O que a pessoa precisa saber é o que vem depois: a avaliação ficou
    pendente (e é ela que libera o próximo chat), ou onde reler a conversa.
    Sai sob CHAT_CLOSED, cada canal com a própria preferência da conta —
    é o interruptor "chat encerrado" das Configurações do portal. Conversão
    em ticket não passa por aqui: ela fecha o chat direto e tem o próprio
    aviso (`chat_converted`). Depois do commit, como todo aviso: um
    encerramento desfeito não pode ter sido anunciado.
    """
    from apps.notifications.models import NotificationKind
    from apps.notifications.services import notify, quer_email, queue_email

    try:
        chat = Chat.objects.select_related("client", "agent").get(pk=chat_pk)
        client = chat.client
        if client is None or client.is_internal:
            return
        com_agente = f" com {chat.agent.full_name}" if chat.agent else ""
        pendente = chat.rating_pending
        titulo = "Sua conversa por chat foi encerrada"
        proximo_passo = (
            "Avalie o atendimento pelo portal — é rápido, e é o que libera o próximo chat."
            if pendente
            else "A conversa continua disponível para leitura no portal."
        )
        notify(
            recipient=client,
            kind=NotificationKind.CHAT_CLOSED,
            title=titulo,
            body=proximo_passo,
            url=f"/portal/chat?chat={chat.pk}",
        )
        if client.email and quer_email(client, NotificationKind.CHAT_CLOSED):
            from django.conf import settings

            marca = f"{chat.closed_at:%Y%m%d%H%M%S}" if chat.closed_at else "sem-data"
            queue_email(
                to=client.email,
                subject=titulo,
                template="chat_closed",
                context={
                    "client_name": client.full_name,
                    "com_agente": com_agente,
                    "proximo_passo": proximo_passo,
                    "link": f"{settings.SITE_URL}/portal/chat?chat={chat.pk}",
                },
                # reaberto e encerrado de novo é outro atendimento: outro e-mail
                dedupe_key=f"chat-closed-{chat.pk}-{marca}",
            )
    except Exception:  # noqa: BLE001 — aviso não derruba o encerramento já commitado
        logger.exception("Falha ao avisar o cliente do encerramento do chat %s", chat_pk)


def reopen(*, chat: Chat, actor, note: str = "") -> Chat:
    """Reabre um fechado mantendo o histórico — volta pra FILA GERAL (não
    necessariamente pro mesmo agente), com o relógio do timeout zerado.

    `note` é o motivo da reabertura (interno). O protocolo NÃO muda: reabrir
    é a continuação do mesmo atendimento, e é por isso que `reopen_count`
    existe — o relatório separa os ciclos sem precisar de um chat novo.

    A avaliação do ciclo anterior fica de pé: `ChatRating` é OneToOne do chat,
    então o cliente não avalia duas vezes o mesmo atendimento (critério 2 do
    aceite) mesmo passando por vários ciclos de reabertura.
    """
    with transaction.atomic():
        chat = Chat.objects.select_for_update().get(pk=chat.pk)
        if chat.status != ChatStatus.CLOSED:
            raise ChatRuleViolation("Só um chat encerrado pode ser reaberto.")
        if getattr(chat, "generated_ticket", None) is not None:
            raise ChatRuleViolation(
                "Este chat virou um ticket — a conversa continua por lá."
            )
        if not actor.is_internal:
            # reabrir É abrir chat novo pro expediente: fila vazia de agente
            # não deve receber reabertura de madrugada
            if fora_do_expediente():
                raise ChatRuleViolation(
                    "Estamos fora do horário de atendimento por chat. "
                    "Abra um ticket e a equipe responde assim que o expediente começar.",
                    code="fora_do_expediente",
                )
            # reabrir conta como "chat novo" pro bloqueio de avaliação — e o
            # PRÓPRIO chat pendente também: a regra é "antes de reabrir, a
            # nota" (decisão de produto; antes o próprio podia ser retomado)
            if pending_ratings(actor).exists():
                raise ChatRuleViolation(
                    "Avalie o atendimento antes de reabrir a conversa.",
                    code="rating_pending",
                )
            outro_vivo = Chat.objects.filter(
                client=actor, status__in=[ChatStatus.QUEUED, ChatStatus.ACTIVE]
            ).exists()
            if outro_vivo:
                raise ChatRuleViolation("Você já tem um chat aberto.")
        else:
            # A mesma checagem, do lado de quem ATENDE. Ela existia só no
            # ramo do cliente, mas a constraint do banco
            # (`uniq_chat_aberto_por_login`) não distingue quem reabriu: o
            # agente reabrindo um fechado de alguém que já voltou a conversar
            # estourava IntegrityError e virava 500 com o texto cru do
            # Postgres na tela. A regra é do dado, não do papel.
            outro_vivo = Chat.objects.filter(
                client=chat.client, status__in=[ChatStatus.QUEUED, ChatStatus.ACTIVE]
            ).exclude(pk=chat.pk).exists()
            if outro_vivo:
                raise ChatRuleViolation(
                    f"{chat.client.full_name} já tem um atendimento aberto — "
                    "só existe uma conversa viva por cliente."
                )
        chat.status = ChatStatus.QUEUED
        chat.agent = None
        chat.accepted_at = None
        chat.closed_at = None
        chat.closed_by = None
        # o encerramento anterior deixa de valer — o motivo do ciclo velho
        # fica na auditoria, não pendurado num chat que está de novo aberto
        chat.close_reason = None
        chat.close_note = ""
        chat.closed_automatically = False
        chat.queued_at = timezone.now()
        chat.reopen_count += 1
        chat.save(update_fields=[
            "status", "agent", "accepted_at", "closed_at", "closed_by",
            "close_reason", "close_note", "closed_automatically",
            "queued_at", "reopen_count", "updated_at",
        ])
        # quem tinha entrado no ciclo anterior não volta a escrever sozinho
        # quando outro agente pegar a reabertura — entra de novo se precisar
        chat.participants.clear()
        ChatMessage.objects.create(
            chat=chat, is_system=True, body="Conversa reaberta — aguardando atendimento.",
        )
    auditar(
        chat=chat, actor=actor, action="status_change",
        summary=(f"Reaberto por {actor.full_name}"
                 + (f" — {note.strip()}" if note.strip() else "")),
        changes={"status": [ChatStatus.CLOSED, ChatStatus.QUEUED],
                 "reopen_count": [chat.reopen_count - 1, chat.reopen_count]},
    )
    transaction.on_commit(lambda: _avisar_fila(chat))
    return chat


def rate(*, chat: Chat, client, service_score: int, resolution_score: int,
         justification: str = ""):
    """Grava a avaliação do cliente. A regra da justificativa obrigatória
    (nota < gatilho) valida AQUI, com os números correntes do config."""
    from apps.chat.models import ChatRating

    chat.refresh_from_db()
    if chat.client_id != client.id:
        raise ChatRuleViolation("Só quem foi atendido avalia.")
    if chat.status != ChatStatus.CLOSED:
        raise ChatRuleViolation("A avaliação abre quando o chat encerra.")

    _validar_nota(service_score)
    _validar_nota(resolution_score)
    config = ChatConfig.load()
    if (service_score < config.low_score_threshold
            or resolution_score < config.low_score_threshold):
        if not justification.strip():
            raise ChatRuleViolation(
                "Nota abaixo de "
                f"{config.low_score_threshold} pede uma justificativa."
            )
    # Duplo envio (clique duplo, retry do cliente depois de um timeout que na
    # verdade gravou) não pode virar duas avaliações. O `hasattr` sozinho tem
    # janela de corrida entre a checagem e o insert; quem fecha de verdade é o
    # OneToOne no banco — o IntegrityError vira a mesma recusa de negócio.
    if hasattr(chat, "rating"):
        raise ChatRuleViolation("Este chat já foi avaliado.")
    try:
        with transaction.atomic():
            avaliacao = ChatRating.objects.create(
                chat=chat, service_score=service_score,
                resolution_score=resolution_score,
                justification=justification.strip(),
            )
    except IntegrityError as erro:
        raise ChatRuleViolation("Este chat já foi avaliado.") from erro
    auditar(
        chat=chat, actor=client, action="create",
        summary=(f"Avaliado: atendimento {service_score}, "
                 f"resolução {resolution_score}"),
        changes={"service_score": [None, service_score],
                 "resolution_score": [None, resolution_score]},
    )
    return avaliacao


def apply_macro(*, chat: Chat, macro, actor) -> Chat:
    """Macro preenche os campos de atendimento — soma, não zera: campo vazio
    na macro deixa em paz o que o agente já preencheu na mão."""
    if chat.agent_id != actor.pk and not actor.is_admin:
        raise ChatRuleViolation("Só quem está atendendo aplica macro.")
    campos = []
    if macro.chat_name and not chat.name:
        chat.name = macro.chat_name
        campos.append("name")
    if macro.category_id:
        chat.category_id = macro.category_id
        campos.append("category")
    if macro.priority:
        chat.priority = macro.priority
        campos.append("priority")
    if macro.assignee_id:
        chat.assignee_id = macro.assignee_id
        campos.append("assignee")
    if campos:
        campos.append("updated_at")
        chat.save(update_fields=campos)
    etiquetas = list(macro.tags.all())
    if etiquetas:
        chat.tags.add(*etiquetas)
    return chat


def _validar_nota(valor: int):
    config = ChatConfig.load()
    if not (config.score_min <= valor <= config.score_max):
        raise ChatRuleViolation(
            f"Nota fora da escala ({config.score_min} a {config.score_max})."
        )


# ---------------------------------------------------------------------- #
# Eventos (channel layer)
# ---------------------------------------------------------------------- #

def _group_send(group: str, event: dict) -> None:
    """Broadcast pelo channel layer — TRANSPORTE, não verdade. A operação
    (pegar, encerrar, converter…) já foi gravada quando chega aqui; se o
    Redis estiver fora do ar, o que se perde é o aviso ao vivo, e o front
    recupera por REST (`refetchInterval` das listas, `?after=` da sala).
    Deixar a exceção subir devolvia 500 a uma ação que tinha dado certo."""
    layer = get_channel_layer()
    if layer is None:
        return
    try:
        async_to_sync(layer.group_send)(group, event)
    except Exception:  # noqa: BLE001 — qualquer falha do layer é só perda do aviso
        logger.warning("channel layer indisponível — evento %s para %s não foi entregue",
                       event.get("type"), group, exc_info=True)


def _sala(chat_id: int, event: dict) -> None:
    _group_send(f"chat_{chat_id}", event)


def _agentes(event: dict) -> None:
    _group_send(GRUPO_AGENTES, event)


def _pessoal(user_id: int, payload: dict) -> None:
    _group_send(f"user_{user_id}", {"type": "notify", **payload})


def _avisar_fila(chat: Chat) -> None:
    """Chat novo na fila → popup em TODO agente que ainda tem vaga.

    O filtro do limite é do SERVIDOR (o consumer repassa; quem está no teto
    não recebe) — o front não é confiável pra esconder aviso de trabalho.
    """
    _agentes({
        "type": "chat.queued",
        "chat_id": chat.pk,
        "client_name": chat.client.full_name,
        "company": chat.company.name,
        "queued_at": chat.queued_at.isoformat(),
    })
