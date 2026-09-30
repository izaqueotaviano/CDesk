"""Autenticação de sessão para a SPA e diretório de usuários.

Em produção os internos entram por Google OAuth (allauth, /accounts/google/login/).
Este login por e-mail/senha é o caminho dos usuários CLIENTE — e serve ao
frontend de teste para entrar com qualquer perfil do seed de demonstração.
"""

import datetime as dt
import secrets

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.http import FileResponse
from django.utils import timezone
from django.utils.http import urlsafe_base64_decode
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView

from apps.accounts import assinatura, avatars, twofactor
from apps.accounts.models import (
    AccessEventKind,
    InternalRole,
    LoginCode,
    PresenceStatus,
    TwoFactorMethod,
    User,
    UserKind,
)
from apps.accounts.sessions import access_history_payload, live_sessions
from apps.accounts.signals import record_access_event
from apps.audit.models import AuditAction, AuditLog
from apps.customers.services import quota as quota_service
from apps.notifications.services import queue_email

# Preferências de conforto (models.User, bloco "conforto de quem usa o produto
# o dia inteiro"). Uma tupla só para leitura (`MeSerializer`) e escrita
# (`ProfileUpdateSerializer`): as duas listas já divergiram antes com
# `ui_density`, e um campo que se escreve mas não volta no `/auth/me/` faz a
# tela "desfazer" a escolha no próximo carregamento. A validação vem das
# `choices` do model — valor fora da lista é 400, sem código aqui.
CAMPOS_DE_CONFORTO = ("ui_text_size", "notification_sound", "auto_away_minutes")


class MeSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    plan_name = serializers.CharField(source="company.plan.name", read_only=True)
    is_internal = serializers.BooleanField(read_only=True)
    is_admin = serializers.BooleanField(read_only=True)
    teams = serializers.SerializerMethodField()
    # O front decide o que RENDERIZAR a partir daqui (esconder a aba de
    # resposta pública para um agente leve, por exemplo). Nunca é a
    # autorização de verdade — essa é sempre do backend; mandar a lista
    # evita só que a pessoa veja um botão que sempre daria 403.
    permissions = serializers.SerializerMethodField()
    ticket_scope = serializers.SerializerMethodField()
    signature_render = serializers.SerializerMethodField()
    custom_role_name = serializers.CharField(
        source="custom_role.name", read_only=True, default=None
    )

    class Meta:
        model = User
        fields = [
            "id", "email", "full_name", "kind", "internal_role", "client_role",
            "company", "company_name", "plan_name", "is_internal", "is_admin",
            "teams", "presence", "permissions", "ticket_scope", "custom_role_name",
            # preferências da própria conta
            "avatar_url", "job_title", "phone",
            "signature", "signature_kind", "signature_html", "signature_image_url",
            # a assinatura já montada (o mesmo HTML que o cliente vê): é o que
            # a prévia da tela mostra, e ele vem do servidor de propósito —
            # é o resultado DEPOIS da higienização, não o que foi digitado
            "signature_render",
            "ui_language", "ui_density", "personal_hours",
            # conforto (Minha conta → Aparência / Notificações / Status)
            *CAMPOS_DE_CONFORTO,
        ]

    def get_signature_render(self, obj) -> str:
        return assinatura.render_html(obj)

    def get_permissions(self, obj) -> list[str]:
        return sorted(obj.permissions)

    def get_ticket_scope(self, obj) -> str:
        """Vazio para cliente: `TicketScope` descreve recorte da FILA, que só
        existe do lado interno (ver o docstring do enum)."""
        return obj.effective_ticket_scope if obj.is_internal else ""

    def get_teams(self, obj) -> list[str]:
        if not obj.is_internal:
            return []
        return list(
            obj.team_links.select_related("team").values_list(
                "team__slug", flat=True
            )
        )


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "full_name", "email", "kind", "internal_role", "company", "presence"]


class LoginRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class LoginThrottle(AnonRateThrottle):
    scope = "login"


