# resolv — Modelagem de dados

Pseudo-código de models Django. Não roda como está (faltam imports, `Meta` completos e
migrations), mas os campos, tipos e relacionamentos são os definitivos propostos.

Convenções:
- Todo model herda `TimeStampedModel` (`created_at`, `updated_at`) salvo indicação contrária.
- `on_delete` nunca é `CASCADE` a partir de `User` ou `Company` — LGPD exige preservar histórico.
- `related_name` sempre explícito.
- Datas/hora sempre `DateTimeField` com `USE_TZ=True`; conversão para o fuso da empresa é feita
  na apresentação e no cálculo de cota.

---

## `core`

```python
class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BusinessCalendar(TimeStampedModel):
    """Horário comercial usado no cálculo de SLA (evita contar madrugada/fim de semana)."""
    name        = models.CharField(max_length=80, unique=True)
    timezone    = models.CharField(max_length=64, default="America/Sao_Paulo")
    is_default  = models.BooleanField(default=False)
    # [{"weekday": 0, "start": "09:00", "end": "18:00"}, ...]
    workdays    = models.JSONField(default=list)


class Holiday(models.Model):
    calendar = models.ForeignKey(BusinessCalendar, on_delete=models.CASCADE,
                                related_name="holidays")
    date     = models.DateField()
    name     = models.CharField(max_length=120)

    class Meta:
        unique_together = [("calendar", "date")]
```

---

## `accounts`

```python
class UserKind(models.TextChoices):
    INTERNAL = "internal", "Interno"
    CLIENT   = "client",   "Cliente"


class InternalRole(models.TextChoices):
    ADMIN      = "admin",      "Administrador"
    SUPERVISOR = "supervisor", "Supervisor"
    AGENT      = "agent",      "Agente"


class ClientRole(models.TextChoices):
    OWNER  = "owner",  "Responsável"   # gerencia usuários da própria empresa
    MEMBER = "member", "Usuário"


class Team(TimeStampedModel):
    name       = models.CharField(max_length=80, unique=True)
    slug       = models.SlugField(unique=True)
    supervisor = models.ForeignKey("User", on_delete=models.SET_NULL, null=True, blank=True,
                                  related_name="supervised_teams")
    is_active  = models.BooleanField(default=True)


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    email      = models.EmailField(unique=True)
    full_name  = models.CharField(max_length=150)
    kind       = models.CharField(max_length=10, choices=UserKind.choices)

    # --- internos ---
    internal_role = models.CharField(max_length=12, choices=InternalRole.choices,
                                     null=True, blank=True)
    team          = models.ForeignKey(Team, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name="members")
    google_sub    = models.CharField(max_length=64, unique=True, null=True, blank=True)
    departments   = models.ManyToManyField("tickets.Department",
                                           through="AgentDepartment",
                                           related_name="agents", blank=True)

    # --- clientes ---
    company     = models.ForeignKey("customers.Company", on_delete=models.PROTECT,
                                    null=True, blank=True, related_name="users")
    client_role = models.CharField(max_length=10, choices=ClientRole.choices,
                                   null=True, blank=True)

    job_title     = models.CharField(max_length=100, blank=True)
    phone         = models.CharField(max_length=32, blank=True)
    avatar_url    = models.URLField(blank=True)
    is_active     = models.BooleanField(default=True)
    is_staff      = models.BooleanField(default=False)
    last_seen_at  = models.DateTimeField(null=True, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)   # LGPD

    USERNAME_FIELD = "email"

    class Meta:
        constraints = [
            models.CheckConstraint(
                name="client_requires_company",
                check=~Q(kind="client") | (Q(company__isnull=False) &
                                           Q(internal_role__isnull=True)),
            ),
            models.CheckConstraint(
                name="internal_requires_role",
                check=~Q(kind="internal") | (Q(company__isnull=True) &
                                             Q(internal_role__isnull=False)),
            ),
        ]

    # atalhos usados pelas policies
    @property
    def is_internal(self):   return self.kind == UserKind.INTERNAL
    @property
    def is_admin(self):      return self.internal_role == InternalRole.ADMIN
    @property
    def is_supervisor(self): return self.internal_role == InternalRole.SUPERVISOR


class AgentDepartment(models.Model):
    """Quais departamentos um agente atende. Governa também o acesso interno
    a departamentos restritos (ex.: Financeiro)."""
    user       = models.ForeignKey(User, on_delete=models.CASCADE,
                                   related_name="department_links")
    department = models.ForeignKey("tickets.Department", on_delete=models.CASCADE,
                                   related_name="agent_links")
    is_default = models.BooleanField(default=False)

    class Meta:
        unique_together = [("user", "department")]
```

