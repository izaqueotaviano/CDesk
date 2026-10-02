"""Customers — empresas clientes, planos e cota de tickets.

A cota tem duas estruturas deliberadamente redundantes (docs/05 §2.2):
- `TicketQuotaConsumption` é o livro-razão auditável (uma linha por consumo);
- `QuotaPeriodCounter` é o objeto de lock + leitura O(1), derivável do ledger.
"Reset" de período não existe: o período faz parte da chave do contador (docs/05 §2.3).
"""

from django.db import models

from apps.core.models import TimeStampedModel
from apps.customers.services.embed import generate_secret


class LimitPeriod(models.TextChoices):
    WEEKLY = "weekly", "Semanal"
    MONTHLY = "monthly", "Mensal"


class LimitScope(models.TextChoices):
    COMPANY = "company", "Por empresa"
    USER = "user", "Por usuário"


class Plan(TimeStampedModel):
    """Gold, Platinum, Black — dados, não enum (premissa P4).

    A escada é Gold (básico) → Platinum → Black, e quem diz isso é `rank`:
    nenhum lugar do código compara slug para saber qual plano é superior.
    """

    slug = models.SlugField(unique=True)
    name = models.CharField(max_length=50)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    rank = models.PositiveSmallIntegerField(default=0, help_text="Maior = plano superior.")

    default_ticket_limit = models.PositiveIntegerField(
        null=True, blank=True, help_text="Vazio = ilimitado."
    )
    default_limit_period = models.CharField(
        max_length=10, choices=LimitPeriod.choices, default=LimitPeriod.MONTHLY
    )
    chat_enabled = models.BooleanField(default=True)
    # D2/F-A: chat que vira ticket não debita a cota.
    chat_consumes_quota = models.BooleanField(default=False)

    # Horas de manutenção contratadas por mês. Em MINUTOS, e não em horas
    # decimais, por dois motivos: o consumo é somado a partir de
    # (término − início) da solução, que nasce em minutos, e somar decimal com
    # decimal acumula erro justamente onde o número vira cobrança. A tela de
    # configuração continua falando em horas — a conversão é dela.
    # Vazio = sem franquia de horas (nada é medido para este plano).
    monthly_maintenance_minutes = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Franquia mensal de manutenção, em minutos. Vazio = sem franquia.",
    )

    class Meta:
        verbose_name = "plano"
        ordering = ["-rank"]

    def __str__(self):
        return self.name


class Company(TimeStampedModel):
    """Empresa cliente — a fronteira de isolamento de dados do sistema."""

    name = models.CharField(max_length=150)
    legal_name = models.CharField(max_length=200, blank=True)
    tax_id = models.CharField(
        "CNPJ", max_length=20, unique=True, null=True, blank=True
    )
    slug = models.SlugField(unique=True)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="companies")
    is_active = models.BooleanField(default=True)

    # overrides do plano (vazio = herda)
    ticket_limit = models.PositiveIntegerField(null=True, blank=True)
    maintenance_minutes = models.PositiveIntegerField(
        null=True, blank=True,
        help_text="Franquia de manutenção só desta empresa. Vazio = herda do plano.",
    )
    limit_period = models.CharField(
        max_length=10, choices=LimitPeriod.choices, null=True, blank=True
    )
    limit_scope = models.CharField(
        max_length=10, choices=LimitScope.choices, default=LimitScope.COMPANY  # P1
    )

    timezone = models.CharField(max_length=64, default="America/Sao_Paulo")
    business_calendar = models.ForeignKey(
        "core.BusinessCalendar",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="companies",
    )
    account_manager = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_companies",
    )
    contract_started_at = models.DateField(null=True, blank=True)
    contract_ended_at = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)  # LGPD (D11)

    class Meta:
        verbose_name = "empresa cliente"
        verbose_name_plural = "empresas clientes"

    def __str__(self):
        return self.name

    @property
    def effective_ticket_limit(self):
        if self.ticket_limit is not None:
            return self.ticket_limit
        return self.plan.default_ticket_limit

    @property
    def effective_limit_period(self):
        return self.limit_period or self.plan.default_limit_period

    @property
    def effective_maintenance_minutes(self):
        """Franquia de horas desta empresa. `None` = não há franquia — e isso é
        diferente de zero, que seria uma franquia esgotada de saída."""
        if self.maintenance_minutes is not None:
            return self.maintenance_minutes
        return self.plan.monthly_maintenance_minutes


