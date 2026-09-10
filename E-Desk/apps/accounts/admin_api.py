"""Gestão de usuários e equipes pela API.

Cliente **não se auto-cadastra** (mesma regra do allauth): o admin cria o
usuário e o sistema envia um convite para definir a senha. Usuário interno
nasce sem senha utilizável — entra por Google Workspace.

**Duas naturezas de pessoa, nunca na mesma listagem.** O agente pertence a N
equipes e é gerenciado em "Equipes e agentes" (`roster` + `agents` aqui); o
usuário de cliente pertence a UMA empresa e é gerenciado dentro da tela dela
(`settings/companies/<id>/users/`, em customers/admin_api.py). Havia uma tela
global misturando as duas com uma coluna "tipo" — quem administra nunca pensa
"quero ver pessoas", pensa "quero ver a equipe X" ou "os usuários da empresa Y".
O endpoint plano (`settings/users/`) continua existindo para a busca por nome e
para o detalhe de uma pessoa já conhecida, não como listagem de trabalho.
"""

import secrets
from collections import defaultdict

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.accounts import avatars, rbac
from apps.accounts.models import (
    AccessEventKind,
    AgentTeam,
    ClientRole,
    CustomRole,
    InternalRole,
    Team,
    User,
    UserKind,
)
from apps.accounts.sessions import access_history_payload, live_sessions
from apps.accounts.signals import record_access_event
from apps.audit.models import AuditAction, AuditLog
from apps.core.permissions import HasPerm, IsAdmin, IsInternalReadAdminWrite
from apps.core.serializer_fields import slug_unico
from apps.core.slugs import unique_slug
from apps.notifications.services import queue_email


def login_por_google_ativo() -> bool:
    """O Google Workspace está mesmo ligado nesta instalação?

    Interno "entra por Google" era premissa do código, não fato da
    configuração: com o allauth comentado (o estado atual), quem era criado
    como agente ficava sem senha utilizável E sem Google — trancado para fora
    do sistema, sem nenhuma tela dizer isso a quem o cadastrou. Perguntar às
    settings em vez de supor é o que faz o convite chegar a quem precisa dele.
    """
    return any(
        "allauth" in backend for backend in settings.AUTHENTICATION_BACKENDS
    )


def precisa_de_convite(user) -> bool:
    """Quem depende de senha para entrar precisa do link para defini-la.

    Cliente sempre. Interno quando o Google não está ligado — que é
    exatamente quando ele também entra por e-mail e senha.
    """
    return user.kind == UserKind.CLIENT or not login_por_google_ativo()


def send_invite(user) -> None:
    """Convite de definição de senha.

    Módulo-nível porque quem cria usuário de cliente é a tela da EMPRESA
    (customers/admin_api.py) e não só esta — o texto e o link do convite
    precisam ser os mesmos vindo de onde vierem.
    """
    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    queue_email(
        to=user.email,
        subject="Seu acesso ao suporte",
        template="invite",
        context={
            "full_name": user.full_name,
            "company": user.company.name if user.company else "",
            # absoluta: o link viaja por e-mail (relativo não é clicável lá)
            "link": f"{settings.SITE_URL}/portal/definir-senha/{uid}/{token}/",
        },
        dedupe_key=f"invite-{user.pk}-{secrets.token_hex(4)}",
    )


class TeamAdminSerializer(serializers.ModelSerializer):
    slug = slug_unico(Team, o_que="uma equipe")
    """Equipe inteira, como a tela de configuração a edita.

    Depois da fusão com o antigo departamento havia dois endpoints de admin
    para o MESMO registro — um cuidava de supervisor e nome, outro de
    visibilidade e e-mail de notificação. Duas telas gravando metade de uma
    coisa é como se perde a outra metade sem ninguém perceber; ficou um só.
    """

    # contagens por annotate na view: um GROUP BY, não um COUNT por linha
    agent_count = serializers.IntegerField(read_only=True)
    ticket_count = serializers.IntegerField(read_only=True)
    supervisor_name = serializers.CharField(
        source="supervisor.full_name", read_only=True, default=None
    )
    # o admin cadastra só o nome; o slug é identidade interna, derivada
    slug = serializers.SlugField(required=False)

    class Meta:
        model = Team
        fields = [
            "id", "name", "slug", "is_active", "order",
            "supervisor", "supervisor_name",
            "visibility", "mask_subject_for_others", "internal_only",
            "chat_calendar", "notification_email", "description",
            "agent_count", "ticket_count",
        ]