@extend_schema(request=LoginRequestSerializer, responses=MeSerializer)
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        email = request.data.get("email", "").strip().lower()
        # `request._request` (o HttpRequest), não o Request do DRF: o
        # django-axes anota o bloqueio como atributo do request que recebe, e
        # o middleware que transforma isso em 429 só enxerga o HttpRequest.
        # O `Request` do DRF repassa leituras ao original, mas guarda escritas
        # em si mesmo — a anotação se perderia.
        user = authenticate(
            request._request, username=email, password=request.data.get("password", "")
        )
        if user is None or not user.is_active:
            # tentativa contra conta EXISTENTE entra no histórico do admin,
            # mas a resposta é a mesma sempre — não confirma que o e-mail existe
            alvo = User.objects.filter(email=email).first()
            if alvo is not None:
                record_access_event(alvo, AccessEventKind.LOGIN_FAILED, request)
            return Response({"detail": "E-mail ou senha inválidos."}, status=400)

        # Conta sem verificação em duas etapas (e sem o admin exigi-la de
        # todos) entra aqui mesmo: a resposta já é o `Me`, como a do código.
        # Com verificação, a senha certa NÃO basta: quem configurou o
        # aplicativo usa o TOTP; e-mail recebe o código de 6 dígitos. O
        # pendente fica na sessão (server-side) e login() só acontece depois
        # do código — ver TwoFactorVerifyView.
        metodo = _metodo_efetivo(user)
        if not metodo:
            return _concluir_login(request, user)
        request.session[PENDING_2FA_KEY] = {
            "user": user.pk,
            "at": timezone.now().isoformat(),
            "attempts": 0,
        }
        if metodo == TwoFactorMethod.EMAIL:
            _enviar_codigo(user, LoginCode.Purpose.LOGIN)
        return Response({"two_factor": metodo})


def _limitar_sessoes(user, *, atual: str) -> None:
    """No máximo N sessões vivas por usuário: a mais antiga cai quando entra a
    N+1. Evita que a conta fique logada em dez lugares esquecidos.

    O login acabou de criar a sessão atual (com `started` carimbado pelo
    receiver de `user_logged_in`), então ela está entre as mantidas. Varre as
    sessões vivas decodificando o dono — é O(n) nas ativas, mas só no login.
    """
    limite = getattr(settings, "SESSION_MAX_PER_USER", 3)
    if not limite:
        return
    now = timezone.now()
    # todas as sessões vivas do usuário, MENOS a atual (ela é sempre mantida)
    outras = []
    for s in Session.objects.filter(expire_date__gte=now):
        if s.session_key == atual:
            continue
        data = s.get_decoded()
        if str(data.get("_auth_user_id")) == str(user.pk):
            outras.append((s, data.get("started") or ""))
    # mantém a atual + as (limite-1) outras mais recentes; o resto cai
    outras.sort(key=lambda par: par[1], reverse=True)
    for s, _ in outras[max(0, limite - 1):]:
        s.delete()


def _avisar_presenca(user) -> None:
    """Avisa todo agente conectado que o status de UM deles mudou.

    Reaproveita o grupo `chat_agentes` que `ws/me/` já usa pra fila de chat
    (`UserConsumer`, apps/chat/consumers.py) — sem WebSocket novo, sem grupo
    novo. Import local (não no topo do módulo) pelo mesmo motivo de
    `UserConsumer.connect()`: accounts não depende de chat em nível de
    módulo, só neste ponto de uso.
    """
    from asgiref.sync import async_to_sync
    from channels.layers import get_channel_layer

    from apps.chat.services.chat_service import GRUPO_AGENTES

    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        GRUPO_AGENTES,
        {"type": "agent.presence", "user_id": user.pk, "presence": user.presence},
    )


@extend_schema(request=None, responses={204: None})
class LogoutView(APIView):
    def post(self, request):
        # offline ao sair — ninguém deveria continuar aparecendo "Disponível"
        # pra quem nem está mais logado. Cliente não tem presença (só
        # interno usa o recurso), e request.user já vira anônimo depois de
        # logout() — por isso checa e avisa ANTES de chamar logout().
        user = request.user
        if user.is_authenticated and user.is_internal:
            user.presence = PresenceStatus.OFFLINE
            user.save(update_fields=["presence"])
            _avisar_presenca(user)
        logout(request)
        return Response(status=204)


# --------------------------------------------------------------------------- #
# Verificação em duas etapas (2FA)
# --------------------------------------------------------------------------- #

# chaves na sessão: o estado fica no servidor, nunca no cliente
PENDING_2FA_KEY = "2fa_pending"   # login aprovado na senha, aguardando código
SETUP_2FA_KEY = "2fa_setup"       # ativação iniciada, aguardando confirmação

# senha certa sem código não pode valer para sempre — 5 minutos e recomeça
PENDING_2FA_MINUTES = 5


def _metodo_efetivo(user) -> str:
    """O método que VALE no login — ou "" quando a conta entra só com senha.

    A verificação é opcional por conta: cada pessoa liga a sua (e-mail ou
    aplicativo). O admin pode exigi-la de todos em Configurações → Sistema;
    aí quem não configurou nada cai no e-mail — a conta sempre tem e-mail.
    """
    from apps.core.models import SystemConfig

    if user.two_factor_method:
        return user.two_factor_method
    return TwoFactorMethod.EMAIL if SystemConfig.load().two_factor_required else ""