> **Por que um único `User`:** ticket, mensagem, auditoria, notificação e menção apontam todos
> para "alguém". Com dois models seria preciso `GenericForeignKey` em todo lugar — mais lento,
> sem integridade referencial e impossível de indexar bem. As `CheckConstraint` acima garantem
> no banco que um interno nunca tem empresa e um cliente nunca tem papel interno.

---

## `customers`

```python
class LimitPeriod(models.TextChoices):
    WEEKLY  = "weekly",  "Semanal"
    MONTHLY = "monthly", "Mensal"


class LimitScope(models.TextChoices):
    COMPANY = "company", "Por empresa"
    USER    = "user",    "Por usuário"


class Plan(TimeStampedModel):
    slug        = models.SlugField(unique=True)             # gold | platinum | black
    name        = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
    rank        = models.PositiveSmallIntegerField(default=0)  # ordenação/prioridade

    default_ticket_limit = models.PositiveIntegerField(null=True, blank=True)  # null = ilimitado
    default_limit_period = models.CharField(max_length=10, choices=LimitPeriod.choices,
                                            default=LimitPeriod.MONTHLY)
    chat_enabled = models.BooleanField(default=True)   # todos habilitados nesta fase
    # D2: ticket gerado a partir de chat não consome cota. Campo existe para inverter
    # a política sem migration de lógica.
    chat_consumes_quota = models.BooleanField(default=False)


class Company(TimeStampedModel):
    name       = models.CharField(max_length=150)
    legal_name = models.CharField(max_length=200, blank=True)
    tax_id     = models.CharField(max_length=20, unique=True, null=True, blank=True)  # CNPJ
    slug       = models.SlugField(unique=True)
    plan       = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="companies")
    is_active  = models.BooleanField(default=True)

    # overrides do plano (null = herda do plano)
    ticket_limit  = models.PositiveIntegerField(null=True, blank=True)
    limit_period  = models.CharField(max_length=10, choices=LimitPeriod.choices,
                                     null=True, blank=True)
    limit_scope   = models.CharField(max_length=10, choices=LimitScope.choices,
                                     default=LimitScope.COMPANY)   # premissa P1

    timezone            = models.CharField(max_length=64, default="America/Sao_Paulo")
    business_calendar   = models.ForeignKey("core.BusinessCalendar", on_delete=models.SET_NULL,
                                            null=True, blank=True, related_name="companies")
    account_manager     = models.ForeignKey("accounts.User", on_delete=models.SET_NULL,
                                            null=True, blank=True, related_name="managed_companies")
    contract_started_at = models.DateField(null=True, blank=True)
    contract_ended_at   = models.DateField(null=True, blank=True)
    notes               = models.TextField(blank=True)
    anonymized_at       = models.DateTimeField(null=True, blank=True)   # LGPD

    @property
    def effective_ticket_limit(self):
        return self.ticket_limit if self.ticket_limit is not None \
               else self.plan.default_ticket_limit

    @property
    def effective_limit_period(self):
        return self.limit_period or self.plan.default_limit_period


class TicketQuotaConsumption(models.Model):
    """Livro-razão de consumo de cota. Uma linha por ticket que consumiu vaga.
    Reabertura NÃO cria linha nova (premissa P6)."""
    company      = models.ForeignKey(Company, on_delete=models.PROTECT,
                                     related_name="quota_consumptions")
    user         = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                                     related_name="quota_consumptions")
    ticket       = models.OneToOneField("tickets.Ticket", on_delete=models.PROTECT,
                                        related_name="quota_consumption")
    period_start = models.DateField()
    period_end   = models.DateField()
    scope        = models.CharField(max_length=10, choices=LimitScope.choices)
    limit_snapshot = models.PositiveIntegerField(null=True)   # limite vigente na hora
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["company", "period_start"]),
                   models.Index(fields=["user", "period_start"])]


class QuotaPeriodCounter(models.Model):
    """Contador materializado, usado com SELECT FOR UPDATE para fechar a corrida
    de dois usuários abrindo ticket ao mesmo tempo no último slot."""
    company      = models.ForeignKey(Company, on_delete=models.CASCADE,
                                     related_name="quota_counters")
    user         = models.ForeignKey("accounts.User", on_delete=models.CASCADE,
                                     null=True, blank=True)   # preenchido se scope=USER
    period_start = models.DateField()
    used         = models.PositiveIntegerField(default=0)

    class Meta:
        unique_together = [("company", "user", "period_start")]
```