class CompanyDomain(models.Model):
    """Domínio de e-mail vinculado à empresa (GAPS.md #11 — "criar vínculo").

    Um domínio pertence a NO MÁXIMO uma empresa (`unique=True`): é essa
    unicidade que torna a resolução "de que empresa é este e-mail?"
    determinística. `apps.customers.services.domain_linking` é quem consome
    esta tabela.

    Decisão explícita desta rodada (GAPS.md, revisão do usuário): só o campo
    e a função de resolução nascem agora. Hoje não existe nenhum fluxo sem
    convite prévio (auto-cadastro está fechado — `apps/accounts/adapters.py`),
    então nada chama `resolve_company_by_email_domain()` ainda. Fica pronta
    para o dia em que existir um ponto de entrada sem convite (chat público,
    formulário, etc.) — não é dead code, é uma peça à espera do consumidor.
    """

    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="domains")
    # minúsculo e sem "@": só o que vem depois do @ (ex.: "convertize.com.br")
    domain = models.CharField(max_length=190, unique=True, db_index=True)

    class Meta:
        verbose_name = "domínio da empresa"
        verbose_name_plural = "domínios da empresa"
        ordering = ["domain"]

    def __str__(self):
        return self.domain

    def clean(self):
        self.domain = self.domain.strip().lower().lstrip("@")


class CompanyChatEmbed(models.Model):
    """Config do "mini chat" embutido em outra plataforma (Vtex, Tray
    Commerce…), um por empresa (docs/14-seguranca.md §10).

    A ideia: a equipe do cliente já está logada no PRÓPRIO console dele
    (Vtex/Tray); em vez de pedir login de novo dentro do iframe, a página
    que hospeda o widget DECLARA quem é a pessoa (e-mail) e ASSINA essa
    declaração com `secret` — só quem tem a chave desta empresa consegue
    forjar uma identidade válida. `secret` nunca é reexibido depois de
    gerado (mesma UX de uma chave de API): só `regenerate` devolve o valor
    cru, uma vez, na resposta.

    `enabled=False` por padrão: cadastrar a config não abre a porta sozinho
    — alguém precisa marcar "ligado" depois de conferir os domínios.
    """

    company = models.OneToOneField(
        "customers.Company", on_delete=models.CASCADE, related_name="chat_embed"
    )
    enabled = models.BooleanField(default=False)
    # Modo público: UM código por empresa, colado uma vez no site, sem
    # assinatura por pessoa. É o que permite embutir numa loja/página pública,
    # onde não existe ninguém logado para assinar. Quem se identifica é o
    # próprio visitante, dentro da janelinha (nome + e-mail), e o que garante
    # que o widget só abre onde deveria continua sendo a lista de origens —
    # a mesma dos dois modos.
    #
    # Desligado por padrão, e independente de `enabled`: ligar o embed não
    # abre a porta pública junto. Com ele desligado, só a URL assinada entra
    # (o modo identificado de sempre, que é o certo dentro de um console onde
    # a pessoa JÁ está logada — ali a identidade é real, não declarada).
    public_enabled = models.BooleanField(default=False)
    secret = models.CharField(max_length=64, default=generate_secret, editable=False)
    rotated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "embed do chat"
        verbose_name_plural = "embeds do chat"

    def __str__(self):
        return f"embed do chat ({self.company.name})"