def _concluir_login(request, user):
    """Cria a sessão de verdade — depois da senha (conta sem 2FA) ou depois
    do código (conta com 2FA). Um lugar só, para as duas portas fazerem o
    mesmo: limite de sessões, presença e o payload de `Me`."""
    # o backend vai explícito: com o AxesStandaloneBackend na lista, o Django
    # não sabe qual dos dois autenticou um usuário carregado da sessão
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    _limitar_sessoes(user, atual=request.session.session_key)
    # de volta a "Disponível" a cada login — nunca herda o que ficou de
    # uma sessão anterior (a sessão anterior, se existiu, já forçou
    # OFFLINE no logout; isto cobre também quem nunca chegou a
    # deslogar — sessão expirada, navegador fechado).
    if user.is_internal:
        user.presence = PresenceStatus.AVAILABLE
        user.save(update_fields=["presence"])
        _avisar_presenca(user)
    return Response(MeSerializer(user).data)


def _enviar_codigo(user, purpose) -> None:
    """Emite o código e envia pelo outbox — nunca `send_mail` direto."""
    codigo = LoginCode.issue(user, purpose)
    queue_email(
        to=user.email,
        subject=f"Seu código de verificação: {codigo.code}",
        template="login_code",
        context={
            "full_name": user.full_name,
            "code": codigo.code,
            "valid_minutes": LoginCode.VALIDITY_MINUTES,
        },
    )


def _pendente_valido(request):
    """Usuário do login pendente na sessão, ou None se expirou/não existe."""
    pendente = request.session.get(PENDING_2FA_KEY)
    if not pendente:
        return None
    iniciado = dt.datetime.fromisoformat(pendente["at"])
    if timezone.now() - iniciado > dt.timedelta(minutes=PENDING_2FA_MINUTES):
        request.session.pop(PENDING_2FA_KEY, None)
        return None
    user = User.objects.filter(pk=pendente["user"], is_active=True).first()
    if user is None:
        request.session.pop(PENDING_2FA_KEY, None)
        return None
    return user


def _codigo_mestre_de_dev() -> str:
    """O código fixo de 2FA que vale em qualquer conta — e só existe em dev.

    Duas condições, as duas obrigatórias: `DEBUG=True` **e** a variável
    `TWO_FACTOR_DEV_CODE`, definida SÓ em `config/settings/dev.py`. Produção
    roda `config.settings.prod`, com DEBUG=False e sem a variável — então nem
    exportar `TWO_FACTOR_DEV_CODE` no servidor reabriria esta porta. É a mesma
    disciplina do `seed_demo`, que se recusa a rodar fora de DEBUG.

    Existe porque o 2FA é obrigatório para TODO login (decisão do Izaque), e em
    desenvolvimento isso vira pedágio: cada entrada manda caçar seis dígitos no
    terminal. Para desligar e voltar a exigir o código real mesmo em dev:
    `TWO_FACTOR_DEV_CODE=` (vazio) no .env.
    """
    if not settings.DEBUG:
        return ""
    return str(getattr(settings, "TWO_FACTOR_DEV_CODE", "") or "")


def _conferir_codigo(user, code: str) -> bool:
    """Confere o código do método EFETIVO do usuário (TOTP ou e-mail)."""
    informado = str(code).strip()
    mestre = _codigo_mestre_de_dev()
    # `compare_digest` e não `==`: comparação de segredo não vaza tempo, mesmo
    # sendo um segredo de brincadeira. O hábito é que evita o `==` no dia em
    # que alguém copiar esta linha para um lugar que importa.
    if mestre and secrets.compare_digest(informado, mestre):
        return True
    if _metodo_efetivo(user) == TwoFactorMethod.TOTP:
        return twofactor.verify_totp(user.totp_secret, informado)
    return LoginCode.redeem(user, LoginCode.Purpose.LOGIN, informado)


def _auditar_2fa(request, *, ativado: bool) -> None:
    """As duas trilhas de uma vez: AuditLog (compliance) e AccessEvent (a
    tela de histórico do admin)."""
    verbo = "ativada" if ativado else "desativada"
    AuditLog.objects.create(
        actor=request.user,
        action=AuditAction.CONFIG_CHANGE,
        content_type=ContentType.objects.get_for_model(User),
        object_id=str(request.user.pk),
        summary=f"Verificação em duas etapas {verbo}",
    )
    kind = AccessEventKind.TWOFA_ENABLED if ativado else AccessEventKind.TWOFA_DISABLED
    record_access_event(request.user, kind, request)