---

## `tickets`

### Departamento

```python
class DepartmentVisibility(models.TextChoices):
    COMPANY_WIDE   = "company_wide",   "Toda a empresa cliente"
    REQUESTER_ONLY = "requester_only", "Apenas o solicitante"   # caso Financeiro


class Department(TimeStampedModel):
    name       = models.CharField(max_length=60, unique=True)
    slug       = models.SlugField(unique=True)          # suporte | financeiro | ...
    is_active  = models.BooleanField(default=True)
    order      = models.PositiveSmallIntegerField(default=0)

    visibility = models.CharField(max_length=20, choices=DepartmentVisibility.choices,
                                  default=DepartmentVisibility.COMPANY_WIDE)
    # D6: assunto também é mascarado para quem não é o solicitante.
    mask_subject_for_others = models.BooleanField(default=True)
    # D16: fora deste calendário, o chat do departamento aceita a mensagem e vira ticket.
    chat_calendar = models.ForeignKey("core.BusinessCalendar", on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name="chat_departments")

    default_team       = models.ForeignKey("accounts.Team", on_delete=models.SET_NULL,
                                           null=True, blank=True, related_name="departments")
    notification_email = models.EmailField(blank=True)
    description        = models.TextField(blank=True)
```

> Departamento novo = uma linha nova. Financeiro é apenas o primeiro departamento com
> `visibility=REQUESTER_ONLY`. Nada em código testa `slug == "financeiro"`.

### SLA

```python
class SLAPolicy(TimeStampedModel):
    """Prazo por (plano × departamento). O mais específico vence; ambos nulos = padrão global."""
    name       = models.CharField(max_length=80)
    plan       = models.ForeignKey("customers.Plan", on_delete=models.CASCADE,
                                   null=True, blank=True, related_name="sla_policies")
    department = models.ForeignKey(Department, on_delete=models.CASCADE,
                                   null=True, blank=True, related_name="sla_policies")
    first_response_minutes = models.PositiveIntegerField()
    resolution_minutes     = models.PositiveIntegerField()
    use_business_hours     = models.BooleanField(default=True)
    is_active  = models.BooleanField(default=True)

    class Meta:
        unique_together = [("plan", "department")]
```

### Ticket