class CompanyChatEmbedOrigin(models.Model):
    """Uma origem (`scheme://host[:porta]`, sem caminho) autorizada a
    embutir o mini chat desta empresa em iframe. N por empresa (homologação
    e produção, ou Vtex e Tray ao mesmo tempo).

    É esta tabela que decide DUAS coisas, e as duas são de segurança:
    - se o `frame-ancestors` da resposta relaxa pra deixar embutir (só pra
      quem está aqui, nunca em geral — ver `apps.customers.embed_views`);
    - nada além disso: a origem NÃO participa da assinatura HMAC (essa é só
      `company + email + timestamp`), então adicionar uma origem nova não
      invalida chave nem snippet já distribuídos.
    """

    embed = models.ForeignKey(CompanyChatEmbed, on_delete=models.CASCADE, related_name="origins")
    # sem barra final, sem caminho — é isso que o header Origin do navegador manda
    origin = models.CharField(max_length=255)

    class Meta:
        verbose_name = "origem autorizada do embed"
        verbose_name_plural = "origens autorizadas do embed"
        ordering = ["origin"]
        constraints = [
            models.UniqueConstraint(fields=["embed", "origin"], name="uniq_embed_origin")
        ]

    def __str__(self):
        return self.origin

    def clean(self):
        self.origin = self.origin.strip().rstrip("/").lower()


class MaintenanceOverage(models.Model):
    """Registro de que a franquia de horas de uma empresa esgotou num mês.

    Existe para uma coisa só: garantir que o Comercial receba **um** chamado
    por empresa por mês, e não um a cada fechamento depois do estouro. A
    unicidade é do banco, não de um `if` — dois agentes fechando chamados ao
    mesmo tempo é o caso normal, não o excepcional.

    `ticket` é SET_NULL: o chamado do Comercial pode ser apagado por retenção
    sem que a empresa volte a receber outro aviso do mesmo mês.
    """

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="maintenance_overages"
    )
    period_start = models.DateField()
    ticket = models.ForeignKey(
        "tickets.Ticket",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_overages",
    )
    # o que era verdade no momento do estouro — a franquia pode mudar depois,
    # e sem isto não dá para explicar por que o aviso foi aberto
    used_minutes = models.PositiveIntegerField()
    limit_minutes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "estouro de franquia"
        verbose_name_plural = "estouros de franquia"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "period_start"], name="uniq_maintenance_overage"
            )
        ]

    def __str__(self):
        return f"{self.company_id} {self.period_start}: {self.used_minutes}min"


class TicketQuotaConsumption(models.Model):
    """Ledger: uma linha por ticket que consumiu vaga da cota.

    Reabertura não cria linha (P6). `limit_snapshot` preserva o limite vigente
    na hora — é o que explica bloqueios históricos após mudança de plano.
    """

    company = models.ForeignKey(
        Company, on_delete=models.PROTECT, related_name="quota_consumptions"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.PROTECT, related_name="quota_consumptions"
    )
    ticket = models.OneToOneField(
        "tickets.Ticket", on_delete=models.PROTECT, related_name="quota_consumption"
    )
    period_start = models.DateField()
    period_end = models.DateField()
    scope = models.CharField(max_length=10, choices=LimitScope.choices)
    limit_snapshot = models.PositiveIntegerField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "consumo de cota"
        verbose_name_plural = "consumos de cota"
        indexes = [
            models.Index(fields=["company", "period_start"]),
            models.Index(fields=["user", "period_start"]),
        ]

    def __str__(self):
        return f"Consumo do ticket {self.ticket_id} ({self.period_start})"


class QuotaPeriodCounter(models.Model):
    """Contador materializado por período — alvo do SELECT FOR UPDATE que fecha a
    corrida de dois usuários abrindo ticket no último slot (docs/05 §2.2)."""

    company = models.ForeignKey(
        Company, on_delete=models.CASCADE, related_name="quota_counters"
    )
    user = models.ForeignKey(
        "accounts.User",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        help_text="Preenchido apenas quando o escopo do limite é por usuário.",
    )
    period_start = models.DateField()
    used = models.PositiveIntegerField(default=0)

    class Meta:
        verbose_name = "contador de cota"
        verbose_name_plural = "contadores de cota"
        constraints = [
            models.UniqueConstraint(
                fields=["company", "user", "period_start"],
                name="uniq_quota_counter",
                nulls_distinct=False,  # (company, NULL, período) também é único
            )
        ]

    def __str__(self):
        return f"{self.company_id} {self.period_start}: {self.used}"