class TeamAdminViewSet(viewsets.ModelViewSet):
    queryset = (
        Team.objects.select_related("supervisor")
        .annotate(
            agent_count=Count("agent_links", distinct=True),
            ticket_count=Count("tickets", distinct=True),
        )
        .order_by("order", "name")
    )
    serializer_class = TeamAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def perform_create(self, serializer):
        slug = serializer.validated_data.get("slug") or unique_slug(
            Team, serializer.validated_data["name"], fallback="equipe"
        )
        serializer.save(slug=slug)

    def perform_destroy(self, instance):
        # Equipe com ticket ou com gente dentro não some: desativa. O histórico
        # é dela — e `Ticket.team` é PROTECT, então apagar de verdade nem
        # chegaria ao banco; melhor a intenção explícita do que um 500.
        # A lotação FICA: quem atende a equipe continua atendendo se ela voltar,
        # e limpar os vínculos aqui desfaria em silêncio a visibilidade de todo
        # mundo — um efeito que ninguém pediu ao clicar em "desativar".
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=False, methods=["get"], url_path="roster")
    def roster(self, request):
        """A tela "Equipes e agentes" inteira numa resposta: cada equipe com
        quem a atende, mais o grupo `unassigned`.

        O agrupamento é do servidor de propósito. Um agente aparece em TODAS as
        equipes que atende (o vínculo é N:N e é o mesmo registro nas duas), e
        quem não tem vínculo nenhum tem que aparecer em algum lugar — senão
        some da administração justamente no estado em que não enxerga ticket
        algum. Deixar essa aritmética no frontend é convidar cada tela a
        inventar a sua.
        """
        agents = (
            User.objects.filter(kind=UserKind.INTERNAL)
            .prefetch_related("team_links")
            .order_by("full_name")
        )
        por_equipe: dict[int, list[User]] = defaultdict(list)
        sem_equipe: list[User] = []
        for agent in agents:
            links = list(agent.team_links.all())
            if not links:
                sem_equipe.append(agent)
            for link in links:
                por_equipe[link.team_id].append(agent)

        equipes = TeamAdminSerializer(
            self.filter_queryset(self.get_queryset()), many=True
        ).data
        for equipe in equipes:
            equipe["agents"] = UserAdminSerializer(
                por_equipe.get(equipe["id"], []), many=True
            ).data
        return Response({
            "teams": equipes,
            "unassigned": UserAdminSerializer(sem_equipe, many=True).data,
        })

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin],
            url_path="agents")
    def add_agent(self, request, pk=None):
        """Põe um agente nesta equipe: cria um novo já lotado aqui, ou vincula
        um que já existe.

        Os dois caminhos moram no mesmo lugar porque, de dentro da equipe, são
        a mesma intenção — "quero mais gente aqui". `user` no corpo escolhe o
        segundo caminho; qualquer outra coisa cria.
        """
        team = self.get_object()

        if (user_id := request.data.get("user")) not in (None, ""):
            agent = User.objects.filter(pk=user_id).first()
            if agent is None:
                raise ValidationError({"user": "Usuário não encontrado."})
            if not agent.is_internal:
                raise ValidationError(
                    {"user": "Usuário de cliente não entra em equipe de atendimento."}
                )
        else:
            serializer = UserAdminSerializer(data={
                **request.data,
                "kind": UserKind.INTERNAL,
                "company": None,
                "internal_role": request.data.get("internal_role")
                or InternalRole.AGENT,
            })
            serializer.is_valid(raise_exception=True)
            agent = serializer.save()
            # nunca nasce com senha utilizável — e é POR ISSO que o convite
            # precisa sair daqui também. Este caminho de criação (o "+ Adicionar
            # agente" da equipe) é o mais usado dos dois e era o que não
            # convidava ninguém: o agente aparecia na lista, com cara de pronto,
            # e não tinha como entrar.
            agent.set_unusable_password()
            agent.save(update_fields=["password"])
            if precisa_de_convite(agent):
                send_invite(agent)

        AgentTeam.objects.get_or_create(user=agent, team=team)
        agent = (
            User.objects.prefetch_related("team_links").get(pk=agent.pk)
        )
        return Response(UserAdminSerializer(agent).data, status=201)


class UserAdminSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(
        source="company.name", read_only=True, default=None
    )
    # As equipes do interno saem SEMPRE como lista: a lotação única (`team`)
    # deixou de existir na fusão, e um agente pode atender várias. Escrita é
    # pela ação `PUT settings/users/<id>/teams/`, não por este serializer —
    # gravar vínculo de visibilidade junto com nome e telefone esconderia a
    # decisão mais sensível da tela no meio de um formulário de cadastro.
    team_ids = serializers.SerializerMethodField()
    # Estado do convite, derivado — não há coluna para ele. Cliente nasce sem
    # senha utilizável e só ganha uma ao abrir o link do convite; então "tem
    # senha" É "aceitou o convite", sem uma flag paralela para dessincronizar.
    invite_status = serializers.SerializerMethodField()
    # Mesma trava do self-service (`ProfileUpdateSerializer.avatar_url`,
    # apps/accounts/views.py): só os prontos, o que o upload gravou, ou uma
    # URL https — nunca `javascript:`/travessia de diretório. Repetida aqui
    # (não importada como mixin) porque são dois serializers pequenos e a
    # regra é uma função pura de duas linhas — herança seria mais cerimônia
    # que a duplicação que evita.
    avatar_url = serializers.CharField(required=False, allow_blank=True, max_length=300)

    class Meta:
        model = User
        fields = [
            "id", "email", "full_name", "kind", "internal_role", "client_role",
            "company", "company_name", "job_title", "phone", "phone_secondary",
            "is_active", "last_login", "last_seen_at", "anonymized_at",
            "invite_status", "team_ids", "two_factor_method", "avatar_url",
            # RBAC: papel personalizado e escopo por pessoa (ver rbac.py).
            "custom_role", "custom_role_name", "ticket_scope",
        ]
        read_only_fields = [
            "last_login", "last_seen_at", "anonymized_at",
            # só a ação `reset-2fa` muda isto — PATCH genérico deixaria um
            # admin "ativar" 2FA de outra pessoa sem ela nunca ter confirmado
            # um código (o mesmo cuidado que travou subject_user/kind em
            # DataSubjectRequest depois de verificado, ver GAPS.md, Auditoria).
            "two_factor_method",
        ]

    custom_role_name = serializers.CharField(
        source="custom_role.name", read_only=True, default=None
    )

    def get_team_ids(self, obj) -> list[int]:
        # lê o prefetch da view (team_links) em vez de uma query por linha
        return [link.team_id for link in obj.team_links.all()]

    def get_invite_status(self, obj) -> str:
        """`pendente` | `aceito` | `` (só quem entra por Google fica sem status).

        Vale para o AGENTE também: enquanto ele não abre o convite não tem
        senha, e "pendente" na lista é o que avisa o admin de que aquela conta
        ainda não consegue entrar. Sem isso, um agente trancado para fora
        parecia idêntico a um agente ativo.
        """
        if not precisa_de_convite(obj):
            return ""
        return "aceito" if obj.has_usable_password() else "pendente"

    def validate_avatar_url(self, value):
        if not avatars.aceitavel(value):
            raise ValidationError(
                "Escolha um dos avatares, envie uma imagem ou informe um endereço https."
            )
        return value

    def validate(self, data):
        """Espelha as CheckConstraints do banco, para o erro sair legível
        em vez de estourar como IntegrityError."""
        kind = data.get("kind", getattr(self.instance, "kind", None))
        company = data.get("company", getattr(self.instance, "company", None))
        role = data.get("internal_role", getattr(self.instance, "internal_role", None))

        if kind == UserKind.CLIENT:
            if not company:
                raise ValidationError({"company": "Usuário cliente exige uma empresa."})
            if role:
                raise ValidationError(
                    {"internal_role": "Usuário cliente não tem papel interno."}
                )
            # nome e e-mail já são obrigatórios pelo model (sem blank=True);
            # telefone é o único dos três livre — e cadastro de cliente exige
            # PELO MENOS UM contato por telefone. Nenhum dos dois campos é
            # obrigatório sozinho: são dois lugares para o mesmo requisito.
            phone = data.get("phone", getattr(self.instance, "phone", ""))
            phone_2 = data.get(
                "phone_secondary", getattr(self.instance, "phone_secondary", "")
            )
            if not phone.strip() and not phone_2.strip():
                raise ValidationError(
                    {"phone": "Informe ao menos um telefone."}
                )
        elif kind == UserKind.INTERNAL:
            if company:
                raise ValidationError(
                    {"company": "Usuário interno não pertence a uma empresa cliente."}
                )
            if not role:
                raise ValidationError({"internal_role": "Papel interno é obrigatório."})

        # RBAC: escopo "apenas atribuídos a ele" num papel que não pode ser
        # atribuído dá uma fila SEMPRE VAZIA. O erro precisa sair aqui, onde
        # um humano escolheu as duas coisas — nunca ser corrigido em silêncio
        # na leitura (ver `rbac.validate_scope_for_role`).
        escopo = data.get("ticket_scope", getattr(self.instance, "ticket_scope", ""))
        if escopo:
            custom = data.get("custom_role", getattr(self.instance, "custom_role", None))
            perms = (
                set(custom.permissions or [])
                if custom is not None and custom.is_active
                else rbac.ROLE_PERMISSIONS.get(role, frozenset())
            )
            erro = rbac.validate_scope_for_role(escopo, perms)
            if erro:
                raise ValidationError({"ticket_scope": erro})
        return data