```python
class TicketStatus(models.TextChoices):
    NEW              = "new",              "Novo"
    OPEN             = "open",             "Aberto"
    PENDING_CUSTOMER = "pending_customer", "Aguardando retorno"
    CLOSED           = "closed",           "Fechado"


class TicketSource(models.TextChoices):
    WEB      = "web",      "Sistema"
    CHAT     = "chat",     "Chat ao vivo"
    INTERNAL = "internal", "Criado por agente"


class TicketPriority(models.TextChoices):
    LOW = "low"; NORMAL = "normal"; HIGH = "high"; URGENT = "urgent"


class Ticket(TimeStampedModel):
    reference  = models.CharField(max_length=20, unique=True)   # CVZ-2026-000123
    company    = models.ForeignKey("customers.Company", on_delete=models.PROTECT,
                                   related_name="tickets")
    requester  = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                                   related_name="requested_tickets")
    department = models.ForeignKey(Department, on_delete=models.PROTECT,
                                   related_name="tickets")

    subject  = models.CharField(max_length=200)
    status   = models.CharField(max_length=20, choices=TicketStatus.choices,
                                default=TicketStatus.NEW, db_index=True)
    priority = models.CharField(max_length=10, choices=TicketPriority.choices,
                                default=TicketPriority.NORMAL)
    source   = models.CharField(max_length=10, choices=TicketSource.choices,
                                default=TicketSource.WEB)

    # atribuição
    assignee = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                 blank=True, related_name="assigned_tickets")
    owner    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                 blank=True, related_name="owned_tickets")
    team     = models.ForeignKey("accounts.Team", on_delete=models.SET_NULL, null=True,
                                 blank=True, related_name="tickets")

    # marcos temporais
    first_response_at     = models.DateTimeField(null=True, blank=True)
    resolution_started_at = models.DateTimeField(null=True, blank=True)
    resolution_ended_at   = models.DateTimeField(null=True, blank=True)
    closed_at             = models.DateTimeField(null=True, blank=True)
    closed_by             = models.ForeignKey("accounts.User", on_delete=models.SET_NULL,
                                              null=True, blank=True,
                                              related_name="closed_tickets")
    last_customer_message_at = models.DateTimeField(null=True, blank=True)
    last_agent_message_at    = models.DateTimeField(null=True, blank=True)

    # reabertura
    reopen_count     = models.PositiveSmallIntegerField(default=0)
    last_reopened_at = models.DateTimeField(null=True, blank=True)

    # SLA (denormalizado para listagem e alerta)
    sla_policy                = models.ForeignKey(SLAPolicy, on_delete=models.SET_NULL,
                                                  null=True, blank=True, related_name="tickets")
    sla_first_response_due_at = models.DateTimeField(null=True, blank=True)
    sla_resolution_due_at     = models.DateTimeField(null=True, blank=True)
    sla_first_response_breached = models.BooleanField(default=False)
    sla_resolution_breached     = models.BooleanField(default=False)
    # D5: a cada reabertura o SLA de resolução reinicia e este contador avança.
    # first_response_at nunca é reescrito — pertence ao ciclo original.
    sla_cycle = models.PositiveSmallIntegerField(default=1)

    # acumuladores para relatório (recalculados a partir de TicketStatusEvent)
    waiting_agent_seconds    = models.PositiveIntegerField(default=0)
    waiting_customer_seconds = models.PositiveIntegerField(default=0)

    origin_chat = models.OneToOneField("chat.ChatSession", on_delete=models.SET_NULL,
                                       null=True, blank=True, related_name="generated_ticket")
    tags = models.ManyToManyField("TicketTag", blank=True, related_name="tickets")

    objects = TicketQuerySet.as_manager()

    class Meta:
        indexes = [
            models.Index(fields=["company", "status"]),
            models.Index(fields=["assignee", "status"]),
            models.Index(fields=["department", "status"]),
            models.Index(fields=["company", "requester", "-created_at"]),
            models.Index(fields=["-created_at"]),
        ]

    # ---- regras de visibilidade (fonte única da verdade) ----
    def is_restricted(self):
        return self.department.visibility == DepartmentVisibility.REQUESTER_ONLY

    def is_content_visible_to(self, user) -> bool:
        """Pode ler corpo, assunto, mensagens e anexos?"""
        if not self.is_restricted():
            return True
        if user.is_internal:
            # quem chegou até aqui já passou por visible_to(), que é department-scoped (D1).
            # O acesso é permitido, mas sempre gravado em TicketAccessLog.
            return True
        return self.requester_id == user.id

    def can_reply(self, user) -> bool:
        """D9: leitura para toda a empresa, resposta só do solicitante e do responsável."""
        if user.is_internal:
            return self.is_content_visible_to(user)
        if user.company_id != self.company_id:
            return False
        if not self.is_content_visible_to(user):
            return False
        return (self.requester_id == user.id
                or user.client_role == ClientRole.OWNER)
```

### QuerySet de visibilidade

```python
class TicketQuerySet(models.QuerySet):

    def visible_to(self, user):
        """Único ponto de leitura de ticket em toda a aplicação."""
        if user.is_internal:
            # D1: admin vê tudo; supervisor e agente veem os departamentos aos quais
            # estão vinculados (AgentDepartment). É essa regra que tira o Financeiro
            # da vista do agente de Suporte, sem nenhum caso especial.
            if user.is_admin:
                return self
            return self.filter(department__agent_links__user=user).distinct()

        # cliente: nunca cruza a fronteira da empresa.
        # Tickets restritos de OUTROS usuários continuam na listagem (mascarados na
        # serialização), por isso não são excluídos aqui.
        return self.filter(company_id=user.company_id)
```

### Mensagens, anexos, eventos

