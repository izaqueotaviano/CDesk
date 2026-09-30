"""Chat v2 — módulo reconstruído do zero (pedido do Izaque).

Princípios que mudaram em relação ao chat antigo:

- **Fila única, sem equipe.** Todo agente vê todo chat que entra; quem pega
  primeiro leva (lock atômico no serviço). Equipe só volta a existir no
  momento da conversão em ticket — o agente escolhe na manual, e a
  automática (timeout) cai na equipe padrão do `ChatConfig`.
- **Um chat aberto por LOGIN**, não por empresa: dois funcionários da mesma
  empresa conversam em paralelo. A invariante é do banco (constraint
  parcial), não de um `if`.
- **Independente de tickets.** Métrica, configuração e dado próprios. Os
  DOIS únicos pontos de acoplamento são as conversões (manual e por
  timeout) — `Ticket.origin_chat` aponta pra cá, e mais nada.
- **Avaliação é motor, não enfeite:** chat fechado sem nota bloqueia o
  cliente de abrir um novo (regra em `chat_service`); a pendência é
  derivável daqui — CLOSED + sem `rating` + sem ticket gerado.

O banco continua sendo a fonte da verdade e o WebSocket só transporte:
mensagem persiste antes do group_send, reconectar é recarregar por REST.
"""

from django.core.cache import cache
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.tickets.models import TicketPriority


class ChatStatus(models.TextChoices):
    QUEUED = "queued", "Na fila"
    ACTIVE = "active", "Em atendimento"
    CLOSED = "closed", "Fechado"


