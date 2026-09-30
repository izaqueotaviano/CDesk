"""Accounts — usuários (internos e clientes) e as equipes que eles atendem.

Um único model de User com discriminador `kind` (premissa P5 de docs/01):
ticket, mensagem, auditoria e notificação apontam todos para "alguém", e dois
models exigiriam GenericForeignKey em todo lugar. As CheckConstraints garantem
no banco que um interno nunca tem empresa e um cliente nunca tem papel interno.

**Equipe é o conceito único de agrupamento.** Até a fusão havia dois eixos
paralelos: o antigo "departamento" (o que o cliente escolhia ao abrir o chamado
e o que recortava a visibilidade do agente) e a equipe (o agrupamento interno
com supervisor). Um ticket morava num departamento e, às vezes, também numa
equipe; um agente tinha UMA equipe e N departamentos. Ninguém conseguia dizer
qual dos dois respondia por quê. Agora é um só: `Team` absorveu os campos do
departamento, e o vínculo agente↔equipe é N:N (`AgentTeam`) — o mesmo agente
pode atender Design e Suporte nível 2 ao mesmo tempo.
"""

import datetime as dt
import secrets

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.db.models import Q
from django.utils import timezone

from apps.accounts import assinatura, rbac
from apps.core.models import TimeStampedModel


class UserKind(models.TextChoices):
    INTERNAL = "internal", "Interno"
    CLIENT = "client", "Cliente"


class TwoFactorMethod(models.TextChoices):
    # SMS ficaria aqui como terceiro valor, mas exige um gateway (Twilio ou
    # similar) que o projeto não tem configurado — sem provedor, oferecer a
    # opção seria prometer um código que nunca chega. Quando houver, basta
    # acrescentar o valor e o canal de envio no fluxo de login.
    EMAIL = "email", "Código por e-mail"
    TOTP = "totp", "Aplicativo autenticador"


class PresenceStatus(models.TextChoices):
    """Status ao vivo do agente — Disponível/Ausente/Offline.

    Existia só no front (um `useState` que resetava a cada F5, sem ninguém
    além do próprio agente ver — achado da auditoria original, ver
    GAPS.md). O valor de existir isto é justo os OUTROS enxergarem, então
    `OFFLINE` é o default de fábrica (`User` recém-criado nunca logou) e
    login/logout mudam o valor sozinhos (ver `TwoFactorVerifyView`/
    `LogoutView`) — a pessoa não precisa lembrar de "ficar offline" ao sair.
    """

    AVAILABLE = "available", "Disponível"
    AWAY = "away", "Ausente"
    OFFLINE = "offline", "Offline"


class InternalRole(models.TextChoices):
    """Papéis embutidos. O que cada um PODE mora em `apps/accounts/rbac.py`,
    nunca aqui — este enum é só a identidade do papel."""

    ADMIN = "admin", "Administrador"
    SUPERVISOR = "supervisor", "Supervisor"
    AGENT = "agent", "Agente"
    # Colaborador de outra área (engenharia, produto, financeiro) que
    # acompanha o caso por dentro: lê e comenta INTERNAMENTE, não fala com o
    # cliente nem é atribuído. Ver `_LIGHT_AGENT_PERMS` em rbac.py.
    LIGHT_AGENT = "light_agent", "Agente leve"


class ClientRole(models.TextChoices):
    OWNER = "owner", "Responsável"  # gerencia os usuários da própria empresa
    MEMBER = "member", "Usuário"


class TeamVisibility(models.TextChoices):
    COMPANY_WIDE = "company_wide", "Toda a empresa cliente"
    REQUESTER_ONLY = "requester_only", "Apenas o solicitante"  # caso Financeiro