```python
class MessageSource(models.TextChoices):
    WEB = "web"; CHAT = "chat"; SYSTEM = "system"


class TicketMessage(TimeStampedModel):
    ticket    = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="messages")
    author    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                  related_name="ticket_messages")   # null = sistema
    body      = models.TextField()
    is_public = models.BooleanField(default=True)    # False = nota interna
    source    = models.CharField(max_length=10, choices=MessageSource.choices,
                                 default=MessageSource.WEB)
    is_first_response = models.BooleanField(default=False)  # marca a que setou first_response_at
    edited_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=["ticket", "created_at"])]


class TicketAttachment(TimeStampedModel):
    """D13: nunca servido por URL pública. O download passa por view autenticada que
    reavalia ticket.is_content_visible_to(user) e grava TicketAccessLog."""
    message      = models.ForeignKey(TicketMessage, on_delete=models.CASCADE,
                                     related_name="attachments")
    file         = models.FileField(upload_to="tickets/%Y/%m/")
    filename     = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes   = models.PositiveIntegerField()
    checksum     = models.CharField(max_length=64, blank=True)   # sha256, deduplicação
    uploaded_by  = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                     related_name="ticket_attachments")


class TicketNumberSequence(models.Model):
    """D12: numeração CVZ-{ano}-{sequencial:06d}, reiniciando a cada ano.
    Incremento sob select_for_update — nunca MAX()+1."""
    year       = models.PositiveSmallIntegerField(unique=True)
    last_value = models.PositiveIntegerField(default=0)


class TicketStatusEvent(models.Model):
    """Histórico completo de status. Base do cálculo de tempo aguardando cliente x agente."""
    ticket      = models.ForeignKey(Ticket, on_delete=models.CASCADE,
                                    related_name="status_events")
    from_status = models.CharField(max_length=20, choices=TicketStatus.choices, null=True)
    to_status   = models.CharField(max_length=20, choices=TicketStatus.choices)
    changed_by  = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                    related_name="ticket_status_changes")
    is_reopen   = models.BooleanField(default=False)
    is_automatic = models.BooleanField(default=False)   # reabertura/retorno automático
    note        = models.CharField(max_length=200, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["ticket", "created_at"])]


class TicketTag(models.Model):
    name  = models.CharField(max_length=40, unique=True)
    slug  = models.SlugField(unique=True)
    color = models.CharField(max_length=7, default="#888888")


class TicketWatcher(models.Model):
    """Seguidores (CC). Não concede acesso a ticket restrito — apenas notificação."""
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="watchers")
    user   = models.ForeignKey("accounts.User", on_delete=models.CASCADE,
                               related_name="watched_tickets")

    class Meta:
        unique_together = [("ticket", "user")]
```

### Máquina de estados (regra, não model)

Implementada em `tickets/services/ticket_service.py`, sempre gravando `TicketStatusEvent`:

| Evento | De | Para |
|---|---|---|
| Cliente cria | — | `NEW` |
| Agente responde (público) | qualquer | escolhido pelo agente (`OPEN` / `PENDING_CUSTOMER` / `CLOSED`) |
| Cliente responde | `PENDING_CUSTOMER` | `OPEN` (automático) |
| Cliente responde | `CLOSED` | `OPEN` + `reopen_count += 1`, `last_reopened_at`, `sla_cycle += 1`, novo `sla_resolution_due_at`, alerta visual (automático) |
| Cliente responde | `NEW` / `OPEN` | mantém |
| Agente fecha | qualquer | `CLOSED` + `closed_at`, `closed_by`, exige `resolution_started_at`/`resolution_ended_at` |

`first_response_at` é gravado no momento da primeira `TicketMessage` com
`is_public=True` e autor interno — e **nunca** é reescrito em reabertura (D5): o SLA de
primeira resposta pertence ao ciclo original. Já o SLA de **resolução** reinicia a cada
reabertura (`sla_cycle += 1`), senão todo ticket reaberto nasceria estourado.

Fechar exige `resolution_started_at` e `resolution_ended_at` (D4): o modal de fechamento
sugere `início` = primeira transição para `OPEN` após a atribuição e `fim` = agora, ambos
editáveis pelo agente, com validação `ended >= started` e `started >= created_at`.

---

## `chat`

