"""`apps/accounts/adapters.py` — as duas regras do login por Google:
allowlist de domínio e "cliente nunca se auto-cadastra por aqui".

Sem simular o handshake OAuth inteiro (isso pediria mockar o Google) — os
adapters são testados diretamente, do jeito que o allauth de fato os chama:
`pre_social_login`/`populate_user`/`save_user` recebem um `sociallogin` e
mexem em `sociallogin.user`. Um dublê simples cobre isso sem precisar de
`SocialAccount`/`SocialLogin` reais persistidos.
"""
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter

from apps.accounts.adapters import AccountAdapter, SocialAccountAdapter
from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db


class FakeSocialLogin:
    """Só o que `pre_social_login` toca: `.user.email`, `.is_existing`,
    `.connect()`."""

    def __init__(self, email: str, is_existing: bool = False):
        self.user = SimpleNamespace(email=email)
        self.is_existing = is_existing
        self.connected_to: User | None = None

    def connect(self, request, user):
        self.connected_to = user


class TestDomainAllowed:
    def test_allowlist_vazia_bloqueia_tudo(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = []
        assert SocialAccountAdapter()._domain_allowed("ana@resolv.com.br") is False

    def test_dominio_na_lista_passa(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        assert SocialAccountAdapter()._domain_allowed("ana@resolv.com.br") is True

    def test_e_case_insensitive_dos_dois_lados(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["Resolv.COM.BR"]
        assert SocialAccountAdapter()._domain_allowed("ana@RESOLV.com.br") is True

    def test_dominio_fora_da_lista_bloqueia(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        assert SocialAccountAdapter()._domain_allowed("ana@gmail.com") is False


class TestPreSocialLogin:
    def test_dominio_fora_da_allowlist_redireciona_com_erro_dominio(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = FakeSocialLogin("ana@gmail.com")
        with pytest.raises(ImmediateHttpResponse) as exc:
            SocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)
        assert exc.value.response.url == "/login?erro=dominio"

    def test_conta_social_ja_existente_so_segue_o_fluxo(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = FakeSocialLogin("ana@resolv.com.br", is_existing=True)
        # não levanta, não tenta conectar (a conta já está ligada)
        SocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)
        assert sociallogin.connected_to is None

    def test_email_de_interno_ativo_ja_existente_conecta_a_conta(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        samuel = User.objects.create_user(
            email="samuel@resolv.com.br", full_name="Samuel",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
        )
        sociallogin = FakeSocialLogin("samuel@resolv.com.br")
        SocialAccountAdapter().pre_social_login(request="req", sociallogin=sociallogin)
        assert sociallogin.connected_to == samuel

    def test_email_de_interno_inativo_redireciona_com_erro_inativo(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        User.objects.create_user(
            email="ex@resolv.com.br", full_name="Ex-funcionário",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
            is_active=False,
        )
        sociallogin = FakeSocialLogin("ex@resolv.com.br")
        with pytest.raises(ImmediateHttpResponse) as exc:
            SocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)
        assert exc.value.response.url == "/login?erro=inativo"

    def test_email_sem_usuario_previo_nao_levanta_segue_pro_signup(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = FakeSocialLogin("novo@resolv.com.br")
        SocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)
        assert sociallogin.connected_to is None

    def test_email_de_cliente_com_mesmo_endereco_nao_conecta(self, settings):
        # a busca é kind=INTERNAL só — um cliente homônimo nunca vira o alvo
        # do connect() de um login de equipe.
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)
        empresa = Company.objects.create(name="Acme", slug="acme", plan=plan)
        User.objects.create_user(
            email="ana@resolv.com.br", full_name="Ana Cliente",
            kind=UserKind.CLIENT, company=empresa,
        )
        sociallogin = FakeSocialLogin("ana@resolv.com.br")
        SocialAccountAdapter().pre_social_login(request=None, sociallogin=sociallogin)
        assert sociallogin.connected_to is None


class TestIsOpenForSignup:
    def test_domino_permitido_pode_criar_conta_nova(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = FakeSocialLogin("novo@resolv.com.br")
        assert SocialAccountAdapter().is_open_for_signup(None, sociallogin) is True

    def test_dominio_fora_da_lista_nao_cria_conta(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = FakeSocialLogin("novo@gmail.com")
        assert SocialAccountAdapter().is_open_for_signup(None, sociallogin) is False


class TestPopulateUser:
    def test_primeiro_login_nasce_agente_interno(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = SimpleNamespace(user=User(email="nova@resolv.com.br"))
        user = SocialAccountAdapter().populate_user(
            request=None, sociallogin=sociallogin,
            data={"email": "nova@resolv.com.br", "name": "Nova Pessoa"},
        )
        assert user.kind == UserKind.INTERNAL
        assert user.internal_role == InternalRole.AGENT
        assert user.full_name == "Nova Pessoa"

    def test_sem_nome_do_google_usa_o_prefixo_do_email(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        sociallogin = SimpleNamespace(user=User(email="prefixo@resolv.com.br"))
        user = SocialAccountAdapter().populate_user(
            request=None, sociallogin=sociallogin, data={"email": "prefixo@resolv.com.br"},
        )
        assert user.full_name == "prefixo"


class TestSaveUser:
    def test_grava_o_sub_do_token_no_google_sub(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        user = User.objects.create_user(
            email="samuel@resolv.com.br", full_name="Samuel",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
        )
        sociallogin = SimpleNamespace(user=user, account=SimpleNamespace(uid="google-sub-123"))
        with patch.object(DefaultSocialAccountAdapter, "save_user", return_value=user):
            SocialAccountAdapter().save_user(request=None, sociallogin=sociallogin)
        user.refresh_from_db()
        assert user.google_sub == "google-sub-123"

    def test_sub_igual_ao_ja_gravado_nao_faz_update_desnecessario(self, settings):
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["resolv.com.br"]
        user = User.objects.create_user(
            email="samuel@resolv.com.br", full_name="Samuel",
            kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
            google_sub="ja-tem",
        )
        sociallogin = SimpleNamespace(user=user, account=SimpleNamespace(uid="ja-tem"))
        with (
            patch.object(DefaultSocialAccountAdapter, "save_user", return_value=user),
            patch.object(User, "save") as save_mock,
        ):
            SocialAccountAdapter().save_user(request=None, sociallogin=sociallogin)
        save_mock.assert_not_called()


class TestAccountAdapterFechaCadastroLocal:
    def test_signup_local_esta_sempre_fechado(self):
        # cliente é criado por convite (admin) — nunca por formulário próprio
        assert AccountAdapter().is_open_for_signup(request=None) is False