class Team(TimeStampedModel):
    """Equipe de atendimento — o único agrupamento do sistema.

    Ela é as três coisas ao mesmo tempo: o grupo interno com supervisor, o
    recorte que decide quais tickets cada agente enxerga (`AgentTeam` + o
    `visible_to` de tickets) e a opção que o cliente escolhe ao abrir o
    chamado. Financeiro é só a primeira com `visibility=REQUESTER_ONLY` —
    nada no código testa slug (P2/P3).
    """

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)
    supervisor = models.ForeignKey(
        "User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supervised_teams",
    )
    is_active = models.BooleanField(default=True)
    order = models.PositiveSmallIntegerField(default=0)

    visibility = models.CharField(
        max_length=20,
        choices=TeamVisibility.choices,
        default=TeamVisibility.COMPANY_WIDE,
    )
    # D6: para não-solicitantes, além do nome do solicitante, o assunto também é mascarado.
    mask_subject_for_others = models.BooleanField(default=True)

    # Equipe de uso interno: Comercial é o primeiro caso. Duas coisas de uma
    # vez — some do seletor de abertura do cliente E os tickets dela saem de
    # `visible_to` para cliente. É mais forte que REQUESTER_ONLY, que ainda
    # deixa a linha aparecer mascarada na listagem da empresa.
    #
    # ⚑ Como `visibility`, isto é CONFIGURAÇÃO e vale para tickets já
    # existentes: desmarcar aqui revela ao cliente o histórico da equipe.
    internal_only = models.BooleanField(
        default=False,
        help_text="Equipe interna: o cliente não abre nem enxerga estes tickets.",
    )
    # D16/F-D: fora deste calendário o chat aceita a mensagem e vira ticket.
    chat_calendar = models.ForeignKey(
        "core.BusinessCalendar",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_teams",
    )
    notification_email = models.EmailField(blank=True)
    description = models.TextField(blank=True)

    class Meta:
        verbose_name = "equipe"
        ordering = ["order", "name"]

    def __str__(self):
        return self.name

    @property
    def is_restricted(self) -> bool:
        return self.visibility == TeamVisibility.REQUESTER_ONLY