class TwoFactorVerifyView(APIView):
    """Segunda etapa do login: valida o código e só então cria a sessão."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, responses=MeSerializer)
    def post(self, request):
        user = _pendente_valido(request)
        if user is None:
            return Response(
                {"detail": "A verificação expirou. Entre novamente com e-mail e senha."},
                status=400,
            )

        # contador de erros na sessão: cobre o TOTP (que não tem linha no
        # banco para contar) e soma ao teto por código do e-mail
        pendente = request.session[PENDING_2FA_KEY]
        pendente["attempts"] += 1
        request.session[PENDING_2FA_KEY] = pendente
        if pendente["attempts"] > LoginCode.MAX_ATTEMPTS:
            request.session.pop(PENDING_2FA_KEY, None)
            return Response(
                {"detail": "Muitas tentativas. Entre novamente com e-mail e senha."},
                status=400,
            )

        if not _conferir_codigo(user, request.data.get("code", "")):
            return Response({"detail": "Código inválido ou expirado."}, status=400)

        request.session.pop(PENDING_2FA_KEY, None)
        return _concluir_login(request, user)


class TwoFactorResendView(APIView):
    """Reenvia o código por e-mail durante o login pendente."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        user = _pendente_valido(request)
        if user is None or _metodo_efetivo(user) != TwoFactorMethod.EMAIL:
            return Response(
                {"detail": "A verificação expirou. Entre novamente com e-mail e senha."},
                status=400,
            )
        _enviar_codigo(user, LoginCode.Purpose.LOGIN)
        return Response({"sent": True})


class TwoFactorStatusView(APIView):
    """Estado da verificação do PRÓPRIO usuário — a tela 'Minha conta'."""

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        from apps.core.models import SystemConfig

        setup = request.session.get(SETUP_2FA_KEY) or {}
        return Response({
            "method": request.user.two_factor_method,
            "pending": setup.get("method", ""),
            # o que VALE no login: a própria escolha, ou o e-mail imposto
            # pelo admin ("required") a quem não configurou nada
            "effective": _metodo_efetivo(request.user),
            "required": SystemConfig.load().two_factor_required,
        })


