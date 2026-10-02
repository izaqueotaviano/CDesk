"""Recuperação de senha pelo próprio usuário ("Esqueci minha senha").

**Isto reverte uma decisão de produto antiga, a pedido do dono.** Até aqui a
regra era: não existe recuperação self-service; quem esquece a senha fala
com o suporte, que confirma a identidade por outro canal e aciona
`UserAdminViewSet.reset_password`. O motivo era provar "sou eu" sem a senha.
A prova agora é a posse da caixa de e-mail, como em qualquer produto sério,
e o que continua valendo da decisão antiga está todo aqui:

- **sem enumeração**: o pedido responde SEMPRE a mesma coisa, exista a conta
  ou não, esteja ativa ou não. Nenhum texto, status ou campo diferente;
- **quem não entra por senha não recebe link**: conta inativa, anonimizada,
  visitante do chat público (`is_widget_visitor`, ver abaixo) e interno que
  entra pelo Google;
- **o link não cria sessão**: ele só troca a senha. Entrar continua sendo o
  login normal, com a verificação em duas etapas de quem a tem ligada. Um
  link que logasse direto seria uma porta que pula o 2FA;
- **teto de pedidos por IP e por e-mail**, os dois pelo throttle do DRF (a
  mesma ferramenta do `LoginThrottle`), para o formulário não virar canhão
  de e-mail contra a caixa de alguém.

Visitante do chat público fica de fora de propósito: ele se cadastra sozinho
digitando qualquer e-mail na janelinha do site do cliente, e nasce sem senha
utilizável justamente porque isso o mantém fora do portal
(apps/customers/services/embed_visitor.py). Se ele pudesse pedir um link,
qualquer pessoa entraria no portal de qualquer empresa que tenha o chat
público: bastaria conversar com o próprio e-mail e depois "recuperar" a
senha. Promover um visitante a usuário continua sendo decisão de gente.

O token é o `PasswordResetTokenGenerator` do Django com outro `key_salt`:
o link do convite (`default_token_generator`) e o da recuperação não servem
um no lugar do outro, e este vence em `PASSWORD_RECOVERY_TIMEOUT` (1 hora
por padrão) em vez dos 3 dias do convite. É de uso único sem tabela
nenhuma: o hash da senha entra no token, então trocar a senha o invalida
(e entrar também, porque `last_login` entra junto).
"""

from __future__ import annotations

import hashlib
import logging

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import base36_to_int, urlsafe_base64_decode, urlsafe_base64_encode
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.settings import api_settings
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from apps.accounts.admin_api import precisa_de_convite
from apps.accounts.models import AccessEventKind, User, UserKind
from apps.accounts.sessions import client_ip, live_sessions
from apps.accounts.signals import record_access_event
from apps.audit.models import AuditAction, AuditLog
from apps.notifications.services import queue_email

logger = logging.getLogger(__name__)

#: Validade do link, em segundos. Curta de propósito: quem pede o link está
#: com a caixa de entrada aberta agora; um link que vale dias é um link que
#: fica esquecido num e-mail encaminhado.
VALIDADE_PADRAO = 60 * 60

#: A resposta do pedido — a MESMA para conta que existe, que não existe,
#: inativa ou visitante. Mudar este texto conforme o caso seria a enumeração.
RESPOSTA_PEDIDO = (
    "Se existir uma conta com esse e-mail, enviamos um link para criar uma "
    "senha nova. Confira a caixa de entrada e o spam."
)

LINK_INVALIDO = (
    "Este link expirou ou já foi usado. Peça um novo em \"Esqueci minha senha\"."
)


def validade_segundos() -> int:
    return int(getattr(settings, "PASSWORD_RECOVERY_TIMEOUT", VALIDADE_PADRAO))


class RecuperacaoTokenGenerator(PasswordResetTokenGenerator):
    """O gerador do Django com sal próprio e validade própria.

    `check_token` do Django mede a idade contra `PASSWORD_RESET_TIMEOUT`,
    que é a validade do CONVITE (3 dias). Aqui ele confere primeiro a
    assinatura pelo caminho de sempre e só depois aplica o teto curto — sem
    reescrever a parte criptográfica.
    """

    key_salt = "apps.accounts.recuperacao.RecuperacaoTokenGenerator"

    def check_token(self, user, token):
        if not super().check_token(user, token):
            return False
        try:
            emitido = base36_to_int(token.split("-")[0])
        except ValueError:
            return False
        return self._num_seconds(self._now()) - emitido <= validade_segundos()


gerador = RecuperacaoTokenGenerator()


# --------------------------------------------------------------------------- #
# Quem pode receber o link
# --------------------------------------------------------------------------- #