class CustomRole(TimeStampedModel):
    """Papel personalizado — a combinação de permissões que um cliente monta.

    Existe para o caso que os quatro papéis embutidos não cobrem, e que é
    sempre o mesmo na prática: "quero um agente que NÃO faça X". Por isso o
    conjunto aqui SUBSTITUI o do papel embutido em vez de somar (ver
    `rbac.permissions_for`) — uma união nunca conseguiria tirar nada.

    O usuário continua tendo `internal_role` mesmo com papel personalizado:
    ele é a identidade base (o que a CheckConstraint do banco exige, o que
    `is_admin` responde, o que a tela mostra como "derivado de"), enquanto o
    papel personalizado responde só "o que pode". Separar os dois é o que
    permite um papel personalizado existir sem reescrever toda leitura de
    `internal_role` do sistema.

    `permissions` é lista de strings do catálogo `rbac.Perm`, não M2M para
    uma tabela: permissão é contrato da aplicação, não dado do cliente — uma
    tabela exigiria migração a cada tela nova e poderia divergir do código
    que a consome. Valor fora do catálogo é ignorado na leitura, então
    remover uma permissão do código nunca quebra um papel gravado.
    """

    name = models.CharField(max_length=80, unique=True)
    slug = models.SlugField(unique=True)
    description = models.TextField(blank=True)

    #: De qual papel embutido este deriva — só documenta a intenção e alimenta
    #: o "Duplicar a partir de" da tela; a autorização não lê este campo.
    base_role = models.CharField(
        max_length=12, choices=InternalRole.choices, default=InternalRole.AGENT
    )
    permissions = models.JSONField(default=list, blank=True)
    #: Vazio = usa o padrão do `base_role` (ver `rbac.ticket_scope_for`).
    ticket_scope = models.CharField(
        max_length=10, choices=rbac.TicketScope.choices, blank=True, default=""
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "papel personalizado"
        verbose_name_plural = "papéis personalizados"
        ordering = ["name"]

    def __str__(self):
        return self.name

    def clean(self):
        """Barra o papel contraditório na origem — ver
        `rbac.validate_scope_for_role` para o porquê de não corrigir isso
        silenciosamente na leitura."""
        from django.core.exceptions import ValidationError

        desconhecidas = set(self.permissions or []) - set(rbac.Perm.values)
        if desconhecidas:
            raise ValidationError(
                {"permissions": f"Permissões desconhecidas: {sorted(desconhecidas)}"}
            )
        erro = rbac.validate_scope_for_role(self.ticket_scope, self.permissions or [])
        if erro:
            raise ValidationError({"ticket_scope": erro})


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("E-mail é obrigatório")
        user = self.model(email=self.normalize_email(email), **extra_fields)
        if password:
            user.set_password(password)
        else:
            # internos autenticam por Google OAuth; sem senha utilizável
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("kind", UserKind.INTERNAL)
        extra_fields.setdefault("internal_role", InternalRole.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("full_name", email.split("@")[0])
        return self.create_user(email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=150)
    kind = models.CharField(max_length=10, choices=UserKind.choices)

    # --- internos ---
    internal_role = models.CharField(
        max_length=12, choices=InternalRole.choices, null=True, blank=True
    )
    google_sub = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        help_text="`sub` do token Google — identidade estável no SSO.",
    )
    # N:N de propósito: o mesmo agente pode atender Design e Suporte nível 2.
    # A lotação única (`User.team`) morreu na fusão — ela e os vínculos do
    # antigo departamento diziam a mesma coisa com respostas diferentes.
    teams = models.ManyToManyField(
        Team,
        through="AgentTeam",
        related_name="agents",
        blank=True,
    )

    # --- papel personalizado e escopo (RBAC) ---
    # Quando preenchido, SUBSTITUI as permissões do `internal_role` — o papel
    # embutido continua valendo como identidade base. Ver `CustomRole`.
    custom_role = models.ForeignKey(
        "CustomRole",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="users",
    )
    # Escopo de leitura da fila DESTA pessoa. Vazio = herda do papel — é o
    # normal; preencher é a exceção ("este agente vê tudo", "aquele só o que
    # está com ele"). Precedência completa em `rbac.ticket_scope_for`.
    ticket_scope = models.CharField(
        max_length=10, choices=rbac.TicketScope.choices, blank=True, default=""
    )

    # --- clientes ---
    company = models.ForeignKey(
        "customers.Company",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )
    client_role = models.CharField(
        max_length=10, choices=ClientRole.choices, null=True, blank=True
    )

    job_title = models.CharField(max_length=100, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    # segundo contato — nunca some o primeiro por "trocar de número", e cobre
    # o caso comum de fixo + celular/WhatsApp. Cadastro de cliente exige pelo
    # menos UM dos dois preenchido (ver `UserAdminSerializer.validate`); nenhum
    # dos dois é obrigatório sozinho, então os dois seguem `blank=True` aqui.
    phone_secondary = models.CharField(max_length=32, blank=True)
    # CharField e não URLField: além de um endereço externo, o valor pode ser
    # um dos avatares prontos (`/avatars/03.svg`) ou o que a pessoa enviou
    # (`/api/v1/avatars/<nome>.png`) — ambos relativos. Ver accounts/avatars.py.
    avatar_url = models.CharField(max_length=300, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    # Nasceu se identificando no chat público do site do cliente (modo
    # público do embed, apps/customers/embed_views.py), não de um convite.
    # Existe por dois motivos, os dois de honestidade da tela: a listagem de
    # usuários da empresa precisa dizer que aquilo é um visitante e não um
    # acesso ao portal que alguém cadastrou, e o status de convite ("pendente"
    # = tem conta mas nunca definiu senha) seria mentira aqui — visitante NÃO
    # tem convite nenhum em aberto. Sem senha utilizável e fora do
    # "Esqueci minha senha" (apps/accounts/recuperacao.py recusa visitante),
    # ele não entra no portal por caminho nenhum enquanto um admin ou o
    # responsável da empresa não o convidar de verdade.
    is_widget_visitor = models.BooleanField(default=False)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    anonymized_at = models.DateTimeField(null=True, blank=True)  # LGPD (D11)

    # --- preferências da própria conta (Lacuna 5) ---
    # Editáveis pelo próprio usuário em "Minha conta", nunca pela admin global.
    # Assinatura do rodapé das respostas, em uma de três formas — ver
    # `apps/accounts/assinatura.py`, que é quem higieniza e renderiza. O campo
    # `signature` (texto puro) é o mais antigo dos três e continua sendo o
    # conteúdo da forma "texto"; `signature_kind` vazio = sem assinatura.
    signature = models.TextField(blank=True)
    signature_kind = models.CharField(
        max_length=10, blank=True, default="", choices=assinatura.FORMAS
    )
    signature_html = models.TextField(blank=True)
    signature_image_url = models.CharField(max_length=300, blank=True)
    ui_language = models.CharField(max_length=10, default="pt-br")
    # Altura da linha nas listagens. VAZIO É "automático", e não um esquecimento:
    # quem atende vive na fila e precisa comparar vários chamados de uma vez
    # (compacto); quem é cliente tem meia dúzia e lê um por um (confortável).
    # Um padrão único erraria com metade das pessoas — a resolução fica no
    # front, que é quem conhece a espécie de quem está olhando.
    ui_density = models.CharField(
        max_length=12, blank=True, default="",
        choices=[("", "Automático"), ("comfortable", "Confortável"), ("compact", "Compacto")],
    )
    # Expediente pessoal, quando difere do horário geral — base do status
    # "disponível para chat". Vazio/desabilitado = segue o calendário da empresa.
    # Forma: {"enabled": bool, "start": "09:00", "end": "18:00", "days": [1..7]}
    personal_hours = models.JSONField(default=dict, blank=True)

    # --- conforto de quem usa o produto o dia inteiro ---
    # Moram na conta, e não só no navegador, pelo mesmo motivo de
    # `ui_density`: quem precisa de texto maior precisa dele no notebook de
    # casa também, e quem silenciou o bipe não quer ouvi-lo de novo porque
    # trocou de computador. O navegador guarda uma cópia (stores/prefs.ts)
    # só para a primeira pintura não sair no tamanho errado.
    #
    # Tamanho do texto: VAZIO é o padrão do produto (a escala 12/14/16/28);
    # os outros dois multiplicam essa escala no front (ver
    # frontend/postcss-escala-texto.js). O fator mora lá, não aqui: é
    # decisão de desenho, e o servidor só precisa lembrar a escolha.
    ui_text_size = models.CharField(
        max_length=10, blank=True, default="",
        choices=[("", "Padrão"), ("large", "Grande"), ("larger", "Maior")],
    )
    # Bipe dos avisos (frontend/src/realtime/avisos.ts). Só o SOM: o título
    # da aba e a notificação do sistema continuam valendo com ele desligado.
    notification_sound = models.BooleanField(default=True)
    # Minutos sem mexer no Resolv até o status virar "Ausente" sozinho — só
    # para quem estava "Disponível", e só o próprio front desfaz (na próxima
    # atividade). 0 = nunca. Os valores são fechados porque a tela é um
    # seletor, e um número livre ("7 minutos") não ajuda ninguém a decidir.
    auto_away_minutes = models.PositiveSmallIntegerField(
        default=15,
        choices=[(0, "Nunca"), (5, "5 minutos"), (10, "10 minutos"),
                 (15, "15 minutos"), (30, "30 minutos")],
    )

    # --- verificação em duas etapas ---
    # Vazio = desligada. O método só é gravado depois que o usuário confirma
    # um código válido (ver TwoFactorConfirmView) — nunca fica "meio ativado".
    two_factor_method = models.CharField(
        max_length=10, choices=TwoFactorMethod.choices, blank=True, default=""
    )
    totp_secret = models.CharField(max_length=64, blank=True, default="")

    # Só tem sentido pra interno — cliente nunca mostra isto em lugar
    # nenhum da tela — mas mora em User (não num model à parte) pelo mesmo
    # motivo de two_factor_method: um valor por conta, sem tabela auxiliar
    # pra um único campo. Ver PresenceStatus.
    presence = models.CharField(
        max_length=10, choices=PresenceStatus.choices, default=PresenceStatus.OFFLINE
    )

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        verbose_name = "usuário"
        constraints = [
            models.CheckConstraint(
                name="client_requires_company",
                condition=~Q(kind="client")
                | (Q(company__isnull=False) & Q(internal_role__isnull=True)),
            ),
            models.CheckConstraint(
                name="internal_requires_role",
                condition=~Q(kind="internal")
                | (Q(company__isnull=True) & Q(internal_role__isnull=False)),
            ),
        ]

    def __str__(self):
        return f"{self.full_name} <{self.email}>"

    def set_password(self, raw_password):
        """Marca a troca para o receiver de `post_save` registrar no histórico
        de acesso (AccessEvent). Hooking aqui, e não em cada view, garante que
        QUALQUER caminho futuro de troca de senha entra na trilha — inclusive
        o define-senha do convite quando existir. `set_unusable_password` fica
        de fora de propósito: é rotina de criação, não uma troca do usuário.
        """
        super().set_password(raw_password)
        self._password_was_set = True

    # atalhos usados pelas policies e pelo TicketQuerySet
    @property
    def is_internal(self) -> bool:
        return self.kind == UserKind.INTERNAL

    @property
    def is_admin(self) -> bool:
        return self.internal_role == InternalRole.ADMIN

    @property
    def is_supervisor(self) -> bool:
        return self.internal_role == InternalRole.SUPERVISOR

    @property
    def is_light_agent(self) -> bool:
        return self.internal_role == InternalRole.LIGHT_AGENT

    # --- RBAC: a porta de entrada para "pode?" em todo o sistema -----------

    def can(self, perm: str) -> bool:
        """`user.can(Perm.TICKET_REPLY_PUBLIC)` — a pergunta que views,
        serializers, services e templates fazem. Nunca teste papel na mão:
        um papel personalizado quebraria o teste, e é justamente para isso
        que ele existe."""
        return rbac.can(self, perm)

    @property
    def permissions(self) -> frozenset[str]:
        """Conjunto efetivo — é o que `/auth/me/` devolve para o front."""
        return rbac.permissions_for(self)

    @property
    def effective_ticket_scope(self) -> str:
        """Recorte da fila aplicado por `Ticket.objects.visible_to`."""
        return rbac.ticket_scope_for(self)


class AgentTeam(models.Model):
    """Equipes que um usuário interno atende.

    Governa a visibilidade interna (D1): agente/supervisor só enxerga tickets
    das equipes em que tem vínculo. Admin ignora esta tabela.
    """

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="team_links")
    team = models.ForeignKey(Team, on_delete=models.CASCADE, related_name="agent_links")
    is_default = models.BooleanField(
        default=False, help_text="Equipe pré-selecionada nas telas do agente."
    )

    class Meta:
        verbose_name = "vínculo agente–equipe"
        verbose_name_plural = "vínculos agente–equipe"
        constraints = [
            models.UniqueConstraint(fields=["user", "team"], name="uniq_agent_team")
        ]

    def __str__(self):
        return f"{self.user_id} → {self.team_id}"


class LoginCode(models.Model):
    """Código de uso único enviado por e-mail (verificação em duas etapas).

    O código fica em claro no banco de propósito: vale 10 minutos, é de uso
    único e trava após 5 erros — hasheá-lo só dificultaria o suporte sem
    mudar o risco real (quem lê esta tabela já lê a sessão do usuário).
    """

    class Purpose(models.TextChoices):
        LOGIN = "login", "Entrar"
        SETUP = "setup", "Ativar verificação"
        DISABLE = "disable", "Desativar verificação"

    VALIDITY_MINUTES = 10
    MAX_ATTEMPTS = 5

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_codes")
    code = models.CharField(max_length=6)
    purpose = models.CharField(
        max_length=10, choices=Purpose.choices, default=Purpose.LOGIN
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        verbose_name = "código de verificação"
        verbose_name_plural = "códigos de verificação"
        indexes = [models.Index(fields=["user", "purpose", "-created_at"])]

    def __str__(self):
        return f"{self.user_id} ({self.purpose})"

    @classmethod
    def issue(cls, user, purpose) -> "LoginCode":
        """Emite um código novo e mata os anteriores não usados do mesmo
        propósito — só o último e-mail recebido vale."""
        cls.objects.filter(
            user=user, purpose=purpose, used_at__isnull=True
        ).delete()
        return cls.objects.create(
            user=user,
            purpose=purpose,
            code=f"{secrets.randbelow(1_000_000):06d}",
            expires_at=timezone.now() + dt.timedelta(minutes=cls.VALIDITY_MINUTES),
        )

    @classmethod
    def redeem(cls, user, purpose, code: str) -> bool:
        """Confere e consome o código vigente. Cada erro conta; no 5º o código
        morre — reemitir é o único caminho, o que barra força bruta."""
        vigente = (
            cls.objects.filter(
                user=user, purpose=purpose, used_at__isnull=True,
                expires_at__gte=timezone.now(), attempts__lt=cls.MAX_ATTEMPTS,
            )
            .order_by("-created_at")
            .first()
        )
        if vigente is None:
            return False
        vigente.attempts += 1
        if secrets.compare_digest(vigente.code, str(code).strip()):
            vigente.used_at = timezone.now()
            vigente.save(update_fields=["attempts", "used_at"])
            return True
        vigente.save(update_fields=["attempts"])
        return False


class AccessEventKind(models.TextChoices):
    LOGIN = "login", "Login"
    LOGIN_FAILED = "login_failed", "Login falhou"
    PASSWORD_CHANGED = "password_changed", "Senha alterada"
    TWOFA_ENABLED = "twofa_enabled", "Verificação em duas etapas ativada"
    TWOFA_DISABLED = "twofa_disabled", "Verificação em duas etapas desativada"


class AccessEvent(models.Model):
    """Histórico de acesso por usuário — a tela do admin em Configurações.

    Complementa o AuditLog, não o substitui: aqui entra o que interessa numa
    investigação de conta (logins, tentativas erradas, troca de senha, 2FA),
    indexado por usuário para a consulta que a tela faz.
    """

    user = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="access_events"
    )
    kind = models.CharField(max_length=20, choices=AccessEventKind.choices)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "evento de acesso"
        verbose_name_plural = "eventos de acesso"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self):
        return f"{self.kind} — {self.user_id}"