class Chat(TimeStampedModel):
    """Uma conversa. Nasce na fila, um agente pega, fecha — e pode reabrir.

    Os campos de atendimento (nome interno, categoria, urgência, responsável,
    etiquetas) existem AQUI, não só no ticket: a macro preenche durante a
    conversa, e a conversão os copia. O nome interno só chega ao cliente se
    o chat virar ticket (vira o assunto).
    """

    company = models.ForeignKey(
        "customers.Company", on_delete=models.PROTECT, related_name="chats"
    )
    client = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="chats"
    )
    agent = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chats_atendidos",
    )
    status = models.CharField(
        max_length=10, choices=ChatStatus.choices,
        default=ChatStatus.QUEUED, db_index=True,
    )
    # Quem ENTROU na conversa sem ser o dono dela — o supervisor que chega
    # para ajudar ("Entrar na conversa", `chat_service.join_chat`). Escreve
    # como o agente, mas o atendimento continua sendo de `agent`: o limite de
    # simultâneos, "meus chats" e as métricas seguem contando só o dono. M2M,
    # e não um segundo FK, porque nada impede dois supervisores na mesma
    # conversa difícil.
    participants = models.ManyToManyField(
        "accounts.User", blank=True, related_name="chats_participando",
        verbose_name="participantes",
    )

    # nome interno dado pelo agente ("o cliente escreve qualquer coisa na
    # primeira mensagem") — vira o assunto do ticket na conversão
    name = models.CharField(max_length=200, blank=True)

    # --- campos de atendimento (mesma tipagem do ticket; a macro preenche) ---
    category = models.ForeignKey(
        "tickets.TicketCategory",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="chats",
    )
    priority = models.CharField(
        max_length=10, choices=TicketPriority.choices, default=TicketPriority.NORMAL
    )
    assignee = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="chats_designados",
        help_text="Responsável que o ticket recebe na conversão. Vazio = o próprio agente.",
    )
    tags = models.ManyToManyField("tickets.TicketTag", blank=True, related_name="chats")

    # --- linha do tempo ---
    # `default` e não `auto_now_add`: reabrir devolve o chat à fila e ZERA o
    # relógio de espera — o timeout de fila conta a partir da reabertura.
    queued_at = models.DateTimeField(default=timezone.now, db_index=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="chats_encerrados",
    )
    # Por que terminou + a observação interna de quem encerrou. `PROTECT` no
    # motivo pelo mesmo motivo do `is_active`: relatório de trás não pode
    # perder a legenda porque alguém limpou o cadastro.
    close_reason = models.ForeignKey(
        "chat.ChatCloseReason",
        on_delete=models.PROTECT, null=True, blank=True,
        related_name="chats", verbose_name="motivo do encerramento",
    )
    close_note = models.TextField(
        blank=True, verbose_name="observação do encerramento",
        help_text="Interna: o cliente nunca vê.",
    )
    # Encerrou sozinho (inatividade/expediente) ou alguém encerrou? O
    # `closed_by` não responde isso: fechamento automático não tem ator, e
    # `closed_by IS NULL` também acontece quando a conta do agente é
    # removida depois. Um booleano explícito é o que o relatório consegue
    # somar sem adivinhar.
    closed_automatically = models.BooleanField(
        default=False, verbose_name="encerrado automaticamente"
    )
    reopen_count = models.PositiveSmallIntegerField(default=0)

    # nota do AGENTE sobre o atendimento (0–10) — interna, o cliente nunca vê
    agent_score = models.PositiveSmallIntegerField(null=True, blank=True)

    # timeout de fila: ninguém pegou e o sistema converteu sozinho
    timeout_converted = models.BooleanField(default=False)

    # Aviso de inatividade já mandado — para não repetir a cada passagem da
    # rotina. Zera a cada mensagem nova: quem voltou a falar não está inativo.
    inactivity_warned_at = models.DateTimeField(null=True, blank=True)

    # Retenção (D18): o CONTEÚDO da conversa expira, a linha fica. Mesmo
    # carimbo do `Ticket.retention_purged_at`, e pelo mesmo motivo — sem ele
    # a rotina não sabe o que já passou e reprocessaria tudo toda vez.
    retention_purged_at = models.DateTimeField(null=True, blank=True)

    # O ticket gerado é acessível por `self.generated_ticket` (OneToOne em
    # tickets.Ticket.origin_chat — a FK mora lá para evitar ciclo de import).

    class Meta:
        verbose_name = "chat"
        verbose_name_plural = "chats"
        constraints = [
            # um chat vivo por LOGIN — invariante de negócio mora no banco;
            # o check-then-create do serviço tem janela de corrida (duas
            # abas), a constraint parcial é o que a fecha de verdade
            models.UniqueConstraint(
                fields=["client"],
                condition=models.Q(status__in=["queued", "active"]),
                name="uniq_chat_aberto_por_login",
            )
        ]

    def __str__(self):
        return f"Chat #{self.pk} · {self.client} ({self.get_status_display()})"

    @property
    def rating_pending(self) -> bool:
        """Fechou sem nota do cliente → pendência que bloqueia chat novo.

        Chat convertido em ticket não cobra avaliação: a conversa continua
        no ticket (que tem a própria pesquisa de satisfação) — essa é a
        única exceção. Fechado sem nunca ter sido atendido (o cliente
        desistiu da fila) COBRA nota também: é sinal válido de que a fila
        falhou com o cliente, não "nada para avaliar".
        """
        if self.status != ChatStatus.CLOSED:
            return False
        if getattr(self, "generated_ticket", None) is not None:
            return False
        return not hasattr(self, "rating")


class ChatMessage(models.Model):
    chat = models.ForeignKey(Chat, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_messages",  # null = mensagem de sistema/boas-vindas
    )
    body = models.TextField()
    is_system = models.BooleanField(default=False)

    # NOTA INTERNA: fica na conversa, mas o cliente nunca a vê. É o recado da
    # equipe sobre o atendimento ("já pedi o estorno pro financeiro") no lugar
    # onde ele faz sentido — dentro da conversa — em vez de num canal paralelo
    # que ninguém encontra depois.
    #
    # Quem decide o que sai é `chat_service.mensagens_visiveis()`, UM lugar só.
    # Espalhar `if user.is_internal` por cada consulta é como um vazamento
    # destes acontece: alguém acrescenta a sétima consulta e esquece a
    # condição. O socket tem o mesmo cuidado no `chat_message` do consumer.
    is_internal_note = models.BooleanField(default=False, db_index=True)

    sent_at = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at = models.DateTimeField(null=True, blank=True)

    # A escada de status que a tela desenha para QUEM ESCREVEU: enviada
    # (existe id), entregue (chegou no aparelho do outro) e lida. "Entregue"
    # é carimbado pelo destinatário, não pelo servidor — dizer "entregue"
    # porque o INSERT deu certo seria mentir sobre a única coisa que o
    # indicador promete. Sem confirmação, fica em "enviada", que é verdade.
    delivered_at = models.DateTimeField(null=True, blank=True)

    # Resposta citada. SET_NULL e não CASCADE: apagar o original não pode
    # levar junto as respostas dele — a conversa perderia trechos inteiros
    # por causa de uma mensagem só. A citação some, a resposta fica.
    reply_to = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="replies",
    )

    # Mesmo par que TicketMessage já usa — edited_at é o que a tela mostra
    # como "editada"; o texto anterior não fica registrado aqui de propósito
    # (o chat não tem uma trilha de auditoria própria como o ticket tem).
    edited_at = models.DateTimeField(null=True, blank=True)
    edited_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="edited_chat_messages",
    )
    # Apagar é MARCAR, nunca sumir a linha — mesmo motivo do ticket: a
    # ordem da conversa contínua (chat/timeline/) e o WebSocket dos dois
    # lados dependem de a linha continuar existindo. O corpo some, a linha
    # fica como "Esta mensagem foi apagada."
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="deleted_chat_messages",
    )

    class Meta:
        verbose_name = "mensagem de chat"
        verbose_name_plural = "mensagens de chat"
        indexes = [models.Index(fields=["chat", "sent_at"])]
        # ordenação canônica é o id (BigAutoField), não o relógio do cliente
        ordering = ["id"]

    def __str__(self):
        return f"Msg #{self.pk} (chat {self.chat_id})"