class UserAdminViewSet(viewsets.ModelViewSet):
    serializer_class = UserAdminSerializer
    permission_classes = [IsInternalReadAdminWrite]

    def get_queryset(self):
        # prefetch de team_links: os ids do agente saem sem uma query por linha
        qs = (
            User.objects.select_related("company")
            .prefetch_related("team_links")
            .order_by("full_name")
        )
        if kind := self.request.query_params.get("kind"):
            qs = qs.filter(kind=kind)
        if company := self.request.query_params.get("company"):
            qs = qs.filter(company_id=company)
        if self.request.query_params.get("active") == "1":
            qs = qs.filter(is_active=True)
        # `?search=`: a busca "Buscar pessoa". É a única listagem global que
        # sobrou depois que agente e usuário de cliente ganharam cada um a sua
        # tela — serve para achar quem se conhece pelo nome, não para navegar.
        if termo := self.request.query_params.get("search", "").strip():
            qs = qs.filter(
                Q(full_name__icontains=termo) | Q(email__icontains=termo)
            )
        return qs

    def perform_create(self, serializer):
        user = serializer.save()
        # nasce sem senha utilizável; o convite é o único caminho para ganhar
        # uma — e ele vai para o INTERNO também quando o Google está desligado,
        # senão o agente recém-criado não teria porta nenhuma de entrada
        user.set_unusable_password()
        user.save(update_fields=["password"])
        if precisa_de_convite(user):
            send_invite(user)

    def perform_destroy(self, instance):
        # D11: nada é hard-deleted
        instance.is_active = False
        instance.save(update_fields=["is_active"])

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def invite(self, request, pk=None):
        """(Re)envia o convite de definição de senha.

        Reenviar é a saída quando o primeiro e-mail se perdeu ou o link
        venceu — e vale para o interno também, sempre que ele depende de senha
        para entrar.
        """
        user = self.get_object()
        if not precisa_de_convite(user):
            raise ValidationError(
                {"detail": "Este usuário entra pelo Google; não há senha a definir."}
            )
        send_invite(user)
        return Response({"invited": user.email})

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin],
            url_path="reset-2fa")
    def reset_2fa(self, request, pk=None):
        """Zera o segundo fator desta pessoa, sem pedir o código dela.

        O autoatendimento (Minha conta > Segurança) SEMPRE exige um código
        válido pra desativar — de propósito, para provar posse do fator
        (`TwoFactorDisableView`). Isso destranca quem ainda tem o fator; quem
        PERDEU o app autenticador ou não recebe mais o e-mail fica sem saída
        nenhuma — não existia endpoint nenhum pra isso até aqui (achado
        construindo Minha conta, ver GAPS.md). Este é o atalho de admin: o
        próprio acesso administrativo já é a prova de identidade.
        """
        user = self.get_object()
        if not user.two_factor_method:
            raise ValidationError(
                {"detail": "Este usuário já está sem verificação em duas etapas."}
            )
        user.two_factor_method = ""
        user.totp_secret = ""
        user.save(update_fields=["two_factor_method", "totp_secret"])

        AuditLog.objects.create(
            actor=request.user,
            action=AuditAction.CONFIG_CHANGE,
            content_type=ContentType.objects.get_for_model(User),
            object_id=str(user.pk),
            summary=f"Verificação em duas etapas resetada por um admin ({user.email})",
        )
        # o evento é DESTA conta (pra aparecer no histórico dela), mas sem
        # request: o IP/dispositivo aqui seriam os do ADMIN, não os de uma
        # sessão da própria pessoa — atribuir a rede de quem clicou ao
        # histórico de quem foi afetado misrepresentaria de onde veio.
        record_access_event(user, AccessEventKind.TWOFA_DISABLED)

        # quem foi afetado precisa saber — se ninguém pediu isso, é a
        # primeira pista de que a conta de alguém (o admin ou a pessoa) foi
        # comprometida.
        queue_email(
            to=user.email,
            subject="Verificação em duas etapas desativada por um administrador",
            template="twofa_reset_by_admin",
            context={"full_name": user.full_name, "email": user.email},
        )
        return Response({"method": ""})

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin],
            url_path="reset-password")
    def reset_password(self, request, pk=None):
        """Define uma senha temporária nova para esta pessoa, sem pedir a
        senha atual.

        Caso de uso real: cliente esquece a senha e liga pedindo pro
        atendimento trocar. O autoatendimento não tem "esqueci minha senha"
        nenhum (`accountApi` não expõe troca de senha — não existe self-
        service pra isso, ver GAPS.md), e a única porta administrativa que já
        existia (reenviar o CONVITE, `invite` acima) resolve um problema
        DIFERENTE: manda um e-mail com link pra pessoa escolher a própria
        senha — útil pra quem nunca acessou, mas exige e-mail acessível
        naquele instante, e não serve pro atendimento por telefone/chat que
        precisa resolver na hora. Este endpoint é direto: o admin aciona, o
        sistema já troca, sem passar por caixa de entrada nenhuma.

        Mesmo espírito do `reset_2fa`: o próprio acesso administrativo já é
        a prova de identidade exigida — ninguém confirma a senha antiga pra
        autorizar isto. A senha nova é sorteada AQUI (nunca escolhida pelo
        admin, pra não virar "123456" na pressa de um atendimento) e
        devolvida só UMA vez na resposta; quem chamou repassa ao usuário
        diretamente. O e-mail de aviso abaixo conta que a senha MUDOU, nunca
        qual é a nova — e-mail não é canal confiável pra carregar um segredo.
        """
        user = self.get_object()
        if not precisa_de_convite(user):
            raise ValidationError(
                {"detail": "Este usuário entra pelo Google; não há senha para redefinir."}
            )

        nova_senha = secrets.token_urlsafe(9)
        try:
            validate_password(nova_senha, user)
        except DjangoValidationError:
            # praticamente nunca acontece (senha aleatória contra os
            # validators configurados) — um segundo sorteio mais longo é
            # mais barato que deixar a exceção subir crua pra quem chamou
            nova_senha = secrets.token_urlsafe(12)
            validate_password(nova_senha, user)

        user.set_password(nova_senha)
        user.save(update_fields=["password"])

        AuditLog.objects.create(
            actor=request.user,
            action=AuditAction.CONFIG_CHANGE,
            content_type=ContentType.objects.get_for_model(User),
            object_id=str(user.pk),
            summary=f"Senha redefinida por um admin ({user.email})",
        )
        # mesmo raciocínio do reset_2fa: o evento é DESTA conta (aparece no
        # histórico dela), mas sem request — IP/dispositivo aqui seriam os
        # do ADMIN, não os de uma sessão da própria pessoa.
        record_access_event(user, AccessEventKind.PASSWORD_CHANGED)

        queue_email(
            to=user.email,
            subject="Sua senha foi redefinida por um administrador",
            template="password_reset_by_admin",
            context={"full_name": user.full_name, "email": user.email},
        )
        return Response({"password": nova_senha})

    @extend_schema(request=None, responses=UserAdminSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin],
            parser_classes=[MultiPartParser], url_path="avatar")
    def upload_avatar(self, request, pk=None):
        """Envia um arquivo como avatar de OUTRA pessoa — o gêmeo admin de
        `POST me/avatar/` (`AvatarUploadView`), pro caso comum de alguém
        pedir ajuda pra trocar a própria foto por telefone/chat.

        Preset e URL externa não precisam de ação própria: `avatar_url` virou
        campo comum do serializer (abaixo), então `PATCH settings/users/<id>/`
        já resolve os dois — só upload de ARQUIVO exige multipart, por isso
        só ele ganha uma ação dedicada.
        """
        user = self.get_object()
        enviado = request.FILES.get("file")
        if enviado is None:
            raise ValidationError({"file": "Nenhum arquivo enviado."})
        try:
            url = avatars.guardar(user, enviado)
        except avatars.AvatarInvalido as exc:
            raise ValidationError({"file": str(exc)}) from exc
        user.avatar_url = url
        user.save(update_fields=["avatar_url"])
        return Response(self.get_serializer(user).data)

    @extend_schema(request=None, responses=UserAdminSerializer)
    @upload_avatar.mapping.delete
    def remove_avatar(self, request, pk=None):
        """Volta às iniciais — o gêmeo admin de `DELETE me/avatar/`."""
        user = self.get_object()
        avatars.apagar(user)
        user.avatar_url = ""
        user.save(update_fields=["avatar_url"])
        return Response(self.get_serializer(user).data)

    @action(detail=True, methods=["put"], permission_classes=[IsAdmin],
            url_path="teams")
    def set_teams(self, request, pk=None):
        """Vínculo agente↔equipe — é o que governa a visibilidade (D1)."""
        user = self.get_object()
        if not user.is_internal:
            raise ValidationError({"detail": "Apenas usuários internos têm equipes."})
        ids = request.data.get("team_ids", [])
        if not isinstance(ids, list):
            raise ValidationError({"team_ids": "Envie uma lista de ids."})

        current = set(user.team_links.values_list("team_id", flat=True))
        wanted = set(int(i) for i in ids)
        AgentTeam.objects.filter(
            user=user, team_id__in=current - wanted
        ).delete()
        for team_id in wanted - current:
            AgentTeam.objects.create(user=user, team_id=team_id)
        return Response({"team_ids": sorted(wanted)})

    @extend_schema(responses=OpenApiTypes.OBJECT)
    @action(detail=True, methods=["get"], permission_classes=[IsAdmin],
            url_path="access-history")
    def access_history(self, request, pk=None):
        """Histórico de acesso do usuário: logins (inclusive falhos), troca de
        senha, 2FA e as sessões vivas agora.

        Três recortes da mesma consulta, porque o painel da pessoa tem duas
        abas com perguntas diferentes: `events` é a linha do tempo da conta
        (aba Histórico), `logins` são só as entradas — as últimas 20, com
        sucesso ou falha — e `sessions` é onde ela está logada AGORA (aba
        Acessos). Filtrar `events` no frontend daria menos de 20 logins sempre
        que houvesse troca de senha no meio.

        Só ADMIN, mesmo para leitura — mais restrito que o resto desta tela:
        IP e dispositivo de cada login é dado de investigação, não de
        operação, a mesma régua dos endpoints de auditoria.

        A forma da resposta (events/logins/sessions/session_limit) é
        compartilhada com o self-service (`GET me/access-history/`, ver
        `apps.accounts.sessions.access_history_payload`) — só muda de quem é
        a conta, nunca o que é perguntado dela.
        """
        user = self.get_object()
        return Response(
            access_history_payload(user, current_session_key=request.session.session_key)
        )

    @extend_schema(request=None, responses={204: None})
    @extend_schema(operation_id="v1_settings_users_sessions_revoke_all")
    @action(detail=True, methods=["delete"], permission_classes=[IsAdmin],
            url_path="sessions")
    def revoke_all_sessions(self, request, pk=None):
        """Derruba TODAS as sessões vivas desta pessoa.

        Existe pelo motivo pelo qual alguém abre esta aba: notebook perdido,
        desligamento, acesso suspeito. Encerrar uma por uma nesse momento é
        pedir para esquecer a que importava.
        """
        user = self.get_object()
        for row in live_sessions(user):
            Session.objects.filter(session_key=row["key"]).delete()
        return Response(status=204)

    @extend_schema(
        operation_id="v1_settings_users_sessions_revoke_one",
        request=None,
        responses={204: None},
        parameters=[OpenApiParameter(
            "key", str, OpenApiParameter.PATH,
            description="Chave da sessão (django_session.session_key).",
        )],
    )
    @action(detail=True, methods=["delete"], permission_classes=[IsAdmin],
            url_path=r"sessions/(?P<key>[^/.]+)")
    def revoke_session(self, request, pk=None, key=None):
        """Derruba UMA sessão desta pessoa.

        O gêmeo administrativo de `DELETE /me/sessions/<key>/`, que só encerra
        a do próprio usuário. A conferência de dono continua valendo aqui, ao
        contrário: a chave só é aceita se a sessão for mesmo de quem está na
        URL — sem isso, uma chave adivinhada derrubaria qualquer pessoa.
        """
        user = self.get_object()
        session = Session.objects.filter(
            session_key=key, expire_date__gte=timezone.now()
        ).first()
        if session is None or str(
            session.get_decoded().get("_auth_user_id")
        ) != str(user.pk):
            raise NotFound
        session.delete()
        return Response(status=204)