def entra_por_senha(user) -> bool:
    """A conta usa senha para entrar — e por isso pode recuperá-la.

    `precisa_de_convite` é a mesma pergunta que o convite faz ("esta conta
    depende de senha?"): cliente sempre, interno só sem Google ligado.
    """
    return (
        user.is_active
        and user.anonymized_at is None
        and not user.is_widget_visitor
        and precisa_de_convite(user)
    )


def link_de(user) -> str:
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = gerador.make_token(user)
    # absoluta: o link viaja por e-mail. Rota pública da SPA (routes.tsx),
    # sob o login de cada público, para a tela já nascer com a marca certa
    # e o "voltar" levar ao login de onde a pessoa veio.
    base = "/login/cliente" if user.kind == UserKind.CLIENT else "/login"
    return f"{settings.SITE_URL}{base}/redefinir-senha/{uid}/{token}"


def solicitar(email: str) -> None:
    """Envia o link para cada conta elegível com este e-mail — ou nada.

    Não devolve nada de propósito: quem chama não tem como (nem por que)
    saber se alguém recebeu.
    """
    email = (email or "").strip()
    if not email:
        return
    # `iexact`: o login compara em minúsculas (LoginView), e quem digita
    # "Ana@Acme.com" aqui está falando da mesma conta.
    for user in User.objects.filter(email__iexact=email):
        if not entra_por_senha(user):
            continue
        queue_email(
            to=user.email,
            subject="Redefina sua senha",
            template="password_reset",
            context={
                "full_name": user.full_name,
                "email": user.email,
                "link": link_de(user),
                "valid_minutes": validade_segundos() // 60,
            },
        )


def usuario_do_link(uid: str, token: str):
    """O dono do par (uid, token), ou `None` se o link não presta.

    A resposta é a mesma para "expirou", "já foi usado", "conta desativada"
    e "nunca existiu" — nenhum deles diz nada útil a quem está adivinhando.
    """
    try:
        pk = urlsafe_base64_decode(uid).decode()
        user = User.objects.get(pk=pk)
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None
    if not entra_por_senha(user):
        return None
    return user if gerador.check_token(user, token) else None


def encerrar_sessoes(user) -> int:
    """Derruba todas as sessões vivas da conta — o "Sessões ativas" inteiro.

    Quem recupera a senha pode estar fazendo isso justamente porque alguém
    entrou na conta dele. Deixar as sessões abertas manteria o intruso
    dentro com a senha antiga já trocada.
    """
    chaves = [row["key"] for row in live_sessions(user)]
    Session.objects.filter(session_key__in=chaves).delete()
    return len(chaves)


def _destravar_login(user, request) -> None:
    """Abre a trava de força bruta (axes) deste e-mail NESTE aparelho.

    Quem esqueceu a senha costuma chegar aqui depois de errar até travar. A
    trava é por (e-mail, IP) e dura minutos; sem isto a pessoa troca a senha
    e continua sem entrar, lendo "muitas tentativas". Só o par de quem acabou
    de provar a posse do e-mail é aberto, nunca o de outro IP.
    """
    if not getattr(settings, "AXES_ENABLED", False):
        return
    try:
        from axes.utils import reset

        reset(ip=client_ip(request), username=user.email)
    except Exception:  # noqa: BLE001 — destravar é cortesia, nunca motivo de falha
        logger.warning("não foi possível destravar o login de %s", user.pk, exc_info=True)


def redefinir(user, nova_senha: str, request) -> None:
    """Troca a senha e fecha tudo o que a troca deve fechar."""
    try:
        validate_password(nova_senha, user)
    except DjangoValidationError as exc:
        raise ValidationError({"new_password": list(exc.messages)}) from exc

    user.set_password(nova_senha)
    # O receiver de `post_save` registraria a troca SEM IP/aparelho; aqui há
    # requisição, então o evento vai completo, e só uma vez — a marca sai
    # ANTES do save, que é quando o receiver a lê.
    user._password_was_set = False
    user.save(update_fields=["password"])
    record_access_event(user, AccessEventKind.PASSWORD_CHANGED, request)

    encerradas = encerrar_sessoes(user)
    _destravar_login(user, request)

    AuditLog.objects.create(
        actor=user,
        action=AuditAction.UPDATE,
        content_type=ContentType.objects.get_for_model(User),
        object_id=str(user.pk),
        summary="Senha redefinida pelo link de recuperação",
        changes={"sessoes_encerradas": encerradas},
        ip_address=client_ip(request) or None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:250],
    )

    agora = timezone.localtime(timezone.now())
    queue_email(
        to=user.email,
        subject="Sua senha foi alterada",
        template="password_changed",
        context={
            "full_name": user.full_name,
            "email": user.email,
            "quando": agora.strftime("%d/%m/%Y às %H:%M"),
        },
    )