class ChatScanStatus(models.TextChoices):
    """Varredura antivírus do anexo — mesmo vocabulário de `tickets.ScanStatus`
    (D19), duplicado de propósito: o chat não depende do modelo de ticket."""

    PENDING = "pending", "Em verificação"
    CLEAN = "clean", "Limpo"
    INFECTED = "infected", "Infectado"
    ERROR = "error", "Falha na verificação"
    SKIPPED = "skipped", "Não verificado"


class ChatFile(models.Model):
    """D13/D19 aplicados ao chat: nunca servido por URL pública (a view de
    download reavalia participação a cada pedido) e em quarentena até a
    varredura antivírus liberar — a mesma política dos anexos de ticket."""

    message = models.ForeignKey(
        ChatMessage, on_delete=models.CASCADE, related_name="files"
    )
    file = models.FileField(upload_to="chat/%Y/%m/")
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveIntegerField()
    checksum = models.CharField(max_length=64, blank=True)  # sha256
    uploaded_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        related_name="chat_files",
    )

    # Retenção/LGPD: o BLOB sai, a linha fica — mesmo campo e mesma semântica
    # de `TicketAttachment.purged_at`, para o `purge_blob` servir aos dois. Sem
    # ele o anexo de chat era o único conteúdo do sistema que nenhuma política
    # alcançava: a mensagem virava "[expurgado]" e o arquivo continuava no disco.
    purged_at = models.DateTimeField(null=True, blank=True)

    scan_status = models.CharField(
        max_length=10, choices=ChatScanStatus.choices,
        default=ChatScanStatus.PENDING, db_index=True,
    )
    scan_signature = models.CharField(max_length=200, blank=True)
    scan_error = models.CharField(max_length=250, blank=True)
    scan_attempts = models.PositiveSmallIntegerField(default=0)
    scanned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "anexo de chat"
        verbose_name_plural = "anexos de chat"

    def __str__(self):
        return self.filename

    @property
    def is_purged(self) -> bool:
        return self.purged_at is not None

    @property
    def is_downloadable(self) -> bool:
        """Quarentena: só sai do servidor o que a varredura liberou. `ERROR`
        segue o fail-closed global (`ATTACHMENT_BLOCK_ON_SCAN_ERROR`)."""
        from django.conf import settings

        # expurgado não tem o que servir — e o teste vem antes da varredura
        # porque um arquivo limpo apagado continua apagado
        if self.purged_at is not None:
            return False
        if self.scan_status in (ChatScanStatus.CLEAN, ChatScanStatus.SKIPPED):
            return True
        if self.scan_status == ChatScanStatus.ERROR:
            return not settings.ATTACHMENT_BLOCK_ON_SCAN_ERROR
        return False