class RoleChoicesView(viewsets.ViewSet):
    """Choices para os selects das telas de configuração — evita duplicar
    rótulos no frontend e desalinhar do backend."""

    permission_classes = [IsInternalReadAdminWrite]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def list(self, request):
        return Response({
            "internal_roles": [
                {"value": v, "label": label} for v, label in InternalRole.choices
            ],
            "client_roles": [{"value": v, "label": label} for v, label in ClientRole.choices],
            "user_kinds": [{"value": v, "label": label} for v, label in UserKind.choices],
            # Catálogo de RBAC — a tela de papéis monta os checkboxes a partir
            # daqui, então uma permissão nova aparece sozinha, sem release de
            # front. `group` sai do prefixo do próprio valor (ver rbac.py).
            "permissions": rbac.permission_catalog(),
            "ticket_scopes": [
                {"value": v, "label": label} for v, label in rbac.TicketScope.choices
            ],
            # O que cada papel embutido pode — alimenta o "derivado de" da
            # tela de papel personalizado e a coluna de comparação.
            "role_permissions": {
                papel: sorted(perms) for papel, perms in rbac.ROLE_PERMISSIONS.items()
            },
            "role_default_scopes": dict(rbac.ROLE_DEFAULT_SCOPE),
        })


# --------------------------------------------------------------------------- #
# Papéis personalizados
# --------------------------------------------------------------------------- #