```python
class ChatStatus(models.TextChoices):
    QUEUED    = "queued",    "Na fila"
    ACTIVE    = "active",    "Em atendimento"
    ENDED     = "ended",     "Encerrado"
    ABANDONED = "abandoned", "Abandonado"


class ChatSession(TimeStampedModel):
    company    = models.ForeignKey("customers.Company", on_delete=models.PROTECT,
                                   related_name="chat_sessions")
    requester  = models.ForeignKey("accounts.User", on_delete=models.PROTECT,
                                   related_name="chat_sessions")
    agent      = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="attended_chats")
    department = models.ForeignKey("tickets.Department", on_delete=models.PROTECT,
                                   related_name="chat_sessions")
    status     = models.CharField(max_length=10, choices=ChatStatus.choices,
                                  default=ChatStatus.QUEUED, db_index=True)

    subject      = models.CharField(max_length=200, blank=True)
    queued_at    = models.DateTimeField(auto_now_add=True)
    accepted_at  = models.DateTimeField(null=True, blank=True)
    ended_at     = models.DateTimeField(null=True, blank=True)
    ended_by     = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                     blank=True, related_name="ended_chats")
    channel      = models.CharField(max_length=20, default="web")  # extensão futura: meet
    metadata     = models.JSONField(default=dict, blank=True)      # user agent, url de origem

    # o ticket gerado é acessível por ChatSession.generated_ticket (related_name da FK
    # em Ticket.origin_chat) — a direção da FK mora em tickets para evitar ciclo de import


class ChatMessage(models.Model):
    session   = models.ForeignKey(ChatSession, on_delete=models.CASCADE,
                                  related_name="messages")
    author    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                  related_name="chat_messages")   # null = sistema
    body      = models.TextField()
    sent_at   = models.DateTimeField(auto_now_add=True, db_index=True)
    read_at   = models.DateTimeField(null=True, blank=True)
    is_system = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["session", "sent_at"])]


class ChatAttachment(models.Model):
    message      = models.ForeignKey(ChatMessage, on_delete=models.CASCADE,
                                     related_name="attachments")
    file         = models.FileField(upload_to="chat/%Y/%m/")
    filename     = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120)
    size_bytes   = models.PositiveIntegerField()
```

**Conversão chat → ticket** (task Celery, disparada ao encerrar a sessão):
`ChatMessage` continua sendo a fonte da verdade da conversa; a task cria o `Ticket`
(`source=CHAT`, `origin_chat=session`) e **uma** `TicketMessage` com a transcrição renderizada
(`source=CHAT`). Assim o ticket entra nas métricas normais sem duplicar centenas de linhas, e o
histórico original permanece íntegro e auditável. Ver decisão D8.

---

## `kanban`

```python
class Board(TimeStampedModel):
    name       = models.CharField(max_length=80)
    slug       = models.SlugField(unique=True)
    department = models.ForeignKey("tickets.Department", on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="boards")
    team       = models.ForeignKey("accounts.Team", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="boards")
    is_active  = models.BooleanField(default=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   related_name="created_boards")


class BoardColumn(models.Model):
    board     = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="columns")
    name      = models.CharField(max_length=60)          # livre, definido pelo admin
    order     = models.PositiveSmallIntegerField(default=0)
    color     = models.CharField(max_length=7, default="#E5E7EB")
    wip_limit = models.PositiveSmallIntegerField(null=True, blank=True)
    # D7: mover o card para esta coluna aplica o status ao ticket. Exceção: coluna que
    # mapeia para CLOSED não fecha — abre o modal de fechamento (exige resolution_*).
    maps_to_status = models.CharField(max_length=20, choices=TicketStatus.choices,
                                      null=True, blank=True)
    is_done   = models.BooleanField(default=False)

    class Meta:
        unique_together = [("board", "name")]
        ordering = ["order"]


class Card(TimeStampedModel):
    board    = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="cards")
    column   = models.ForeignKey(BoardColumn, on_delete=models.PROTECT, related_name="cards")
    ticket   = models.ForeignKey("tickets.Ticket", on_delete=models.CASCADE,
                                 related_name="cards")
    position = models.DecimalField(max_digits=20, decimal_places=10)  # índice fracionário
    due_at   = models.DateTimeField(null=True, blank=True)   # "data de resposta prevista"
    added_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                 related_name="added_cards")

    class Meta:
        unique_together = [("board", "ticket")]   # o mesmo ticket não duplica no quadro
        indexes = [models.Index(fields=["column", "position"])]

    @property
    def is_overdue(self):
        return bool(self.due_at and self.due_at < timezone.now()
                    and not self.column.is_done)
```

> **`owner` mora no `Ticket`, não no `Card`.** O card é onde o admin *edita* o proprietário,
> mas o dado pertence ao ticket — caso contrário relatório por proprietário só funcionaria para
> tickets que estão em algum quadro. `position` usa índice fracionário (insere entre dois
> vizinhos calculando a média) para que arrastar um card seja um `UPDATE` de uma linha só.

---

## `announcements`

