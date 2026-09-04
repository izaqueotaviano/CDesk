"""Tickets — o coração do sistema.

Regras estruturais que este módulo carrega:
- Equipe restrita é configuração (`accounts.Team.visibility`), nunca código (P2/P3).
- `TicketQuerySet.visible_to()` é o ÚNICO caminho de leitura de ticket (docs/01 §2).
- Máquina de estados vive no service, sempre gravando `TicketStatusEvent`.

O agrupamento do ticket é a EQUIPE (`accounts.Team`), que absorveu o antigo
departamento — ver o cabeçalho de apps/accounts/models.py para o porquê da fusão.
"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class SLAPolicy(TimeStampedModel):
    """Prazo por (plano × equipe). O mais específico vence; ambos nulos = padrão global."""

    name = models.CharField(max_length=80)
    plan = models.ForeignKey(
        "customers.Plan",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="sla_policies",
    )
    team = models.ForeignKey(
        "accounts.Team",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="sla_policies",
    )
    first_response_minutes = models.PositiveIntegerField()
    resolution_minutes = models.PositiveIntegerField()
    use_business_hours = models.BooleanField(default=True)  # D15
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "política de SLA"
        verbose_name_plural = "políticas de SLA"
        constraints = [
            models.UniqueConstraint(
                fields=["plan", "team"],
                name="uniq_sla_policy",
                nulls_distinct=False,
            )
        ]

    def __str__(self):
        return self.name


class TicketStatus(models.TextChoices):
    """As quatro CATEGORIAS de status. Não são mais o que a tela mostra.

    O que a pessoa vê (e cria) é o `TicketStage` — a coluna do quadro. Cada
    stage pertence a uma destas categorias, e é a categoria que responde as
    perguntas do maquinário: o SLA parou? o chamado fechou? entra no relatório
    de resolvidos? conta para a retenção?

    Por isso elas continuam sendo `TextChoices` e `Ticket.status` continua
    gravando uma delas: os ~86 pontos do sistema que perguntam
    `status == CLOSED` seguem certos mesmo quando alguém cria um status
    "Resolvido" próprio — ele nasce dentro da categoria `closed` e o
    maquinário nem precisa saber que ele existe.
    """

    NEW = "new", "Novo"
    OPEN = "open", "Aberto"
    PENDING_CUSTOMER = "pending_customer", "Aguardando retorno"
    CLOSED = "closed", "Fechado"


# Paleta semântica por categoria — os mesmos tons dos quatro status de
# fábrica (migrations/0016_status_de_fabrica.py). Fonte única para o default
# que `TicketStageViewSet.perform_create` aplica quando o status novo não
# vem com cor explícita: sem isto, todo status customizado nascia cinza
# (o default plano do campo `color` abaixo), sem relação nenhuma com a
# categoria escolhida.
COR_POR_CATEGORIA = {
    TicketStatus.NEW: "#6C4E9C",
    TicketStatus.OPEN: "#5A87B8",
    TicketStatus.PENDING_CUSTOMER: "#E9A23B",
    TicketStatus.CLOSED: "#8A8A85",
}


class TicketStage(models.Model):
    """A coluna do quadro — e o status que a pessoa lê na tela.

    O quadro é separado por status do ticket; isto é esse status. Os quatro de
    fábrica espelham as categorias 1:1 (Novo, Aberto, Aguardando retorno,
    Fechado), e o admin pode criar outros — "Em análise" dentro de `open`,
    "Resolvido" dentro de `closed`.

    `category` é obrigatório e é a ponte com o maquinário: sem ela um status
    novo seria invisível para SLA e relatório, que é o modo de falha caro aqui
    (o chamado parece andar na tela e o prazo continua correndo sozinho).

    `is_system` protege os quatro de fábrica de serem apagados: eles são o
    destino de fallback quando um stage criado é removido, e o quadro precisa
    de pelo menos um stage por categoria para não esconder chamado.
    """

    slug = models.SlugField(max_length=40, unique=True)
    name = models.CharField(max_length=40)
    category = models.CharField(
        max_length=20, choices=TicketStatus.choices, db_index=True,
        help_text="O que este status significa para SLA, fechamento e relatórios.",
    )
    color = models.CharField(max_length=7, default="#8A8A85")
    order = models.PositiveSmallIntegerField(default=0)
    is_system = models.BooleanField(
        default=False, help_text="De fábrica: não pode ser apagado nem trocar de categoria."
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "status do quadro"
        verbose_name_plural = "status do quadro"
        ordering = ["order", "id"]

    def __str__(self):
        return self.name

    @property
    def is_done(self) -> bool:
        return self.category == TicketStatus.CLOSED


class TicketSource(models.TextChoices):
    WEB = "web", "Sistema"
    CHAT = "chat", "Chat ao vivo"
    INTERNAL = "internal", "Criado por agente"


class TicketPriority(models.TextChoices):
    LOW = "low", "Baixa"
    NORMAL = "normal", "Normal"
    HIGH = "high", "Alta"
    URGENT = "urgent", "Urgente"


class Service(TimeStampedModel):
    """Serviço — o nível acima de Categoria (Integrações, Loja, Pedidos, Fiscal…).

    Decisão (revisão GAPS.md #4): "Serviço" NÃO é sinônimo de Equipe. A
    auditoria de integração encontrou o front de referência usando um
    `CATEGORIAS_POR_SERVICO` — cada categoria pertence a exatamente um
    serviço, e trocar o serviço na tela filtra as categorias disponíveis.
    Equipe continua sendo só o agrupamento de atendimento (docs/01 §8); um
    serviço pode ser atendido por mais de uma equipe, e vice-versa — são
    dimensões independentes.

    Cadastrável pelo admin, como categoria e equipe: a lista é do negócio.
    """

    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(unique=True)
    is_active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "serviço"
        verbose_name_plural = "serviços"
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class TicketCategory(TimeStampedModel):
    """Natureza do chamado — Dúvida, Problema, Solicitação de serviço…

    Cadastrável pelo admin, como equipe: a lista é do negócio, não do
    código. Nada testa slug. Opcional no ticket: sem categoria o indicador
    conta como "Não informada", em vez de forçar uma escolha errada na abertura.

    `service` é opcional pelo mesmo motivo — categoria existente antes deste
    campo nascer fica "sem serviço" até alguém classificar, em vez de a
    migration ter de adivinhar.
    """

    name = models.CharField(max_length=60, unique=True)
    slug = models.SlugField(unique=True)
    service = models.ForeignKey(
        Service,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="categories",
    )
    is_active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "categoria"
        verbose_name_plural = "categorias"
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class TicketQuerySet(models.QuerySet):
    def visible_to(self, user):
        """Único ponto de leitura de ticket em toda a aplicação.

        D1: o recorte do usuário interno é o ESCOPO do papel dele
        (`rbac.TicketScope`), não mais "admin vê tudo, resto vê as equipes":

        - `ALL` — a fila inteira (padrão do admin);
        - `TEAMS` — as equipes em que tem vínculo (padrão de supervisor,
          agente e agente leve; é a regra D1 de sempre);
        - `ASSIGNED` — dentro das equipes dele, só o que está com ele.
          Interseção e não substituição: a fronteira de equipe é uma parede,
          e "atribuído a mim" nunca deveria furá-la para mostrar um ticket
          de uma equipe da qual a pessoa saiu.

        Cliente nunca cruza a fronteira da empresa; tickets restritos de
        outros usuários PERMANECEM na listagem (mascarados na serialização).

        Equipe interna é a única exceção a "permanecem mascarados": ali o
        ticket é NOSSO, sobre o cliente, e mostrar a linha mascarada já contaria
        que existe um assunto comercial em aberto com ele.
        """
        from apps.accounts import rbac

        if user.is_internal:
            escopo = rbac.ticket_scope_for(user)
            if escopo == rbac.TicketScope.ALL:
                return self
            qs = self.filter(team__agent_links__user=user).distinct()
            if escopo == rbac.TicketScope.ASSIGNED:
                # `owner` entra junto: dono técnico é responsabilidade sobre o
                # caso tanto quanto `assignee`, e um escopo que escondesse o
                # que a pessoa precisa entregar não teria utilidade nenhuma.
                qs = qs.filter(models.Q(assignee=user) | models.Q(owner=user))
            return qs
        return self.filter(
            company_id=user.company_id, team__internal_only=False
        )


class Ticket(TimeStampedModel):
    # TD-00123 do sistema (D12) ou a referência de origem do ticket importado
    # (MD-47416) — por isso a folga de largura
    reference = models.CharField(max_length=20, unique=True)
    company = models.ForeignKey(
        "customers.Company", on_delete=models.PROTECT, related_name="tickets"
    )
    requester = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="requested_tickets"
    )
    team = models.ForeignKey(
        "accounts.Team", on_delete=models.PROTECT, related_name="tickets"
    )

    subject = models.CharField(max_length=200)
    #: Número do pedido da loja a que este chamado se refere. Livre e opcional
    #: de propósito: cada e-commerce numera do seu jeito (com prefixo, com
    #: hífen, com zeros à esquerda), e validar formato aqui só faria a pessoa
    #: brigar com o campo para relatar um problema. Vale como AGRUPADOR — três
    #: chamados do mesmo pedido são um caso só para quem atende.
    order_number = models.CharField(
        max_length=40, blank=True, db_index=True,
        verbose_name="número do pedido",
    )
    # `status` é a CATEGORIA (ver TicketStatus): é o que o maquinário lê.
    # `stage` é o status que a pessoa vê e escolhe — a coluna do quadro.
    # Os dois nunca discordam: quem grava é `ticket_service`, que deriva a
    # categoria do stage. Guardar a categoria aqui, e não só seguir a FK, é o
    # que mantém os filtros e agregações do sistema inteiro simples e
    # indexados — e o que fez esta mudança não tocar nos ~86 pontos que já
    # perguntam `status=closed`.
    status = models.CharField(
        max_length=20, choices=TicketStatus.choices, default=TicketStatus.NEW, db_index=True
    )
    stage = models.ForeignKey(
        TicketStage,
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name="tickets",
        help_text="Coluna do quadro. Nulo só em chamado antigo, antes da migração.",
    )
    priority = models.CharField(
        max_length=10, choices=TicketPriority.choices, default=TicketPriority.NORMAL
    )
    # opcional: chamado antigo e chamado aberto sem escolha ficam "Não informada"
    category = models.ForeignKey(
        TicketCategory,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tickets",
    )
    source = models.CharField(
        max_length=10, choices=TicketSource.choices, default=TicketSource.WEB
    )

    # atribuição: assignee conversa com o cliente; owner responde pela solução (docs/05 §3.2)
    assignee = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_tickets",
    )
    owner = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_tickets",
    )

    # marcos temporais
    first_response_at = models.DateTimeField(null=True, blank=True)
    resolution_started_at = models.DateTimeField(null=True, blank=True)  # D4
    resolution_ended_at = models.DateTimeField(null=True, blank=True)  # D4
    closed_at = models.DateTimeField(null=True, blank=True)
    # D18: conteúdo expurgado por retenção. O esqueleto (referência, datas,
    # status, métricas) fica; assunto, corpo das mensagens e anexos saem.
    retention_purged_at = models.DateTimeField(null=True, blank=True)
    closed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="closed_tickets",
    )
    last_customer_message_at = models.DateTimeField(null=True, blank=True)
    last_agent_message_at = models.DateTimeField(null=True, blank=True)

    # reabertura
    reopen_count = models.PositiveSmallIntegerField(default=0)
    last_reopened_at = models.DateTimeField(null=True, blank=True)

    # Fechamento automático por falta de resposta (D5): marca a ORIGEM do
    # fechamento para distinguir de um fechamento manual do agente — só o
    # automático bloqueia reabertura por resposta (o cliente abre um novo
    # chamado). `auto_close_warned_at` evita mandar o aviso prévio duas vezes;
    # zera sempre que o ticket sai de "aguardando o cliente" (nova espera,
    # nova chance de aviso).
    auto_closed = models.BooleanField(
        default=False,
        verbose_name="Fechado automaticamente por falta de resposta",
    )
    auto_close_warned_at = models.DateTimeField(null=True, blank=True)

    # SLA denormalizado para listagem e alerta
    sla_policy = models.ForeignKey(
        SLAPolicy, on_delete=models.SET_NULL, null=True, blank=True, related_name="tickets"
    )
    sla_first_response_due_at = models.DateTimeField(null=True, blank=True)
    sla_resolution_due_at = models.DateTimeField(null=True, blank=True)
    sla_first_response_breached = models.BooleanField(default=False)
    sla_resolution_breached = models.BooleanField(default=False)
    # D5: reabertura reinicia o SLA de resolução e avança o ciclo;
    # first_response_at pertence ao ciclo 1 e nunca é reescrito.
    sla_cycle = models.PositiveSmallIntegerField(default=1)
    # relógio de resolução PAUSADO enquanto se aguarda o cliente: marca o
    # instante da pausa; ao sair de pending_customer, o prazo é empurrado
    # pela duração da espera e o campo volta a nulo (ver _change_status)
    sla_paused_at = models.DateTimeField(null=True, blank=True)

    # acumuladores de relatório, derivados de TicketStatusEvent (nunca estimados)
    waiting_agent_seconds = models.PositiveIntegerField(default=0)
    waiting_customer_seconds = models.PositiveIntegerField(default=0)

    origin_chat = models.OneToOneField(
        "chat.Chat",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="generated_ticket",
    )
    tags = models.ManyToManyField("TicketTag", blank=True, related_name="tickets")

    objects = TicketQuerySet.as_manager()

    class Meta:
        verbose_name = "ticket"
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["team", "status"]),
            models.Index(fields=["company", "requester", "-created_at"]),
            models.Index(fields=["-created_at"]),
            # Filtro "SLA em risco/estourado" (fila) e a varredura sla_scan (5min)
            # consultam estes vencimentos. Índices PARCIAIS: um relógio só importa
            # enquanto há ação pendente — 1ª resposta que ainda não veio, resolução
            # de ticket não fechado. Assim o índice cobre só o working set, não o
            # histórico inteiro de tickets já resolvidos.
            models.Index(
                fields=["sla_first_response_due_at"],
                condition=models.Q(first_response_at__isnull=True),
                name="idx_sla_fr_pendente",
            ),
            models.Index(
                fields=["sla_resolution_due_at"],
                condition=~models.Q(status="closed"),
                name="idx_sla_res_aberto",
            ),
        ]

    def __str__(self):
        return f"{self.reference} — {self.subject}"

    # ---- regras de visibilidade: fonte única da verdade ----

    def is_restricted(self) -> bool:
        return self.team.is_restricted

    def is_content_visible_to(self, user) -> bool:
        """Pode ler assunto real, corpo, mensagens e anexos?

        Interno que chegou aqui já passou por visible_to() (recortado por equipe,
        D1); o acesso é permitido mas sempre gravado em TicketAccessLog quando
        restrito.
        """
        if not self.is_restricted():
            return True
        if user.is_internal:
            return True
        return self.requester_id == user.id

    def can_reply(self, user) -> bool:
        """Pode escrever ALGUMA COISA nesta thread — pública ou nota interna.

        D9: leitura para toda a empresa; resposta só do solicitante e do
        responsável. Para interno, é o portão amplo: quem responde o cliente
        e quem só comenta internamente passam os dois por aqui. Quem separa
        os dois é `can_reply_publicly` — ver o porquê lá.
        """
        from apps.accounts.models import ClientRole

        if user.is_internal:
            return self.is_content_visible_to(user)
        if user.company_id != self.company_id:
            return False
        if not self.is_content_visible_to(user):
            return False
        return self.requester_id == user.id or user.client_role == ClientRole.OWNER

    def can_reply_publicly(self, user) -> bool:
        """Pode falar COM O CLIENTE neste ticket?

        Separado de `can_reply` porque é exatamente aqui que o agente leve
        difere do agente: ele lê o ticket, comenta internamente, acompanha —
        e não fala com o cliente. Fosse uma checagem dentro de `can_reply`,
        ele perderia também a nota interna, que é a razão de o papel existir.

        Cliente não passa por esta porta: toda mensagem dele é pública por
        construção (`add_reply` força `is_public=True` para quem não é
        interno), então quem decide é `can_reply`.
        """
        from apps.accounts.rbac import Perm

        if not self.can_reply(user):
            return False
        if not user.is_internal:
            return True
        return user.can(Perm.TICKET_REPLY_PUBLIC)


class SatisfactionSurvey(TimeStampedModel):
    """Pesquisa de satisfação (CSAT 0–10) de um ticket fechado.

    Respondida DENTRO do portal, pelo próprio solicitante autenticado
    (`/tickets/<id>/rate/`). Não há convite por e-mail nem página pública:
    ambos existiram e saíram por decisão de produto — ver o cabeçalho de
    `services/satisfaction.py`.

    `token` e `sent_at` sobraram desse desenho anterior. Ficaram na tabela
    de propósito: derrubá-los é migração destrutiva em dado de produção, e
    não custa nada mantê-los. Nada os lê hoje — `sent_at` nasce nulo e o
    token não é aceito por endpoint nenhum.
    """

    ticket = models.OneToOneField(
        "Ticket", on_delete=models.CASCADE, related_name="survey"
    )
    token = models.CharField(max_length=64, unique=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(db_index=True)

    # 0–10 como no material; nulo enquanto não respondida
    score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10)],
    )
    comment = models.TextField(blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "pesquisa de satisfação"
        verbose_name_plural = "pesquisas de satisfação"
        indexes = [models.Index(fields=["responded_at", "score"])]

    def __str__(self):
        nota = "sem resposta" if self.score is None else f"nota {self.score}"
        return f"{self.ticket_id} — {nota}"

    @property
    def is_expired(self) -> bool:
        return timezone.now() > self.expires_at

    @property
    def is_answered(self) -> bool:
        return self.responded_at is not None


class MessageSource(models.TextChoices):
    WEB = "web", "Sistema"
    CHAT = "chat", "Chat"
    SYSTEM = "system", "Automático"


class TicketMessage(TimeStampedModel):
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    author = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ticket_messages",  # null = mensagem de sistema
    )
    body = models.TextField()
    is_public = models.BooleanField(default=True, help_text="Desmarcado = nota interna.")
    source = models.CharField(
        max_length=10, choices=MessageSource.choices, default=MessageSource.WEB
    )
    is_first_response = models.BooleanField(
        default=False, help_text="Marca a mensagem que definiu first_response_at."
    )
    edited_at = models.DateTimeField(null=True, blank=True)
    edited_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="edited_ticket_messages",
    )
    # Apagar é MARCAR, nunca sumir a linha. A mensagem sustenta
    # `first_response_at` (o relógio do SLA), a ordem da conversa e a
    # auditoria; deletar de verdade reescreveria indicadores já apurados e
    # deixaria buracos numa thread que o cliente já leu. O corpo some, o
    # registro fica.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="deleted_ticket_messages",
    )

    class Meta:
        verbose_name = "mensagem"
        verbose_name_plural = "mensagens"
        indexes = [models.Index(fields=["ticket", "created_at"])]

    def __str__(self):
        return f"Mensagem #{self.pk} em {self.ticket_id}"

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class ScanStatus(models.TextChoices):
    """Resultado da varredura antivírus (D19).

    `SKIPPED` existe para ser honesto: quando o scan está desligado o registro
    diz "não verificado", não mente dizendo "limpo".
    """

    PENDING = "pending", "Em verificação"
    CLEAN = "clean", "Limpo"
    INFECTED = "infected", "Infectado"
    ERROR = "error", "Falha na verificação"
    SKIPPED = "skipped", "Não verificado"


class TicketAttachment(TimeStampedModel):
    """D13: nunca servido por URL pública — o download passa por view autenticada
    que reavalia is_content_visible_to() e grava TicketAccessLog.

    D19: e só entrega os bytes depois que a varredura antivírus liberou.
    """


    message = models.ForeignKey(
        TicketMessage, on_delete=models.CASCADE, related_name="attachments"
    )
    file = models.FileField(upload_to="tickets/%Y/%m/")
    filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes = models.PositiveIntegerField()
    checksum = models.CharField(max_length=64, blank=True)  # sha256
    uploaded_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        related_name="ticket_attachments",
    )

    # Blob apagado por retenção (D18) ou por anonimização LGPD (D11). A linha
    # fica: a thread continua legível ("houve um anexo aqui, removido em ...").
    purged_at = models.DateTimeField(null=True, blank=True)

    # D19 — antivírus
    scan_status = models.CharField(
        max_length=10, choices=ScanStatus.choices, default=ScanStatus.PENDING,
        db_index=True,
    )
    scan_signature = models.CharField(
        max_length=200, blank=True, help_text="Assinatura reportada pelo antivírus."
    )
    scan_error = models.CharField(max_length=250, blank=True)
    scan_attempts = models.PositiveSmallIntegerField(default=0)
    scanned_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "anexo"

    def __str__(self):
        return self.filename

    @property
    def is_purged(self) -> bool:
        return self.purged_at is not None

    @property
    def is_downloadable(self) -> bool:
        """Quarentena: só sai do servidor o que a varredura liberou.

        `ERROR` é decidido por settings — o default é fail-closed, porque um
        antivírus que não respondeu não é um antivírus que aprovou.
        """
        if self.is_purged:
            return False  # o arquivo não existe mais; a linha é só o rastro
        if self.scan_status in (ScanStatus.CLEAN, ScanStatus.SKIPPED):
            return True
        if self.scan_status == ScanStatus.ERROR:
            return not settings.ATTACHMENT_BLOCK_ON_SCAN_ERROR
        return False


class TicketStatusEvent(models.Model):
    """Histórico completo de status — base do cálculo de tempo aguardando
    cliente × agente e do relatório de reaberturas."""


    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="status_events")
    from_status = models.CharField(
        max_length=20, choices=TicketStatus.choices, null=True, blank=True
    )
    to_status = models.CharField(max_length=20, choices=TicketStatus.choices)
    changed_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="ticket_status_changes",
    )
    is_reopen = models.BooleanField(default=False)
    is_automatic = models.BooleanField(default=False)
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        verbose_name = "evento de status"
        verbose_name_plural = "eventos de status"
        indexes = [models.Index(fields=["ticket", "created_at"])]

    def __str__(self):
        return f"{self.ticket_id}: {self.from_status} → {self.to_status}"


class TicketTag(models.Model):
    name = models.CharField(max_length=40, unique=True)
    slug = models.SlugField(unique=True)
    color = models.CharField(max_length=7, default="#888888")

    class Meta:
        verbose_name = "etiqueta"

    def __str__(self):
        return self.name


class TicketMacro(models.Model):
    """A macro — cadastro ÚNICO, usado no chamado E no chat.

    Eram dois modelos quase idênticos (`TicketMacro` e `chat.ChatMacro`),
    diferindo em dois campos: o chat tinha `chat_name` e o chamado tinha
    `body`. Manter dois catálogos obrigava a escrever a mesma resposta
    pronta duas vezes, e na prática o de chat ficou sem tela nenhuma — o
    seletor "Aplicar macro" do chat nascia sempre vazio. Agora é um só:
    `chat_name` entrou aqui e o `ChatMacro` saiu.

    Cada campo é ignorado onde não faz sentido: `chat_name` só vale
    aplicando num chat, e nada acontece com ele num chamado. O nome da
    classe continua `TicketMacro` de propósito — renomear a tabela não
    mudaria nada para quem usa e espalharia risco por migração, endpoints e
    contrato publicado.

    Sem `service` próprio: "Serviço" é filtro client-side sobre `category`
    em toda a aplicação (ver `TicketDetailSerializer`), nunca um campo
    gravado — uma macro com `service` próprio reintroduziria o campo
    fantasma que o resto do sistema evita. Sem `slug`: só `name` único.

    Campo vazio na macro deixa em paz o que o agente já preencheu — macro
    soma, não zera (ver `ticket_service.apply_macro`).
    """

    name = models.CharField(max_length=80, unique=True)
    body = models.TextField(
        blank=True, verbose_name="texto pronto",
        help_text="Pré-preenche o corpo da resposta/nota no composer. Vazio = não mexe no texto.",
    )
    #: Só tem efeito aplicando a macro num CHAT (nomeia a conversa); num
    #: chamado é ignorado. Veio do antigo `ChatMacro` na unificação.
    chat_name = models.CharField(
        max_length=200, blank=True, verbose_name="nome do chat",
        help_text="Ao aplicar num chat, nomeia a conversa. Ignorado em chamado.",
    )
    category = models.ForeignKey(
        "tickets.TicketCategory",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    priority = models.CharField(
        max_length=10, choices=TicketPriority.choices, blank=True
    )
    assignee = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    tags = models.ManyToManyField("tickets.TicketTag", blank=True, related_name="+")
    is_active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "macro"
        verbose_name_plural = "macros"
        ordering = ["order", "name"]

    def __str__(self):
        return self.name


class TicketWatcher(models.Model):
    """Seguidor (CC): recebe notificações. NÃO concede acesso a ticket restrito."""


    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="watchers")
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="watched_tickets"
    )

    class Meta:
        verbose_name = "seguidor"
        verbose_name_plural = "seguidores"
        constraints = [
            models.UniqueConstraint(fields=["ticket", "user"], name="uniq_ticket_watcher")
        ]

    def __str__(self):
        return f"{self.user_id} segue {self.ticket_id}"


class TicketMention(models.Model):
    """Quem foi citado numa mensagem — o índice das menções.

    ── Por que DUAS coisas (marcação no corpo + esta tabela) ──────────────────

    O corpo da mensagem guarda a menção como marcação inerte: `@[user:12]` e
    `@[team:3]`. Ela precisa morar no corpo porque a menção tem POSIÇÃO — o chip
    aparece no meio da frase ("pergunta pro @Izaque se ele viu"), e uma tabela
    à parte só saberia QUEM foi citado, nunca ONDE. Guardar o texto `@Izaque`
    resolveria a posição e perderia a identidade: a pessoa troca de sobrenome e
    a nota de seis meses atrás passa a citar alguém que não existe mais. O que
    fica gravado é a REFERÊNCIA; o nome é resolvido na serialização, sempre
    atual (ver `services/mentions.py`).

    A marcação é texto comum e atravessa o contrato de conteúdo intacto: o corpo
    continua sendo TEXTO, nunca HTML (ver tests/test_xss.py), e quem renderiza é
    o front, que troca a marcação por um componente — sem injetar HTML, sem
    sanitizador novo para manter. O payload da API traz as menções já
    RESOLVIDAS (id e nome atual) ao lado do corpo, então quem renderiza não
    precisa consultar mais nada.

    Esta tabela é o índice do que já está no corpo, e existe por três motivos que
    o corpo sozinho não atende:

    1. o histórico do ticket lista as menções — varrer o corpo de toda mensagem
       com regex para montar essa lista seria varredura de tabela a cada leitura;
    2. a notificação é UMA por pessoa por nota, e a linha única (constraint no
       banco) é o que garante isso mesmo com a mesma pessoa citada três vezes;
    3. "onde fui mencionado" é uma consulta que vai existir — com a tabela é
       índice, com regex no corpo é impossível.

    A tabela é derivada, não autoritativa: a marcação no corpo é a fonte. Uma
    linha aqui sem marcação lá é ruído; uma marcação sem linha aqui (resposta
    pública, ver `mentions.registrar_mencoes`) renderiza como texto literal — que
    é exatamente o comportamento desejado, porque menção NUNCA vaza para o
    cliente.
    """

    message = models.ForeignKey(
        TicketMessage, on_delete=models.CASCADE, related_name="mentions"
    )
    # exatamente um dos dois: pessoa ou equipe (o dono decidiu que mencionar
    # equipe existe). A equipe fica registrada como equipe, e não estourada em
    # N linhas de usuário: quem entrar no time depois lê "chamaram o Design",
    # não "chamaram fulano, sicrano e beltrano".
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="ticket_mentions",
    )
    team = models.ForeignKey(
        "accounts.Team",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="ticket_mentions",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "menção"
        verbose_name_plural = "menções"
        constraints = [
            models.CheckConstraint(
                name="mencao_pessoa_ou_equipe",
                condition=(
                    models.Q(user__isnull=False, team__isnull=True)
                    | models.Q(user__isnull=True, team__isnull=False)
                ),
            ),
            # a mesma pessoa citada duas vezes na mesma nota é UMA menção — é
            # aqui que "não duplica notificação" vira regra do banco, não
            # cuidado de quem escreve o serviço
            models.UniqueConstraint(
                fields=["message", "user"],
                condition=models.Q(user__isnull=False),
                name="uniq_mencao_usuario",
            ),
            models.UniqueConstraint(
                fields=["message", "team"],
                condition=models.Q(team__isnull=False),
                name="uniq_mencao_equipe",
            ),
        ]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        alvo = self.user_id or f"equipe {self.team_id}"
        return f"Menção a {alvo} em #{self.message_id}"


class TicketNumberSequence(models.Model):
    """D12: sequencial do ticket, incrementado sob select_for_update — nunca MAX()+1.

    Hoje existe UMA sequência viva, a global (`TD-00001`, `TD-00002`, ...), que
    não reinicia na virada do ano. A coluna virou `scope` em vez de sumir junto
    com o `year`: as linhas do esquema antigo ("2025", "2026") são o registro de
    quanto cada ano consumiu, e apagá-las por causa da troca de regra seria
    perder histórico que o banco já guardava. A linha "global" convive com elas.
    """

    SCOPE_GLOBAL = "global"

    scope = models.CharField(max_length=20, unique=True)
    last_value = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "sequência de numeração"
        verbose_name_plural = "sequências de numeração"

    def __str__(self):
        return f"{self.scope}: {self.last_value}"


class UserTicketTabs(TimeStampedModel):
    """Abas de ticket abertas pelo usuário dentro do sistema (docs/01 §6).

    A fonte primária de estado é o frontend (estado global + localStorage, para
    resposta instantânea); este registro é o espelho no servidor, o que faz as
    abas sobreviverem a troca de máquina/navegador. Na leitura, o backend
    reconcilia: aba de ticket que o usuário perdeu acesso é descartada em
    silêncio — nunca se devolve id de ticket fora de visible_to().
    """

    user = models.OneToOneField(
        "accounts.User", on_delete=models.CASCADE, related_name="ticket_tabs"
    )
    # [{"ticket_id": 123, "opened_at": "2026-08-06T12:00:00Z"}, ...] na ordem das abas
    tabs = models.JSONField(default=list, blank=True)
    active_ticket_id = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        verbose_name = "abas de ticket"
        verbose_name_plural = "abas de ticket"

    def __str__(self):
        return f"Abas de {self.user_id} ({len(self.tabs)})"


def ticket_is_overdue(ticket: Ticket) -> bool:
    """Helper de listagem: SLA de resolução estourado e ticket ainda vivo."""
    return bool(
        ticket.sla_resolution_due_at
        and ticket.status != TicketStatus.CLOSED
        and ticket.sla_resolution_due_at < timezone.now()
    )