class CustomRoleSerializer(serializers.ModelSerializer):
    user_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = CustomRole
        fields = [
            "id", "name", "slug", "description", "base_role",
            "permissions", "ticket_scope", "is_active", "user_count",
        ]

    def validate_permissions(self, value):
        """Só valores do catálogo — um papel com permissão inventada seria
        uma concessão que nenhum código consome, e ninguém descobriria por
        quê a tela não liberou."""
        desconhecidas = set(value) - set(rbac.Perm.values)
        if desconhecidas:
            raise ValidationError(
                f"Permissões desconhecidas: {', '.join(sorted(desconhecidas))}"
            )
        return value

    def validate(self, attrs):
        """Barra a combinação que só se revelaria errada em produção, com
        alguém encarando uma fila vazia (ver `rbac.validate_scope_for_role`)."""
        escopo = attrs.get("ticket_scope", getattr(self.instance, "ticket_scope", ""))
        perms = attrs.get("permissions", getattr(self.instance, "permissions", []) or [])
        erro = rbac.validate_scope_for_role(escopo, perms)
        if erro:
            raise ValidationError({"ticket_scope": erro})
        return attrs


class CustomRoleViewSet(viewsets.ModelViewSet):
    """CRUD de papéis personalizados — a combinação de permissões do catálogo
    que um cliente monta quando os quatro papéis embutidos não bastam.

    `ROLE_MANAGE` e não `SETTINGS_MANAGE` de propósito: mexer em papel é
    escalonamento de privilégio (quem edita papel se auto-promove), então
    merece uma permissão própria, que hoje só o admin tem mas que fica
    separada para poder ser negada a um papel personalizado "quase admin".
    """

    serializer_class = CustomRoleSerializer
    permission_classes = [HasPerm.of(rbac.Perm.ROLE_MANAGE)]

    def get_queryset(self):
        return CustomRole.objects.annotate(user_count=Count("users")).order_by("name")

    def perform_destroy(self, instance):
        """Nunca apaga um papel em uso: os usuários cairiam no papel embutido
        em silêncio, ganhando ou perdendo acesso sem ninguém pedir. Desativar
        é a saída — e `is_active=False` já faz `permissions_for` voltar ao
        papel base, mas aí é uma decisão explícita e reversível."""
        if instance.users.exists():
            raise ValidationError(
                {"detail": (
                    f"{instance.users.count()} usuário(s) usam este papel. "
                    "Mova-os para outro papel antes de excluir, ou desative-o."
                )}
            )
        instance.delete()