```python
class AnnouncementKind(models.TextChoices):
    INFO     = "info",     "Informativo"
    URGENT   = "urgent",   "Urgente"
    HOLIDAY  = "holiday",  "Feriado"
    VACATION = "vacation", "Férias da equipe"


class AudienceKind(models.TextChoices):
    ALL           = "all",           "Todos"
    ALL_INTERNAL  = "all_internal",  "Todos os internos"
    ALL_CLIENTS   = "all_clients",   "Todos os clientes"
    TEAMS         = "teams",         "Equipes específicas"
    ROLES         = "roles",         "Papéis específicos"
    COMPANIES     = "companies",     "Empresas específicas"
    PLANS         = "plans",         "Planos específicos"


class Announcement(TimeStampedModel):
    title      = models.CharField(max_length=150)
    body       = models.TextField()
    kind       = models.CharField(max_length=10, choices=AnnouncementKind.choices,
                                  default=AnnouncementKind.INFO)
    starts_at  = models.DateTimeField()
    ends_at    = models.DateTimeField(null=True, blank=True)   # null = sem expiração
    is_pinned  = models.BooleanField(default=False)
    is_active  = models.BooleanField(default=True)
    created_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   related_name="announcements")

    audience_kind = models.CharField(max_length=15, choices=AudienceKind.choices,
                                     default=AudienceKind.ALL_INTERNAL)
    target_teams     = models.ManyToManyField("accounts.Team", blank=True,
                                              related_name="announcements")
    target_roles     = models.JSONField(default=list, blank=True)   # ["agent", "supervisor"]
    target_companies = models.ManyToManyField("customers.Company", blank=True,
                                              related_name="announcements")
    target_plans     = models.ManyToManyField("customers.Plan", blank=True,
                                              related_name="announcements")

    class Meta:
        indexes = [models.Index(fields=["is_active", "starts_at", "ends_at"])]
        ordering = ["-is_pinned", "-starts_at"]


class AnnouncementRead(models.Model):
    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE,
                                     related_name="reads")
    user         = models.ForeignKey("accounts.User", on_delete=models.CASCADE,
                                     related_name="announcement_reads")
    read_at      = models.DateTimeField(auto_now_add=True)
    dismissed    = models.BooleanField(default=False)

    class Meta:
        unique_together = [("announcement", "user")]
```

O histórico de avisos antigos é a própria tabela: "antigo" = `ends_at < now()`. Nada é apagado.

---

## `notifications`

```python
class NotificationKind(models.TextChoices):
    TICKET_ASSIGNED  = "ticket_assigned"
    TICKET_REPLIED   = "ticket_replied"
    TICKET_REOPENED  = "ticket_reopened"
    MENTION          = "mention"
    SLA_WARNING      = "sla_warning"
    SLA_BREACHED     = "sla_breached"
    CHAT_INCOMING    = "chat_incoming"
    ANNOUNCEMENT     = "announcement"


class Notification(models.Model):
    recipient  = models.ForeignKey("accounts.User", on_delete=models.CASCADE,
                                   related_name="notifications")
    kind       = models.CharField(max_length=25, choices=NotificationKind.choices)
    title      = models.CharField(max_length=150)
    body       = models.CharField(max_length=400, blank=True)
    url        = models.CharField(max_length=300, blank=True)
    ticket     = models.ForeignKey("tickets.Ticket", on_delete=models.CASCADE, null=True,
                                   blank=True, related_name="notifications")
    actor      = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="triggered_notifications")
    read_at    = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["recipient", "read_at", "-created_at"])]


class NotificationPreference(models.Model):
    user     = models.OneToOneField("accounts.User", on_delete=models.CASCADE,
                                    related_name="notification_preference")
    in_app   = models.JSONField(default=dict)   # {"sla_warning": true, ...}
    email    = models.JSONField(default=dict)


class OutboundEmail(TimeStampedModel):
    """Outbox: garante idempotência e reprocessamento das tasks Celery."""
    to_email   = models.EmailField()
    subject    = models.CharField(max_length=200)
    template   = models.CharField(max_length=80)
    context    = models.JSONField(default=dict)
    ticket     = models.ForeignKey("tickets.Ticket", on_delete=models.SET_NULL, null=True,
                                   blank=True, related_name="emails")
    status     = models.CharField(max_length=10, default="pending")  # pending|sent|failed
    sent_at    = models.DateTimeField(null=True, blank=True)
    error      = models.TextField(blank=True)
    attempts   = models.PositiveSmallIntegerField(default=0)
    dedupe_key = models.CharField(max_length=120, unique=True, null=True, blank=True)
```

---

## `audit`

