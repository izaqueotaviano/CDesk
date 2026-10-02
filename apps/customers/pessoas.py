"""Pessoas da empresa, geridas pelo responsável dela no portal.

Até aqui só a administração (tela da empresa no cvz,
`CompanyAdminViewSet.users`) cuidava de quem da empresa cliente tem acesso.
O papel `ClientRole.OWNER` sempre foi descrito como "gerencia os usuários da
própria empresa", e a permissão existia (`Perm.PORTAL_COMPANY_USERS`), mas
nenhuma rota a consumia. Esta é ela.

Regras, e por quê:

- **a empresa é sempre a de quem pede**, nunca um id na URL ou no corpo —
  como em `me/company/`. Pessoa de outra empresa não "é proibida": ela não
  existe para esta consulta (404), então não dá nem para confirmar o id;
- **só quem tem `portal.company_users`** (o responsável); membro comum e
  interno recebem 403;
- **ninguém se desativa**, e **a empresa nunca fica sem um responsável
  ativo** — senão o próximo "preciso dar acesso a alguém" vira ticket;
- **convite é o mesmo do admin** (`send_invite`): a pessoa define a própria
  senha pelo link, quem convida nunca escolhe nem vê senha;
- visitante do chat público (`is_widget_visitor`) não é acesso ao portal e
  fica fora da lista; convidar o e-mail dele é a promoção consciente;
- não existe limite de usuários por plano (`Plan` não tem esse campo) —
  quando existir, a checagem entra em `_convidar`.

Toda mudança vai para o `AuditLog`: quem ganhou e quem perdeu acesso a uma
empresa é exatamente o que se pergunta depois de um incidente.
"""

from __future__ import annotations

from django.contrib.contenttypes.models import ContentType
from django.contrib.sessions.models import Session
from django.db import transaction
from drf_spectacular.utils import OpenApiTypes, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.admin_api import send_invite
from apps.accounts.models import ClientRole, User, UserKind
from apps.accounts.rbac import Perm
from apps.accounts.sessions import live_sessions
from apps.audit.models import AuditAction, AuditLog

SEM_RESPONSAVEL = (
    "A empresa precisa de pelo menos um responsável ativo. Torne outra pessoa "
    "responsável antes."
)


class PessoaEmpresaSerializer(serializers.ModelSerializer):
    """Uma pessoa da empresa como o responsável a vê.

    Menos que o `UserAdminSerializer` de propósito: nada de 2FA, papel
    interno, equipes ou avatar de terceiros — o responsável decide QUEM tem
    acesso, não como a conta de cada um está configurada.
    """

    client_role_label = serializers.CharField(source="get_client_role_display", read_only=True)
    invite_status = serializers.SerializerMethodField()
    last_access = serializers.SerializerMethodField()
    is_me = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "full_name", "email", "phone", "job_title", "avatar_url",
            "client_role", "client_role_label", "is_active",
            "invite_status", "last_access", "is_me",
        ]

    def get_invite_status(self, obj) -> str:
        """`pendente` enquanto a pessoa não abriu o convite; `aceito` depois.

        A mesma derivação da tela do admin: ter senha utilizável É ter
        aceitado o convite, sem uma flag paralela para dessincronizar.
        """
        return "aceito" if obj.has_usable_password() else "pendente"

    def get_last_access(self, obj):
        """O mais recente entre o último login e o último sinal de vida.

        `last_login` só muda ao entrar; `last_seen_at` acompanha o uso. Quem
        fica logado por semanas teria um "último acesso" parado no dia do
        login se a tela lesse só o primeiro.
        """
        datas = [d for d in (obj.last_login, obj.last_seen_at) if d is not None]
        return max(datas).isoformat() if datas else None

    def get_is_me(self, obj) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.pk == obj.pk)


class ConvitePessoaSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(max_length=254)
    # Cadastro de cliente exige ao menos um telefone — a mesma regra do
    # admin (`UserAdminSerializer.validate`). Aqui só há um campo, então ele
    # é o obrigatório.
    phone = serializers.CharField(max_length=32)
    job_title = serializers.CharField(max_length=100, required=False, allow_blank=True)
    client_role = serializers.ChoiceField(
        choices=ClientRole.choices, required=False, default=ClientRole.MEMBER
    )

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Informe o nome da pessoa.")
        return value

    def validate_phone(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Informe um telefone para contato.")
        return value

    def validate_email(self, value):
        return value.strip().lower()


class AlteracaoPessoaSerializer(serializers.Serializer):
    is_active = serializers.BooleanField(required=False)
    client_role = serializers.ChoiceField(choices=ClientRole.choices, required=False)


def _exigir_responsavel(request):
    """A empresa de quem pede, se ele puder gerir pessoas — senão 403."""
    user = request.user
    if user.is_internal or user.company_id is None:
        raise PermissionDenied("Esta tela é da empresa cliente.")
    if not user.can(Perm.PORTAL_COMPANY_USERS):
        raise PermissionDenied("Só o responsável pela empresa gerencia as pessoas com acesso.")
    return user.company


def _pessoas(company):
    """Quem aparece na lista: clientes da empresa com acesso ao portal.

    Fora: visitante do chat público (não é acesso) e conta anonimizada (a
    pessoa pediu para sumir — LGPD, D11).
    """
    return User.objects.filter(
        company=company,
        kind=UserKind.CLIENT,
        is_widget_visitor=False,
        anonymized_at__isnull=True,
    )


def _responsaveis_ativos(company, *, exceto=None) -> int:
    qs = _pessoas(company).filter(client_role=ClientRole.OWNER, is_active=True)
    if exceto is not None:
        qs = qs.exclude(pk=exceto.pk)
    return qs.count()


def _auditar(request, alvo, *, acao, resumo, mudancas=None) -> None:
    AuditLog.objects.create(
        actor=request.user,
        action=acao,
        content_type=ContentType.objects.get_for_model(User),
        object_id=str(alvo.pk),
        summary=resumo[:250],
        changes=mudancas or {},
    )


def _encerrar_sessoes(user) -> None:
    """Desativar tem que valer AGORA, não no fim da sessão de quem saiu."""
    chaves = [row["key"] for row in live_sessions(user)]
    Session.objects.filter(session_key__in=chaves).delete()


class PessoasEmpresaView(APIView):
    """GET lista; POST convida — `me/company/users/`."""

    @extend_schema(responses=PessoaEmpresaSerializer(many=True))
    def get(self, request):
        company = _exigir_responsavel(request)
        # ativos primeiro, e dentro de cada grupo por nome: a lista é usada
        # para achar alguém, e quem saiu da empresa é o que menos se procura
        pessoas = _pessoas(company).order_by("-is_active", "full_name")
        return Response(
            PessoaEmpresaSerializer(pessoas, many=True, context={"request": request}).data
        )

    @extend_schema(request=ConvitePessoaSerializer, responses=PessoaEmpresaSerializer)
    def post(self, request):
        company = _exigir_responsavel(request)
        ser = ConvitePessoaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        pessoa = self._convidar(request, company, ser.validated_data)
        return Response(
            PessoaEmpresaSerializer(pessoa, context={"request": request}).data, status=201
        )

    @transaction.atomic
    def _convidar(self, request, company, dados) -> User:
        existente = User.objects.filter(email__iexact=dados["email"]).first()
        if existente is not None:
            if existente.company_id != company.pk or existente.kind != UserKind.CLIENT:
                # Mesma frase para "é de outra empresa" e "é da equipe de
                # suporte": dizer qual dos dois seria contar a um cliente
                # onde outra pessoa tem conta.
                raise ValidationError({
                    "email": ["Não é possível convidar este e-mail. Fale com o suporte."]
                })
            if not existente.is_widget_visitor:
                raise ValidationError({
                    "email": [
                        "Esta pessoa já está na lista da empresa."
                        if existente.is_active
                        else "Esta pessoa já está na lista, desativada. Reative-a por lá."
                    ]
                })
            # Visitante do chat público da própria empresa: convidar é a
            # promoção consciente que o embed_visitor deixa para "gente".
            pessoa = existente
            pessoa.full_name = dados["full_name"]
            pessoa.phone = dados["phone"]
            pessoa.job_title = dados.get("job_title", "") or pessoa.job_title
            pessoa.client_role = dados["client_role"]
            pessoa.is_active = True
            pessoa.is_widget_visitor = False
            pessoa.save(update_fields=[
                "full_name", "phone", "job_title", "client_role", "is_active",
                "is_widget_visitor",
            ])
        else:
            # senha nunca é escolhida por quem convida: nasce do convite
            pessoa = User.objects.create_user(
                email=dados["email"],
                full_name=dados["full_name"],
                kind=UserKind.CLIENT,
                company=company,
                client_role=dados["client_role"],
                phone=dados["phone"],
                job_title=dados.get("job_title", ""),
            )

        _auditar(
            request, pessoa, acao=AuditAction.CREATE,
            resumo=f"Convite enviado pelo responsável da empresa ({pessoa.email})",
            mudancas={"client_role": [None, pessoa.client_role]},
        )
        # o outbox agenda o envio para DEPOIS do commit: se algo acima
        # falhar, nenhum convite sai para uma conta que não chegou a existir
        send_invite(pessoa)
        return pessoa


class PessoaEmpresaView(APIView):
    """PATCH `me/company/users/<id>/` — ativa/desativa e troca o papel."""

    def _alvo(self, request, pk) -> tuple:
        company = _exigir_responsavel(request)
        alvo = _pessoas(company).filter(pk=pk).first()
        if alvo is None:
            raise NotFound("Pessoa não encontrada nesta empresa.")
        return company, alvo

    @extend_schema(request=AlteracaoPessoaSerializer, responses=PessoaEmpresaSerializer)
    @transaction.atomic
    def patch(self, request, pk):
        company, alvo = self._alvo(request, pk)
        ser = AlteracaoPessoaSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        dados = ser.validated_data

        ativo = dados.get("is_active", alvo.is_active)
        papel = dados.get("client_role", alvo.client_role)
        eu = alvo.pk == request.user.pk

        if eu and not ativo:
            raise ValidationError({"is_active": ["Você não pode desativar a própria conta."]})

        # O invariante é um só, e vale para as duas mudanças: depois dela,
        # sobra pelo menos um responsável ativo. Cobre "tirar o papel do
        # último responsável" (inclusive de si mesmo) sem um caso por caso.
        continua_responsavel = ativo and papel == ClientRole.OWNER
        era_responsavel = alvo.is_active and alvo.client_role == ClientRole.OWNER
        if era_responsavel and not continua_responsavel:
            if _responsaveis_ativos(company, exceto=alvo) == 0:
                raise ValidationError({"detail": SEM_RESPONSAVEL})

        mudancas = {}
        if ativo != alvo.is_active:
            mudancas["is_active"] = [alvo.is_active, ativo]
        if papel != alvo.client_role:
            mudancas["client_role"] = [alvo.client_role, papel]
        if not mudancas:
            return Response(PessoaEmpresaSerializer(alvo, context={"request": request}).data)

        alvo.is_active = ativo
        alvo.client_role = papel
        alvo.save(update_fields=["is_active", "client_role"])

        if "is_active" in mudancas:
            if not ativo:
                _encerrar_sessoes(alvo)
            _auditar(
                request, alvo, acao=AuditAction.STATUS_CHANGE,
                resumo=(
                    f"{'Reativado' if ativo else 'Desativado'} pelo responsável da empresa "
                    f"({alvo.email})"
                ),
                mudancas={"is_active": mudancas["is_active"]},
            )
        if "client_role" in mudancas:
            _auditar(
                request, alvo, acao=AuditAction.UPDATE,
                resumo=f"Papel na empresa alterado pelo responsável ({alvo.email})",
                mudancas={"client_role": mudancas["client_role"]},
            )
        return Response(PessoaEmpresaSerializer(alvo, context={"request": request}).data)


class ReenviarConviteView(APIView):
    """POST `me/company/users/<id>/invite/` — reenvia o convite pendente.

    O link do convite vence em 3 dias; sem reenvio, o responsável teria de
    pedir ao suporte algo que ele mesmo pode resolver.
    """

    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        company = _exigir_responsavel(request)
        alvo = _pessoas(company).filter(pk=pk).first()
        if alvo is None:
            raise NotFound("Pessoa não encontrada nesta empresa.")
        if not alvo.is_active:
            raise ValidationError({"detail": "Reative a pessoa antes de reenviar o convite."})
        if alvo.has_usable_password():
            raise ValidationError({
                "detail": "Esta pessoa já criou a senha. Se esqueceu, ela pode usar "
                "\"Esqueci minha senha\" na tela de entrada."
            })
        send_invite(alvo)
        _auditar(
            request, alvo, acao=AuditAction.UPDATE,
            resumo=f"Convite reenviado pelo responsável da empresa ({alvo.email})",
        )
        return Response({"invited": alvo.email})