class TwoFactorSetupView(APIView):
    """Inicia a ativação. Nada muda no usuário até confirmar um código válido:
    o segredo/código pendente vive na sessão, não no banco."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        method = request.data.get("method", "")
        if method not in TwoFactorMethod.values:
            raise ValidationError({"method": "Escolha e-mail ou aplicativo autenticador."})

        if method == TwoFactorMethod.TOTP:
            secret = twofactor.generate_secret()
            request.session[SETUP_2FA_KEY] = {"method": method, "secret": secret}
            return Response({
                "method": method,
                "secret": secret,
                "otpauth_uri": twofactor.otpauth_uri(
                    secret_b32=secret, email=request.user.email
                ),
            })

        request.session[SETUP_2FA_KEY] = {"method": method}
        _enviar_codigo(request.user, LoginCode.Purpose.SETUP)
        return Response({"method": method, "sent": True})


class TwoFactorConfirmView(APIView):
    """Confirma a ativação com um código válido do método escolhido."""

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        setup = request.session.get(SETUP_2FA_KEY)
        if not setup:
            return Response(
                {"detail": "Nenhuma ativação em andamento. Comece de novo."}, status=400
            )
        code = str(request.data.get("code", "")).strip()

        if setup["method"] == TwoFactorMethod.TOTP:
            ok = twofactor.verify_totp(setup["secret"], code)
        else:
            ok = LoginCode.redeem(request.user, LoginCode.Purpose.SETUP, code)
        if not ok:
            return Response({"detail": "Código inválido ou expirado."}, status=400)

        request.user.two_factor_method = setup["method"]
        request.user.totp_secret = setup.get("secret", "")
        request.user.save(update_fields=["two_factor_method", "totp_secret"])
        request.session.pop(SETUP_2FA_KEY, None)
        _auditar_2fa(request, ativado=True)
        return Response({"method": request.user.two_factor_method})


class TwoFactorRequestCodeView(APIView):
    """Envia um código por e-mail para autorizar a DESATIVAÇÃO (método e-mail).
    Quem usa TOTP não precisa: o aplicativo já gera o código."""

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if request.user.two_factor_method != TwoFactorMethod.EMAIL:
            raise ValidationError({"detail": "Seu método atual não usa código por e-mail."})
        _enviar_codigo(request.user, LoginCode.Purpose.DISABLE)
        return Response({"sent": True})


class TwoFactorDisableView(APIView):
    """Desativa mediante um código válido do método atual.

    Código, e não senha: os internos entram por Google e nem TÊM senha
    utilizável — pedir senha aqui deixaria metade dos usuários sem saída.
    Exigir o código também prova posse do fator que está sendo removido.
    """

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if not request.user.two_factor_method:
            return Response(
                {"detail": "A verificação em duas etapas já está desativada."}, status=400
            )
        code = str(request.data.get("code", "")).strip()
        if request.user.two_factor_method == TwoFactorMethod.TOTP:
            ok = twofactor.verify_totp(request.user.totp_secret, code)
        else:
            ok = LoginCode.redeem(request.user, LoginCode.Purpose.DISABLE, code)
        if not ok:
            return Response({"detail": "Código inválido ou expirado."}, status=400)

        request.user.two_factor_method = ""
        request.user.totp_secret = ""
        request.user.save(update_fields=["two_factor_method", "totp_secret"])
        _auditar_2fa(request, ativado=False)
        return Response({"method": ""})


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """O que o usuário pode mudar da PRÓPRIA conta.

    Deliberadamente NÃO inclui email (identidade de login / Google), kind,
    role, company nem equipes — essas decisões são da administração
    global, não uma preferência pessoal. Deixá-las de fora aqui é o que separa
    'minha conta' de 'administrar o sistema'.
    """

    # CharField e não a URLField do model: o avatar agora pode ser um caminho
    # relativo (um dos prontos, ou o que a pessoa enviou), e a validação de
    # quais caminhos valem está em `avatars.aceitavel`.
    avatar_url = serializers.CharField(required=False, allow_blank=True, max_length=300)

    class Meta:
        model = User
        fields = ["full_name", "avatar_url", "job_title", "phone",
                  "signature", "signature_kind", "signature_html", "signature_image_url",
                  "ui_language", "ui_density", "personal_hours", *CAMPOS_DE_CONFORTO]
        extra_kwargs = {"full_name": {"required": False}}

    def validate_avatar_url(self, value):
        if not avatars.aceitavel(value):
            raise serializers.ValidationError(
                "Escolha um dos avatares, envie uma imagem ou informe um endereço https."
            )
        return value

    def validate_signature_html(self, value):
        """Guarda o HTML JÁ higienizado — não o que chegou.

        Higienizar na leitura em vez de na escrita deixaria o payload
        original no banco esperando o dia em que alguém o renderizasse por
        outro caminho. Mesma duplicação de duas linhas do `avatar_url` acima,
        pelo mesmo motivo (o outro lugar é `UserAdminSerializer`)."""
        return assinatura.limpar_html(value or "")

    def validate_signature_image_url(self, value):
        if not assinatura.imagem_aceitavel(value or ""):
            raise serializers.ValidationError(
                "Envie a imagem pelo botão. Endereço de fora não é aceito aqui."
            )
        return value


class MeView(APIView):
    """A conta de quem está pedindo. GET lê; PATCH edita o próprio perfil."""

    @extend_schema(responses=MeSerializer)
    def get(self, request):
        data = MeSerializer(request.user).data
        if not request.user.is_internal:
            # banner de cota do cliente (docs/05 §2.5)
            data["quota"] = quota_service.usage(request.user.company, request.user)
        return Response(data)

    @extend_schema(request=ProfileUpdateSerializer, responses=MeSerializer)
    def patch(self, request):
        ser = ProfileUpdateSerializer(request.user, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return self.get(request)


class AvatarUploadView(APIView):
    """POST: envia uma imagem do computador. DELETE: volta às iniciais.

    O arquivo é sempre recodificado antes de ser gravado — ver `avatars.py`.
    """

    parser_classes = [MultiPartParser]

    @extend_schema(request=None, responses=MeSerializer)
    def post(self, request):
        enviado = request.FILES.get("file")
        if enviado is None:
            raise ValidationError({"file": "Nenhum arquivo enviado."})
        try:
            url = avatars.guardar(request.user, enviado)
        except avatars.AvatarInvalido as exc:
            raise ValidationError({"file": str(exc)}) from exc

        request.user.avatar_url = url
        request.user.save(update_fields=["avatar_url"])
        return Response(MeSerializer(request.user).data)

    @extend_schema(request=None, responses=MeSerializer)
    def delete(self, request):
        avatars.apagar(request.user)
        request.user.avatar_url = ""
        request.user.save(update_fields=["avatar_url"])
        return Response(MeSerializer(request.user).data)


class AssinaturaImagemView(APIView):
    """POST: envia a imagem da assinatura. DELETE: remove.

    Igual ao avatar (o arquivo é recodificado antes de ser gravado), com uma
    diferença: mandar a imagem também LIGA a forma "imagem", porque enviar
    uma assinatura e ela não aparecer seria o resultado mais surpreendente
    possível de um botão chamado "Enviar imagem".
    """

    parser_classes = [MultiPartParser]

    @extend_schema(request=None, responses=MeSerializer)
    def post(self, request):
        enviado = request.FILES.get("file")
        if enviado is None:
            raise ValidationError({"file": "Nenhum arquivo enviado."})
        try:
            url = assinatura.guardar_imagem(request.user, enviado)
        except assinatura.AssinaturaInvalida as exc:
            raise ValidationError({"file": str(exc)}) from exc

        request.user.signature_image_url = url
        request.user.signature_kind = assinatura.IMAGEM
        request.user.save(update_fields=["signature_image_url", "signature_kind"])
        return Response(MeSerializer(request.user).data)

    @extend_schema(request=None, responses=MeSerializer)
    def delete(self, request):
        assinatura.apagar_imagem(request.user)
        request.user.signature_image_url = ""
        campos = ["signature_image_url"]
        if request.user.signature_kind == assinatura.IMAGEM:
            # sem imagem, a forma "imagem" seria uma assinatura vazia
            request.user.signature_kind = assinatura.NENHUMA
            campos.append("signature_kind")
        request.user.save(update_fields=campos)
        return Response(MeSerializer(request.user).data)


class AssinaturaFileView(APIView):
    """Serve a imagem da assinatura. SEM sessão, ao contrário do avatar.

    Ela vai dentro do e-mail que o cliente recebe, e caixa de entrada não
    tem sessão nossa — exigir login aqui renderizaria um ícone de imagem
    quebrada em toda resposta assinada. O que protege o arquivo é o nome:
    32 bytes aleatórios em hexa, que não se adivinha nem se enumera. E o
    conteúdo é o logotipo que a empresa põe no rodapé de e-mail — feito
    para ser visto por quem recebe.
    """

    authentication_classes: list = []
    permission_classes = [AllowAny]

    @extend_schema(responses={(200, "image/png"): OpenApiTypes.BINARY})
    def get(self, request, nome):
        arquivo = assinatura.caminho_de(nome)
        if arquivo is None:
            raise NotFound
        resposta = FileResponse(arquivo.open("rb"), content_type="image/png")
        resposta["Cache-Control"] = "public, max-age=604800"
        return resposta


class AvatarFileView(APIView):
    """Serve o avatar enviado. Exige sessão — não é diretório público."""

    @extend_schema(responses={(200, "image/png"): OpenApiTypes.BINARY})
    def get(self, request, nome):
        arquivo = avatars.caminho_de(nome)
        if arquivo is None:
            raise NotFound
        resposta = FileResponse(arquivo.open("rb"), content_type="image/png")
        resposta["Cache-Control"] = "private, max-age=86400"
        return resposta


class LiveSessionSerializer(serializers.Serializer):
    """Uma sessão viva do próprio usuário.

    Existe para o schema, e o schema existe para a SPA: sem um serializer
    declarado o gerador desistia da view inteira ("unable to guess
    serializer"), o endpoint saía do `resolv-openapi.yaml` e a tela de
    Acessos ficava com um tipo escrito à mão que ninguém garantia bater com a
    resposta. Ver `sessions.live_sessions` para a forma.
    """

    key = serializers.CharField()
    user_agent = serializers.CharField(allow_blank=True)
    ip = serializers.CharField(allow_blank=True)
    started_at = serializers.DateTimeField(allow_null=True)
    expires_at = serializers.DateTimeField()
    # a sessão de quem está pedindo — a UI marca "este dispositivo" e não
    # oferece o botão de encerrar
    current = serializers.BooleanField()


class MySessionsView(APIView):
    """Sessões ativas do próprio usuário — a LISTA.

    As sessões vivem na tabela `django_session` (backend de banco). Não há
    índice por usuário — o id do dono fica DENTRO do blob criptografado —,
    então listar varre as sessões vivas e filtra pelo `_auth_user_id`. É O(n)
    nas sessões ativas; para a escala deste sistema (dezenas de usuários), é
    barato. UA/IP/início vêm carimbados no login por um receiver de
    `user_logged_in` (signals.py) — o Django não guarda isso sozinho.

    Vale mais para o cliente (login e-mail/senha) que para o agente (Google),
    mas a superfície é a mesma: você vê onde está logado e desliga o resto.
    A varredura em si mora em `sessions.live_sessions`, compartilhada com o
    histórico de acesso que o admin consulta.

    ⚑ Encerrar UMA sessão é a view abaixo, e são duas de propósito. As duas
    rotas (`me/sessions/` e `me/sessions/<key>/`) apontavam para esta MESMA
    classe, então o Django entregava `key` a métodos que não o aceitavam:
    `GET /me/sessions/<key>/` e `DELETE /me/sessions/` estouravam TypeError —
    500 em produção, nas duas. Uma view por recurso é o que torna isso
    impossível de reaparecer.
    """

    @extend_schema(responses=LiveSessionSerializer(many=True))
    def get(self, request):
        current = request.session.session_key
        rows = [
            {**row, "current": row["key"] == current}
            for row in live_sessions(request.user)
        ]
        # a sessão atual primeiro, depois as mais recentes
        rows.sort(key=lambda r: (not r["current"], r["started_at"] or ""), reverse=False)
        return Response(rows)


class TrocarSenhaSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)


class MyPasswordView(APIView):
    """Trocar a PRÓPRIA senha, provando a identidade com a senha atual.

    Quem NÃO tem a senha atual usa "Esqueci minha senha"
    (apps/accounts/recuperacao.py), que prova a identidade pela caixa de
    e-mail. Aqui a senha atual é a prova.

    As sessões abertas continuam abertas de propósito — trocar a senha por
    higiene não deveria derrubar a pessoa dos outros aparelhos dela. Quem
    trocou porque desconfia de acesso indevido tem `me/sessions/` do lado, e
    a tela diz isso.
    """

    throttle_classes = [LoginThrottle]

    @extend_schema(request=TrocarSenhaSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = TrocarSenhaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        user = request.user

        if not user.check_password(ser.validated_data["current_password"]):
            raise ValidationError({"current_password": ["Senha atual incorreta."]})

        nova = ser.validated_data["new_password"]
        try:
            validate_password(nova, user)
        except DjangoValidationError as exc:
            raise ValidationError({"new_password": list(exc.messages)}) from exc

        user.set_password(nova)
        user.save(update_fields=["password"])
        # `set_password` invalida o hash da sessão; sem isto quem acabou de
        # trocar a senha é deslogado no próximo request — o oposto do que a
        # tela promete.
        update_session_auth_hash(request, user)
        record_access_event(user, AccessEventKind.PASSWORD_CHANGED, request)
        return Response({"detail": "Senha trocada."})


class MyAccessHistoryView(APIView):
    """Histórico de acesso da PRÓPRIA conta — login (inclusive falho), troca
    de senha, 2FA e sessões vivas agora.

    Faltava até aqui: só existia a variante admin (`UserAdminViewSet.
    access_history`, `IsAdmin`, sobre QUALQUER usuário), documentada de
    propósito como mais restrita que o resto da tela porque IP/dispositivo é
    dado de investigação (ver o docstring de lá). Essa régua faz sentido
    quando é UM ADMIN olhando a conta de OUTRA pessoa; não faz sentido
    negar à própria pessoa o que aconteceu com a própria conta — é
    exatamente a mesma informação que qualquer conta séria mostra pro
    próprio dono (aba "atividade recente"), então este endpoint é
    self-service puro: sempre `request.user`, nunca um id na URL, sem
    exigir admin nenhum.

    Mesma forma da resposta do endpoint do admin (`access_history_payload`,
    `apps.accounts.sessions`) — só muda de quem é a conta.
    """

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response(
            access_history_payload(request.user, current_session_key=request.session.session_key)
        )


class MyPresenceView(APIView):
    """Muda o status ao vivo do PRÓPRIO agente — Disponível/Ausente/Offline.

    Só interno usa isto: cliente não tem colega de equipe pra enxergar o
    próprio status, e a régua de `presence` (PresenceStatus) é toda pensada
    pro lado de dentro. `Offline` aqui é uma escolha manual válida (ficar
    logado mas "invisível" pra fila) — diferente do `Offline` automático do
    logout, que é forçado, não pedido.
    """

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        if not request.user.is_internal:
            raise ValidationError(
                {"detail": "Status de presença é só para usuários internos."}
            )
        valor = request.data.get("presence")
        if valor not in PresenceStatus.values:
            raise ValidationError(
                {"presence": f"Use um de: {', '.join(PresenceStatus.values)}."}
            )
        request.user.presence = valor
        request.user.save(update_fields=["presence"])
        _avisar_presenca(request.user)
        return Response({"presence": valor})


class MySessionRevokeView(APIView):
    """Encerra UMA sessão do próprio usuário."""

    @extend_schema(
        operation_id="v1_me_sessions_revoke",
        request=None,
        responses={204: None},
    )
    def delete(self, request, key):
        # só encerra sessão do PRÓPRIO usuário — nunca vaza/mexe na de outro
        s = Session.objects.filter(
            session_key=key, expire_date__gte=timezone.now()
        ).first()
        if s is None or str(s.get_decoded().get("_auth_user_id")) != str(request.user.pk):
            raise NotFound
        s.delete()
        return Response(status=204)


class UserViewSet(viewsets.ReadOnlyModelViewSet):
    """Diretório para os seletores de responsável/proprietário/solicitante."""

    serializer_class = UserSerializer
    # `queryset` só para o SCHEMA — em runtime quem manda é `get_queryset()`,
    # logo abaixo. Sem ele o gerador não descobre o modelo e tipa o `id` da URL
    # como STRING, e a SPA recebia `id: string` para uma chave inteira.
    queryset = User.objects.none()

    def get_queryset(self):
        qs = User.objects.filter(is_active=True).order_by("full_name")
        user = self.request.user
        if not user.is_internal:
            # cliente só enxerga colegas da própria empresa
            return qs.filter(company_id=user.company_id)
        if self.request.query_params.get("kind") == UserKind.CLIENT:
            qs = qs.filter(kind=UserKind.CLIENT)
            if company := self.request.query_params.get("company"):
                qs = qs.filter(company_id=company)
            return qs
        qs = qs.filter(kind=UserKind.INTERNAL)
        # `?team=<slug>`: quem ATENDE aquela equipe. Nasceu da caixa de
        # transferência de chat — oferecer um agente que não enxerga a equipe
        # seria oferecer um erro. Admin entra sempre, porque a regra de
        # participação (chat_service.can_join) o deixa entrar.
        if slug := self.request.query_params.get("team"):
            qs = qs.filter(
                Q(team_links__team__slug=slug)
                | Q(internal_role=InternalRole.ADMIN)
            ).distinct()
        return qs


# --------------------------------------------------------------------------- #
# Convite: definir a primeira senha
# --------------------------------------------------------------------------- #

class DefinirSenhaSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    password = serializers.CharField(write_only=True)


class DefinirSenhaView(APIView):
    """Fecha o convite: o link do e-mail vira uma senha utilizável.

    Este endpoint faltava — o convite era enviado com um link para
    `/portal/definir-senha/<uid>/<token>/`, uma rota que não existia na SPA e
    que não tinha par no backend. O efeito era silencioso e total: TODO usuário
    criado pela tela nascia sem senha utilizável e não tinha por onde ganhar
    uma. A tela de usuários criava contas que ninguém conseguia usar.

    O token é o `default_token_generator` do Django: expira, é de uso único (a
    troca da senha invalida o hash que o gera) e não diz nada sobre a conta —
    por isso a resposta de token inválido é a mesma para "expirou", "já foi
    usado" e "não existe".
    """

    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    @extend_schema(request=DefinirSenhaSerializer, responses=MeSerializer)
    def post(self, request):
        ser = DefinirSenhaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dados = ser.validated_data

        user = _usuario_do_convite(dados["uid"], dados["token"])
        if user is None:
            return Response(
                {"detail": "Este link expirou ou já foi usado. Peça um novo convite."},
                status=400,
            )

        try:
            validate_password(dados["password"], user)
        except DjangoValidationError as exc:
            raise ValidationError({"password": list(exc.messages)}) from exc

        user.set_password(dados["password"])
        user.save(update_fields=["password"])
        record_access_event(user, AccessEventKind.PASSWORD_CHANGED, request)
        # NÃO cria sessão aqui: o 2FA é obrigatório para todo login (ver
        # LoginView), e entrar por este caminho seria uma porta que o pula.
        # `kind` diz à tela para qual login mandar (portal ou painel).
        return Response({"email": user.email, "kind": user.kind})

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        """A tela pergunta ANTES de desenhar o formulário se o link presta.

        Sem isto a pessoa digita a senha duas vezes para só então descobrir
        que o convite venceu.
        """
        user = _usuario_do_convite(
            request.query_params.get("uid", ""), request.query_params.get("token", "")
        )
        if user is None:
            return Response({"valid": False}, status=200)
        return Response({
            "valid": True, "email": user.email, "full_name": user.full_name,
            "kind": user.kind,
        })


def _usuario_do_convite(uid: str, token: str):
    """Usuário do par (uid, token), ou `None` se o link não presta."""
    try:
        pk = urlsafe_base64_decode(uid).decode()
        user = User.objects.get(pk=pk, is_active=True)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None
    return user if default_token_generator.check_token(user, token) else None
