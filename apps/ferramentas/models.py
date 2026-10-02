"""Ferramentas de administração: importação do Movidesk e backup do banco.

As duas são a mesma coisa vista de dois lados — um trabalho demorado que o
admin dispara pela tela, acompanha por um log ao vivo e consulta depois.
Por isso o `TrabalhoBase` abstrato: status, etapa, progresso e log moram num
lugar só, e cada ferramenta acrescenta o que é dela.

O log fica no próprio registro (JSON), não em arquivo: é o que a tela lê por
polling, e um job de importação de 2 mil tickets produz algumas centenas de
linhas — cabe folgado numa coluna. `registrar()` corta no teto pra um loop
desgovernado não crescer o registro sem fim.
"""

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel

LINHAS_DE_LOG_MAXIMAS = 500


class StatusTrabalho(models.TextChoices):
    PENDENTE = "pendente", "Na fila"
    RODANDO = "rodando", "Em andamento"
    CONCLUIDO = "concluido", "Concluído"
    ERRO = "erro", "Falhou"
    CANCELADO = "cancelado", "Cancelado"


class TrabalhoBase(TimeStampedModel):
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    status = models.CharField(
        max_length=12,
        choices=StatusTrabalho.choices,
        default=StatusTrabalho.PENDENTE,
    )
    # O que está acontecendo AGORA, em uma linha ("Baixando página 3",
    # "Importando 120 de 500") — é o texto ao lado da barra de progresso.
    etapa = models.CharField(max_length=200, blank=True)
    # 0–100, ou nulo quando não dá pra saber (baixando sem saber o total).
    progresso = models.PositiveSmallIntegerField(null=True, blank=True)
    log = models.JSONField(default=list, blank=True)
    erro = models.TextField(blank=True)
    celery_task_id = models.CharField(max_length=64, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True
        ordering = ["-id"]

    @property
    def ativo(self) -> bool:
        return self.status in (StatusTrabalho.PENDENTE, StatusTrabalho.RODANDO)

    def registrar(
        self,
        mensagem: str,
        *,
        nivel: str = "info",
        etapa: str | None = None,
        progresso: int | None = None,
    ) -> None:
        """Acrescenta uma linha ao log e grava. `etapa`/`progresso` só mudam
        quando informados — a linha de log é frequente, a etapa nem tanto."""
        self.log = [
            *self.log,
            {
                "t": timezone.now().isoformat(timespec="seconds"),
                "nivel": nivel,
                "msg": mensagem,
            },
        ][-LINHAS_DE_LOG_MAXIMAS:]
        campos = ["log", "updated_at"]
        if etapa is not None:
            self.etapa = etapa
            campos.append("etapa")
        if progresso is not None:
            self.progresso = max(0, min(100, progresso))
            campos.append("progresso")
        self.save(update_fields=campos)

    def iniciar(self) -> None:
        self.status = StatusTrabalho.RODANDO
        self.started_at = timezone.now()
        self.save(update_fields=["status", "started_at", "updated_at"])

    def concluir(self) -> None:
        self.status = StatusTrabalho.CONCLUIDO
        self.progresso = 100
        self.finished_at = timezone.now()
        self.save(update_fields=["status", "progresso", "finished_at", "updated_at"])

    def falhar(self, motivo: str) -> None:
        self.status = StatusTrabalho.ERRO
        self.erro = motivo[:4000]
        self.finished_at = timezone.now()
        self.save(update_fields=["status", "erro", "finished_at", "updated_at"])
        self.registrar(motivo, nivel="erro")

    def cancelar(self) -> None:
        self.status = StatusTrabalho.CANCELADO
        self.finished_at = timezone.now()
        self.save(update_fields=["status", "finished_at", "updated_at"])

    def foi_cancelado(self) -> bool:
        """Relê o status do banco — é como a task percebe, entre uma página e
        outra, que alguém apertou "cancelar" na tela."""
        atual = type(self).objects.filter(pk=self.pk).values_list("status", flat=True).first()
        return atual == StatusTrabalho.CANCELADO


class ImportacaoMovidesk(TrabalhoBase):
    """Uma rodada de importação: baixa da API do Movidesk e grava no Resolv.

    O token da API NÃO mora aqui, de propósito: ele dá acesso à base inteira
    do Movidesk. A tela manda no POST, a view guarda no cache só até a task
    pegar (ver views.py/tasks.py), e o registro que sobra não tem segredo.
    """

    team = models.ForeignKey("accounts.Team", on_delete=models.PROTECT, related_name="+")
    plan = models.ForeignKey("customers.Plan", on_delete=models.PROTECT, related_name="+")
    # nulo = a base inteira
    limite = models.PositiveIntegerField(null=True, blank=True)
    # só baixar e guardar o JSON, sem gravar tickets — pra conferir antes
    apenas_baixar = models.BooleanField(default=False)
    # o JSON completo que veio da API — reprocessável, e é o que se confere
    arquivo = models.FileField(upload_to="movidesk/%Y/%m/", null=True, blank=True)

    tickets_baixados = models.PositiveIntegerField(default=0)
    tickets_criados = models.PositiveIntegerField(default=0)
    tickets_atualizados = models.PositiveIntegerField(default=0)
    tickets_ignorados = models.PositiveIntegerField(default=0)
    mensagens_importadas = models.PositiveIntegerField(default=0)
    # os avisos acionáveis do ImportReport (agente sem cadastro etc.)
    avisos = models.JSONField(default=list, blank=True)

    class Meta(TrabalhoBase.Meta):
        verbose_name = "importação do Movidesk"
        verbose_name_plural = "importações do Movidesk"

    def __str__(self):
        return f"Importação Movidesk #{self.pk} ({self.status})"


class ImportacaoPessoas(TrabalhoBase):
    """Uma rodada da rota `/persons`: empresas, contatos e agentes.

    Mesmo desenho da importação de tickets (token pelo cache, JSON guardado,
    contadores do relatório). Sem equipe: agente entra nas equipes que tem
    lá; contato entra na empresa que tem lá.
    """

    plan = models.ForeignKey("customers.Plan", on_delete=models.PROTECT, related_name="+")
    # agente vira usuário interno DESATIVADO; desligado = só empresas e contatos
    criar_agentes = models.BooleanField(default=True)
    limite = models.PositiveIntegerField(null=True, blank=True)
    apenas_baixar = models.BooleanField(default=False)
    arquivo = models.FileField(upload_to="movidesk/%Y/%m/", null=True, blank=True)

    pessoas_baixadas = models.PositiveIntegerField(default=0)
    empresas_criadas = models.PositiveIntegerField(default=0)
    empresas_atualizadas = models.PositiveIntegerField(default=0)
    contatos_criados = models.PositiveIntegerField(default=0)
    contatos_atualizados = models.PositiveIntegerField(default=0)
    agentes_criados = models.PositiveIntegerField(default=0)
    agentes_atualizados = models.PositiveIntegerField(default=0)
    ignorados = models.PositiveIntegerField(default=0)
    avisos = models.JSONField(default=list, blank=True)

    class Meta(TrabalhoBase.Meta):
        verbose_name = "importação de pessoas do Movidesk"
        verbose_name_plural = "importações de pessoas do Movidesk"

    def __str__(self):
        return f"Importação de pessoas #{self.pk} ({self.status})"


class TipoBackup(models.TextChoices):
    BACKUP = "backup", "Backup"
    RESTAURACAO = "restauracao", "Restauração"


class OrigemBackup(models.TextChoices):
    MANUAL = "manual", "Manual"
    AGENDADO = "agendado", "Agendado"
    # o backup de segurança tirado automaticamente ANTES de restaurar outro
    PRE_RESTAURACAO = "pre_restauracao", "Antes de restaurar"


class TrabalhoBackup(TrabalhoBase):
    """Um backup (pg_dump) ou uma restauração (psql) do banco inteiro.

    O arquivo em si mora em `settings.BACKUP_DIR`, com o MESMO nome que
    scripts/backup_postgres.sh gera (`resolv-AAAAMMDD-HHMMSS.sql.gz`) — assim
    os backups do timer do systemd e os da tela aparecem na mesma lista.
    """

    tipo = models.CharField(max_length=12, choices=TipoBackup.choices, default=TipoBackup.BACKUP)
    origem = models.CharField(
        max_length=16, choices=OrigemBackup.choices, default=OrigemBackup.MANUAL
    )
    # nome do arquivo em BACKUP_DIR (o gerado, ou o restaurado)
    arquivo_nome = models.CharField(max_length=80, blank=True)
    tamanho_bytes = models.BigIntegerField(null=True, blank=True)

    class Meta(TrabalhoBase.Meta):
        verbose_name = "trabalho de backup"
        verbose_name_plural = "trabalhos de backup"

    def __str__(self):
        return f"{self.get_tipo_display()} #{self.pk} ({self.status})"
