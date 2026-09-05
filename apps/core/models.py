"""Core — infraestrutura compartilhada por todos os apps de domínio."""

from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.db import models

from apps.core.email_template import TEMPLATE_HTML_PADRAO


class TimeStampedModel(models.Model):
    """Base de todos os models de negócio: carimbo de criação e atualização."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class BusinessCalendar(TimeStampedModel):
    """Horário comercial usado no cálculo de SLA e na regra de chat fora de expediente.

    `workdays` é uma lista de janelas por dia da semana (0=segunda … 6=domingo):
        [{"weekday": 0, "start": "09:00", "end": "18:00"}, ...]
    Dias ausentes da lista não contam como expediente.
    """

    name = models.CharField(max_length=80, unique=True)
    timezone = models.CharField(max_length=64, default="America/Sao_Paulo")
    is_default = models.BooleanField(
        default=False,
        help_text="Calendário aplicado quando a empresa não define um próprio (D15).",
    )
    workdays = models.JSONField(default=list, blank=True)

    class Meta:
        verbose_name = "calendário comercial"
        verbose_name_plural = "calendários comerciais"

    def __str__(self):
        return self.name


class Holiday(models.Model):
    """Feriado no calendário.

    Sem horário, é dia inteiro sem expediente (o caso comum). Com `start_time` e
    `end_time`, é feriado de MEIO PERÍODO: naquele dia o atendimento funciona só
    dentro dessa janela, ignorando o expediente normal da semana — é o
    "funciona meio período" (véspera de Natal até o meio-dia, por exemplo)."""

    calendar = models.ForeignKey(
        BusinessCalendar, on_delete=models.CASCADE, related_name="holidays"
    )
    date = models.DateField()
    name = models.CharField(max_length=120)
    # ambos vazios = dia inteiro fechado; ambos preenchidos = só abre nesta janela
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    class Meta:
        verbose_name = "feriado"
        constraints = [
            models.UniqueConstraint(fields=["calendar", "date"], name="uniq_holiday_per_day")
        ]

    def __str__(self):
        return f"{self.date} — {self.name}"


class SystemConfig(TimeStampedModel):
    """Parâmetros operacionais editáveis pelo admin, em linha única (singleton).

    Antes destes campos viverem aqui, cada um era uma variável de ambiente: mudar
    o limite de anexo exigia deploy. Isso é aceitável para segredo e endereço de
    serviço, e errado para número que a operação ajusta — o limite de anexo e o
    tempo de abandono do chat mudam com o uso, não com a infraestrutura.

    As settings do Django continuam existindo como **piso de fallback**: se a
    linha ainda não foi criada (banco novo, migration recém-aplicada), o sistema
    usa o default do código em vez de quebrar.
    """

    CACHE_KEY = "core:system-config"

    # --- Anexos (D13) ---
    attachment_max_bytes = models.PositiveIntegerField(
        default=10 * 1024 * 1024,
        verbose_name="Tamanho máximo por arquivo (bytes)",
        help_text="Regra de produto: 10 MB por arquivo, mídia ou documento.",
    )
    attachment_max_files_per_message = models.PositiveSmallIntegerField(
        default=10,
        verbose_name="Máximo de arquivos por mensagem",
    )
    attachment_max_bytes_per_message = models.PositiveIntegerField(
        default=100 * 1024 * 1024,
        verbose_name="Tamanho máximo somado por mensagem (bytes)",
        help_text=(
            "Precisa acompanhar (máx. por arquivo × máx. de arquivos), senão o "
            "usuário esbarra num limite que a tela não anunciou."
        ),
    )


    # --- Entrega de e-mail ---
    # A operação liga/desliga a saída de e-mail e aponta o SMTP daqui, sem
    # deploy. Host vazio = o backend das settings (console em dev, o que o
    # ambiente definir em produção). Desligado = o outbox registra o e-mail
    # como pulado e nada sai — inclusive código de login, então a tela avisa.
    # A senha fica em texto no banco, como ficaria numa variável de
    # ambiente: o que a protege é o acesso ao banco, não este campo.
    email_enabled = models.BooleanField(
        default=True, verbose_name="Enviar e-mails",
    )
    smtp_host = models.CharField(max_length=200, blank=True, default="", verbose_name="Servidor SMTP")
    smtp_port = models.PositiveIntegerField(default=587, verbose_name="Porta")
    smtp_username = models.CharField(max_length=200, blank=True, default="", verbose_name="Usuário")
    smtp_password = models.CharField(max_length=200, blank=True, default="", verbose_name="Senha")
    smtp_use_tls = models.BooleanField(default=True, verbose_name="STARTTLS")
    smtp_use_ssl = models.BooleanField(default=False, verbose_name="SSL")
    email_from = models.CharField(
        max_length=200, blank=True, default="", verbose_name="Remetente",
        help_text="Ex.: Suporte Acme <suporte@acme.com.br>. Vazio usa o das settings.",
    )
    email_html_template = models.TextField(
        blank=True, default=TEMPLATE_HTML_PADRAO, verbose_name="Modelo HTML dos e-mails",
        help_text="Vazio manda só o texto. Marcadores: {{assunto}}, {{conteudo}}, {{ano}}.",
    )

    # --- Pesquisa de satisfação ---
    csat_enabled = models.BooleanField(
        default=True,
        verbose_name="Enviar pesquisa de satisfação ao fechar o ticket",
    )
    csat_expires_days = models.PositiveSmallIntegerField(
        default=30,
        verbose_name="Dias de validade do link da pesquisa",
        help_text=(
            "Depois disso o link para de aceitar resposta. Prazo curto demais "
            "derruba a taxa de resposta; longo demais deixa um link vivo à toa."
        ),
    )

    # --- Fechamento automático de "aguardando o cliente" ---
    # As 72h contam em horas CORRIDAS (relógio de parede), não em horário de
    # atendimento — decisão explícita: um ticket que entra em "aguardando o
    # cliente" na sexta à tarde pode fechar no domingo à noite. É por isso que
    # existe o aviso abaixo, e não porque o prazo em si respeita expediente.
    auto_close_pending_hours = models.PositiveSmallIntegerField(
        default=72,
        verbose_name="Horas corridas sem resposta do cliente até fechar automaticamente",
        help_text=(
            "Ticket parado em 'aguardando o cliente' por mais que isto é fechado "
            "sozinho. Conta em horas corridas (relógio normal, não horário "
            "comercial). Zero desliga o fechamento automático."
        ),
    )
    auto_close_message = models.TextField(
        default=(
            "Como não tivemos retorno, estamos encerrando este chamado. Se ainda "
            "precisar de ajuda, abra um novo chamado — este aqui não pode mais "
            "ser reaberto por resposta."
        ),
        verbose_name="Mensagem enviada ao fechar por falta de resposta",
        help_text="O cliente vê este texto no chamado quando ele fecha sozinho.",
    )
    # Aviso prévio (D5): reduz reabertura e reclamação — chega faltando estas
    # horas para o fechamento, não em um horário fixo. Zero desliga o aviso
    # mesmo com o fechamento automático ligado.
    auto_close_warning_hours = models.PositiveSmallIntegerField(
        default=24,
        verbose_name="Avisar quantas horas antes do fechamento automático",
        help_text=(
            "Ex.: prazo de 72h e aviso de 24h manda o lembrete com 48h de espera "
            "(faltando 24h para fechar). Zero desliga o aviso."
        ),
    )
    auto_close_warning_message = models.TextField(
        default=(
            "Ainda estamos aguardando seu retorno neste chamado. Se não "
            "recebermos resposta em breve, ele será encerrado automaticamente "
            "por falta de retorno."
        ),
        verbose_name="Mensagem do aviso prévio de fechamento",
        help_text="O cliente vê este texto antes do fechamento automático acontecer.",
    )

    class Meta:
        verbose_name = "configuração do sistema"
        verbose_name_plural = "configuração do sistema"

    def __str__(self):
        return "Configuração do sistema"

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton: nunca existe uma segunda linha para divergir

        # Instância NOVA apontando para a linha que já existe: sem isto o Django
        # a trata como inserção, `auto_now_add` não dispara e o INSERT estoura o
        # NOT NULL de `created_at`. Forçar o pk não basta — o estado também
        # precisa dizer que isto é uma atualização.
        if self._state.adding:
            existente = type(self).objects.filter(pk=1).values("created_at").first()
            if existente is not None:
                self._state.adding = False
                self.created_at = existente["created_at"]

        super().save(*args, **kwargs)
        cache.delete(self.CACHE_KEY)

    def delete(self, *args, **kwargs):  # noqa: ARG002 - assinatura do Django
        raise ValidationError("A configuração do sistema não pode ser removida.")

    def clean(self):
        soma = self.attachment_max_bytes * self.attachment_max_files_per_message
        if self.attachment_max_bytes_per_message > soma:
            raise ValidationError({
                "attachment_max_bytes_per_message": (
                    "Não pode passar de (máx. por arquivo × máx. de arquivos) = "
                    f"{soma // 1024 // 1024} MB — seria um limite inalcançável."
                )
            })

    @classmethod
    def load(cls):
        """Instância corrente, em cache. Cria a linha na primeira leitura."""
        config = cache.get(cls.CACHE_KEY)
        if config is None:
            config, _ = cls.objects.get_or_create(pk=1)
            cache.set(cls.CACHE_KEY, config, 300)
        return config