# --------------------------------------------------------------------------- #
# Throttles
# --------------------------------------------------------------------------- #

class _ThrottleComPadrao(SimpleRateThrottle):
    """Throttle com taxa padrão no código, sobrescrevível pelas settings.

    `DEFAULT_THROTTLE_RATES` continua mandando (quem quiser outro teto põe
    o escopo lá); a taxa daqui é só o que vale quando ninguém configurou,
    para a recuperação nunca nascer sem limite.
    """

    taxa_padrao = "10/hour"

    def get_rate(self):
        return api_settings.DEFAULT_THROTTLE_RATES.get(self.scope) or self.taxa_padrao


class RecuperacaoPorIpThrottle(_ThrottleComPadrao):
    """Pedidos por IP — segura quem varre uma lista de e-mails.

    Vale também para quem está logado (o `AnonRateThrottle` deixaria passar
    qualquer sessão), porque o formulário é o mesmo para todo mundo.
    """

    scope = "password_reset"
    taxa_padrao = "10/hour"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


class RecuperacaoPorEmailThrottle(_ThrottleComPadrao):
    """Pedidos por e-mail — segura quem tenta lotar a caixa de alguém,
    trocando de IP a cada pedido. Vale para e-mail com ou sem conta: um teto
    só para quem existe contaria quem existe."""

    scope = "password_reset_email"
    taxa_padrao = "5/hour"

    def get_cache_key(self, request, view):
        email = str(request.data.get("email", "") or "").strip().lower()
        if not email:
            return None
        # hash, não o e-mail cru: a chave do cache não precisa guardar dado pessoal
        ident = hashlib.sha256(email.encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class RedefinicaoThrottle(_ThrottleComPadrao):
    """Conferência e troca pelo link, por IP. O token não se adivinha, mas
    uma porta pública sem teto é convite a tentar."""

    scope = "password_reset_confirm"
    taxa_padrao = "30/hour"

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": self.get_ident(request)}


# --------------------------------------------------------------------------- #
# Views
# --------------------------------------------------------------------------- #

class PedidoRecuperacaoSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RedefinirSenhaSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)


class RecuperarSenhaView(APIView):
    """POST `auth/recuperar-senha/` — pede o link por e-mail.

    Sempre 200 com o mesmo texto quando o e-mail é bem formado. O único
    outro resultado é o 400 de e-mail malformado, que depende só do que foi
    digitado — nunca de existir conta.
    """

    permission_classes = [AllowAny]
    throttle_classes = [RecuperacaoPorIpThrottle, RecuperacaoPorEmailThrottle]

    @extend_schema(request=PedidoRecuperacaoSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = PedidoRecuperacaoSerializer(data=request.data)
        if not ser.is_valid():
            raise ValidationError({"email": ["Informe um e-mail válido."]})
        solicitar(ser.validated_data["email"])
        return Response({"detail": RESPOSTA_PEDIDO})


class RedefinirSenhaView(APIView):
    """GET confere o link antes de desenhar o formulário; POST troca a senha.

    A troca NÃO cria sessão (ver o cabeçalho do módulo): a resposta diz só
    para qual login mandar a pessoa, e o 2FA dela continua valendo lá.
    """

    permission_classes = [AllowAny]
    throttle_classes = [RedefinicaoThrottle]

    @extend_schema(
        parameters=[
            OpenApiParameter("uid", str, OpenApiParameter.QUERY),
            OpenApiParameter("token", str, OpenApiParameter.QUERY),
        ],
        responses=OpenApiTypes.OBJECT,
    )
    def get(self, request):
        user = usuario_do_link(
            request.query_params.get("uid", ""), request.query_params.get("token", "")
        )
        if user is None:
            return Response({"valid": False})
        return Response({
            "valid": True,
            "email": user.email,
            "full_name": user.full_name,
            # a tela escolhe o painel da marca e o login de volta por aqui
            "kind": user.kind,
        })

    @extend_schema(request=RedefinirSenhaSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        ser = RedefinirSenhaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dados = ser.validated_data

        user = usuario_do_link(dados["uid"], dados["token"])
        if user is None:
            return Response({"detail": LINK_INVALIDO, "code": "link_invalido"}, status=400)

        redefinir(user, dados["new_password"], request)
        return Response({
            "detail": "Senha alterada. Entre com a senha nova.",
            "email": user.email,
            "kind": user.kind,
            "login": "/login/cliente" if user.kind == UserKind.CLIENT else "/login",
        })