```python
class AuditAction(models.TextChoices):
    CREATE = "create"; UPDATE = "update"; DELETE = "delete"
    STATUS_CHANGE = "status_change"; ASSIGN = "assign"; LOGIN = "login"
    CONFIG_CHANGE = "config_change"; EXPORT = "export"; ANONYMIZE = "anonymize"


class AuditLog(models.Model):
    actor        = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                     related_name="audit_logs")
    action       = models.CharField(max_length=20, choices=AuditAction.choices)
    content_type = models.ForeignKey(ContentType, on_delete=models.PROTECT)
    object_id    = models.CharField(max_length=40)
    target       = GenericForeignKey("content_type", "object_id")
    changes      = models.JSONField(default=dict)   # {"campo": ["antes", "depois"]}
    summary      = models.CharField(max_length=250, blank=True)
    ip_address   = models.GenericIPAddressField(null=True, blank=True)
    user_agent   = models.CharField(max_length=250, blank=True)
    request_id   = models.CharField(max_length=40, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["content_type", "object_id", "-created_at"]),
                   models.Index(fields=["actor", "-created_at"])]


class TicketAccessLog(models.Model):
    """Leitura (não só edição) de ticket em departamento restrito."""
    ticket     = models.ForeignKey("tickets.Ticket", on_delete=models.CASCADE,
                                   related_name="access_logs")
    user       = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                   related_name="ticket_accesses")
    was_granted = models.BooleanField(default=True)   # registra também tentativa negada
    context    = models.CharField(max_length=40)      # detail | export | api | kanban
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["ticket", "-created_at"]),
                   models.Index(fields=["user", "-created_at"])]
```

```python
class DataSubjectRequest(TimeStampedModel):
    """D11: trilha de pedidos LGPD. Anonimização preserva ticket, métrica e histórico
    das demais empresas — nada é hard-deleted."""
    subject_user    = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                        blank=True, related_name="lgpd_requests")
    subject_company = models.ForeignKey("customers.Company", on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name="lgpd_requests")
    kind        = models.CharField(max_length=15)   # export | anonymize | rectify
    status      = models.CharField(max_length=12, default="pending")
    requested_by = models.ForeignKey("accounts.User", on_delete=models.SET_NULL, null=True,
                                     related_name="requested_lgpd")
    executed_at = models.DateTimeField(null=True, blank=True)
    result      = models.JSONField(default=dict, blank=True)  # o que foi anonimizado
    notes       = models.TextField(blank=True)
```

`AuditLog` e `TicketAccessLog` são append-only: sem `update`/`delete` na aplicação, e o usuário
do banco usado pela app idealmente não tem `DELETE` nelas.

---

## `reports`

Sem tabelas agregadas: em 50–500 tickets/mês, consultas com `annotate`/`aggregate` sobre
`Ticket` e `TicketStatusEvent` resolvem com folga. Materializar métricas agora seria
complexidade prematura — o ponto de virada fica documentado (acima de ~5k tickets/mês,
introduzir `TicketDailyMetric`).

```python
class ExportFormat(models.TextChoices):
    CSV = "csv"; XLSX = "xlsx"; PDF = "pdf"


class ReportExport(TimeStampedModel):
    requested_by = models.ForeignKey("accounts.User", on_delete=models.CASCADE,
                                     related_name="report_exports")
    report_key   = models.CharField(max_length=50)   # by_agent | by_company | by_user | ...
    params       = models.JSONField(default=dict)    # período, filtros
    format       = models.CharField(max_length=5, choices=ExportFormat.choices)
    status       = models.CharField(max_length=12, default="pending")
    file         = models.FileField(upload_to="exports/%Y/%m/", null=True, blank=True)
    row_count    = models.PositiveIntegerField(null=True, blank=True)
    error        = models.TextField(blank=True)
    expires_at   = models.DateTimeField(null=True, blank=True)   # expurgo automático
```

### Métricas e como saem dos dados

| Métrica | Cálculo |
|---|---|
| Tempo de primeira resposta | `first_response_at − created_at`, opcionalmente em horário comercial |
| Tempo de resolução | `resolution_ended_at − resolution_started_at` (trabalho técnico real) |
| Tempo total de ciclo | `closed_at − created_at` |
| Tempo aguardando cliente | soma dos intervalos em `PENDING_CUSTOMER` via `TicketStatusEvent` |
| Tempo aguardando agente | soma dos intervalos em `NEW` + `OPEN` |
| Volume | `count()` por período/agente/empresa/usuário |
| Reabertos | `reopen_count > 0`, e total de reaberturas via `TicketStatusEvent(is_reopen=True)` |

O SLA "justo" é `tempo aguardando agente`, não o tempo de parede — por isso os dois
acumuladores são separados e derivados de eventos, não estimados.