class ChatCloseReason(models.Model):
    """Por que o atendimento terminou — cadastro do admin, não enum no código.

    É a mesma escolha do `TicketStatus`/`TicketTag`: motivo de encerramento
    é vocabulário de operação, muda por empresa e por época ("abandono",
    "duplicado", "transferido para o financeiro"), e congelar isso num
    `TextChoices` obrigaria deploy para cada palavra nova.

    `requires_note` é por motivo, não global: "resolvido" não precisa de
    explicação, "outro" precisa. Quem decide é quem cadastra.

    Desativar (`is_active=False`) em vez de apagar: o motivo sai do seletor
    mas os atendimentos que já o usaram continuam legíveis no relatório —
    apagar reescreveria o passado.
    """

    name = models.CharField(max_length=60, unique=True, verbose_name="motivo")
    slug = models.SlugField(unique=True)
    requires_note = models.BooleanField(
        default=False,
        verbose_name="exige observação",
        help_text="O agente precisa escrever uma observação interna ao escolher este motivo.",
    )
    is_active = models.BooleanField(default=True, verbose_name="ativo")
    order = models.PositiveSmallIntegerField(default=0, verbose_name="ordem")

    class Meta:
        ordering = ["order", "name"]
        verbose_name = "motivo de encerramento"
        verbose_name_plural = "motivos de encerramento"

    def __str__(self):
        return self.name


class ChatRating(models.Model):
    """A avaliação do cliente ao fim do chat — DUAS notas de propósito.

    Atendimento e resolução são perguntas diferentes: o agente pode tratar
    bem e não ter como resolver. Justificativa é obrigatória quando qualquer
    nota fica abaixo do gatilho do `ChatConfig` (validação no serializer —
    o gatilho é editável, o banco não pode congelar o número).
    """

    chat = models.OneToOneField(Chat, on_delete=models.CASCADE, related_name="rating")
    service_score = models.PositiveSmallIntegerField("nota de atendimento")
    resolution_score = models.PositiveSmallIntegerField("nota de resolução")
    justification = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "avaliação de chat"
        verbose_name_plural = "avaliações de chat"

    def __str__(self):
        return (
            f"Chat #{self.chat_id}: atendimento {self.service_score}, "
            f"resolução {self.resolution_score}"
        )


class ChatConfig(TimeStampedModel):
    """Configuração do módulo, em linha única (singleton) — tudo que o admin
    edita sem deploy: mensagem de boas-vindas, timeout, limites e a escala
    de nota. Mesmo padrão do `SystemConfig` do core."""

    CACHE_KEY = "chat:config"

    welcome_message = models.TextField(
        default="Olá {{nome_do_cliente}}, como podemos ajudar?",
        help_text="Enviada assim que o chat abre, antes de qualquer agente. "
                  "Variável disponível: {{nome_do_cliente}}.",
    )
    queue_timeout_minutes = models.PositiveSmallIntegerField(
        default=10,
        help_text="Ninguém pegou nesse tempo → vira o ticket “Chat não atendido”.",
    )
    max_chats_per_agent = models.PositiveSmallIntegerField(
        default=3,
        help_text="No limite, o agente para de receber o aviso de chat novo.",
    )
    score_min = models.PositiveSmallIntegerField(default=0)
    score_max = models.PositiveSmallIntegerField(default=10)
    low_score_threshold = models.PositiveSmallIntegerField(
        default=5,
        help_text="Nota ABAIXO disso exige justificativa do cliente.",
    )
    default_team = models.ForeignKey(
        "accounts.Team",
        on_delete=models.SET_NULL, null=True, blank=True,
        related_name="+",
        help_text="Equipe que recebe o ticket da conversão automática (timeout).",
    )

    # Inatividade DURANTE o atendimento — diferente do `queue_timeout_minutes`,
    # que é ninguém ter PEGADO. Aqui alguém pegou e a conversa parou.
    #
    # Zero DESLIGA, e é o padrão de propósito: encerrar sozinho o atendimento
    # de quem foi procurar um documento é pior do que deixar a conversa aberta.
    # Quem liga escolhe o tempo sabendo do próprio público.
    inactivity_warning_minutes = models.PositiveSmallIntegerField(
        default=0,
        help_text="Sem mensagem nenhuma por esse tempo, o chat avisa que vai "
                  "encerrar. 0 desliga o aviso.",
    )
    inactivity_close_minutes = models.PositiveSmallIntegerField(
        default=0,
        help_text="Sem mensagem nenhuma por esse tempo, o chat encerra sozinho "
                  "(contado desde a última mensagem, não desde o aviso). "
                  "0 desliga o encerramento automático.",
    )

    class Meta:
        verbose_name = "configuração do chat"

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton — nunca existe uma segunda linha para divergir
        if self._state.adding:
            existente = type(self).objects.filter(pk=1).values("created_at").first()
            if existente is not None:
                self._state.adding = False
                self.created_at = existente["created_at"]
        super().save(*args, **kwargs)
        cache.delete(self.CACHE_KEY)

    @classmethod
    def load(cls) -> "ChatConfig":
        config = cache.get(cls.CACHE_KEY)
        if config is None:
            config, _ = cls.objects.get_or_create(pk=1)
            cache.set(cls.CACHE_KEY, config, 300)
        return config


class ClientQuickReply(models.Model):
    """Frase pronta que o CLIENTE envia para começar uma conversa.

    Não é `TicketMacro`. A macro é do agente e carrega decisão de operação
    (responsável, prioridade, categoria, tags); isto aqui é só um texto que
    a pessoa do outro lado clica em vez de digitar. Juntar os dois no mesmo
    cadastro exporia campos internos numa tela de cliente e obrigaria toda
    macro a decidir se "aparece para o cliente" — um sim/não a mais em cada
    linha do catálogo do agente, para servir outro público.

    Serve o começo da conversa, que é onde a pessoa trava: `rotulo` é o que
    aparece no chip ("Problema com um pedido") e `texto` é o que vai para o
    compositor, editável antes de enviar — a frase é um atalho, não um
    formulário fechado.

    `contexto` separa DOIS catálogos que não se misturam. No chat a pessoa
    ABRE a conversa ("Problema com um pedido"); no chamado ela RESPONDE a
    quem já perguntou ("Ainda estou com o problema"). Oferecer o atalho de
    abertura como resposta a uma pergunta do atendimento seria o cliente
    mandar um não-sequitur, e o admin não teria como impedir. Um sim/não
    por linha resolve, e nada precisa de tabela nova.
    """

    class Contexto(models.TextChoices):
        CHAT = "chat", "chat"
        TICKET = "ticket", "chamado"

    contexto = models.CharField(
        max_length=8, choices=Contexto.choices, default=Contexto.CHAT,
        verbose_name="onde aparece",
        help_text="No chat (frases que ABREM a conversa) ou no chamado "
                  "(frases que RESPONDEM ao atendimento).",
    )
    rotulo = models.CharField(
        max_length=40, verbose_name="rótulo do atalho",
        help_text="O que aparece no chip. Curto: cabe em uma linha no telefone.",
    )
    texto = models.TextField(
        verbose_name="texto enviado",
        help_text="Vai para o campo de mensagem; o cliente ainda pode editar antes de enviar.",
    )
    is_active = models.BooleanField(default=True, verbose_name="ativo")
    order = models.PositiveSmallIntegerField(default=0, verbose_name="ordem")

    class Meta:
        ordering = ["order", "rotulo"]
        verbose_name = "atalho de mensagem do cliente"
        verbose_name_plural = "atalhos de mensagem do cliente"
        # A unicidade é POR CONTEXTO, não global: "Ainda estou com o
        # problema" pode existir nos dois catálogos sem que um bloqueie o
        # cadastro do outro.
        constraints = [
            models.UniqueConstraint(
                fields=["contexto", "rotulo"], name="atalho_unico_por_contexto"
            ),
        ]

    def __str__(self):
        return self.rotulo


class BannedWord(models.Model):
    """Lista de moderação: a palavra vira `****` na EXIBIÇÃO, pros dois lados.

    A censura acontece na serialização, não na gravação — o texto original
    fica no banco. É o que faz a lista valer retroativamente (palavra
    adicionada hoje censura mensagem de ontem) e um falso positivo removido
    da lista devolver o texto intacto.
    """

    word = models.CharField(max_length=60, unique=True)

    class Meta:
        verbose_name = "palavra filtrada"
        verbose_name_plural = "palavras filtradas"

    def __str__(self):
        return self.word

    def save(self, *args, **kwargs):
        self.word = self.word.strip().lower()
        super().save(*args, **kwargs)
        cache.delete("chat:banned-words")

    def delete(self, *args, **kwargs):
        super().delete(*args, **kwargs)
        cache.delete("chat:banned-words")
