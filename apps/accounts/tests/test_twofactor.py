"""Verificação em duas etapas: TOTP puro, o fluxo de login em duas etapas e a
ativação/desativação pelo próprio usuário.

O que estas travas protegem: senha certa sozinha NÃO cria sessão quando o 2FA
está ligado; o método só ativa depois de um código válido (nunca "meio
ativado"); e código errado tem teto de tentativas — sem isso o segundo fator
vira só um atraso de força bruta.
"""

import base64
import datetime as dt

import pytest
from rest_framework.test import APIClient

from apps.accounts import twofactor
from apps.accounts.models import (
    InternalRole,
    LoginCode,
    TwoFactorMethod,
    User,
    UserKind,
)
from apps.accounts.views import PENDING_2FA_KEY
from apps.audit.models import AuditLog
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db

SENHA = "senha-forte"

# vetor do RFC 6238 (Apêndice B): segredo ASCII "1234…890", SHA-1. Os valores
# publicados têm 8 dígitos; com 6 valem os últimos seis — é o mesmo truncamento.
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()


@pytest.fixture
def cliente_2fa_email(acme):
    user = User.objects.create_user(
        email="dois@acme.test", password=SENHA, full_name="Dois Fatores",
        kind=UserKind.CLIENT, company=acme,
    )
    user.two_factor_method = TwoFactorMethod.EMAIL
    user.save(update_fields=["two_factor_method"])
    return user


@pytest.fixture
def agente_2fa_totp(db):
    user = User.objects.create_user(
        email="totp@agencia.com.br", password=SENHA, full_name="Toni Totp",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )
    user.two_factor_method = TwoFactorMethod.TOTP
    user.totp_secret = twofactor.generate_secret()
    user.save(update_fields=["two_factor_method", "totp_secret"])
    return user


def _login(client, email, senha=SENHA):
    return client.post(
        "/api/v1/auth/login/", {"email": email, "password": senha}, format="json"
    )


def _codigo_no_banco(user, purpose=LoginCode.Purpose.LOGIN) -> str:
    return (
        LoginCode.objects.filter(user=user, purpose=purpose, used_at__isnull=True)
        .latest("created_at")
        .code
    )


class TestTOTP:
    """RFC 6238 contra os vetores publicados + janela de tolerância."""

    @pytest.mark.parametrize("momento, esperado", [
        (59, "287082"),           # RFC: 94287082
        (1111111109, "081804"),   # RFC: 07081804
        (1234567890, "005924"),   # RFC: 89005924
        (2000000000, "279037"),   # RFC: 69279037
    ])
    def test_vetores_do_rfc(self, momento, esperado):
        assert twofactor.totp_code(RFC_SECRET, at=momento) == esperado

    def test_aceita_deriva_de_uma_janela(self):
        codigo = twofactor.totp_code(RFC_SECRET, at=1_000_000)
        # relógio do celular até 29s atrás/à frente ainda vale…
        assert twofactor.verify_totp(RFC_SECRET, codigo, at=1_000_000 - 29)
        assert twofactor.verify_totp(RFC_SECRET, codigo, at=1_000_000 + 29)
        # …mas 3 janelas depois, não
        assert not twofactor.verify_totp(RFC_SECRET, codigo, at=1_000_000 + 90)

    def test_recusa_segredo_errado_e_lixo(self):
        codigo = twofactor.totp_code(RFC_SECRET, at=1_000_000)
        outro = twofactor.generate_secret()
        assert not twofactor.verify_totp(outro, codigo, at=1_000_000)
        assert not twofactor.verify_totp(RFC_SECRET, "abcdef", at=1_000_000)
        assert not twofactor.verify_totp(RFC_SECRET, "12345", at=1_000_000)
        assert not twofactor.verify_totp("", codigo, at=1_000_000)

    def test_uri_do_autenticador(self):
        uri = twofactor.otpauth_uri(secret_b32=RFC_SECRET, email="ana@acme.test")
        assert uri.startswith("otpauth://totp/Resolv%3Aana%40acme.test?")
        assert f"secret={RFC_SECRET}" in uri
        assert "issuer=Resolv" in uri


class TestLoginComDoisFatores:
    def test_2fa_e_obrigatorio_mesmo_sem_configurar(self, acme):
        """Decisão do Izaque: NINGUÉM entra só com a senha. Quem nunca
        configurou nada cai no código por e-mail — a conta sempre tem e-mail."""
        user = User.objects.create_user(
            email="normal@acme.test", password=SENHA, full_name="Normal",
            kind=UserKind.CLIENT, company=acme,
        )
        client = APIClient()
        resp = _login(client, "normal@acme.test")
        assert resp.status_code == 200
        assert resp.json() == {"two_factor": "email"}
        # sem o código, sem sessão
        assert client.get("/api/v1/auth/me/").status_code in (401, 403)
        # e o código chega por e-mail e completa o login
        codigo = _codigo_no_banco(user)
        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        assert client.get("/api/v1/auth/me/").status_code == 200

    def test_senha_certa_nao_loga_pede_o_codigo(self, cliente_2fa_email):
        client = APIClient()
        resp = _login(client, cliente_2fa_email.email)
        assert resp.status_code == 200
        assert resp.json() == {"two_factor": "email"}
        # a sessão NÃO está autenticada — o código é obrigatório
        assert client.get("/api/v1/auth/me/").status_code in (401, 403)
        # o código foi para o outbox, nunca no corpo da resposta
        email = OutboundEmail.objects.get(template="login_code")
        assert email.to_email == cliente_2fa_email.email
        assert email.context["code"] in email.subject

    def test_codigo_certo_completa_o_login(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        codigo = _codigo_no_banco(cliente_2fa_email)

        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        assert resp.json()["email"] == cliente_2fa_email.email
        assert client.get("/api/v1/auth/me/").status_code == 200

    def test_codigo_errado_recusa_e_nao_loga(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        resp = client.post("/api/v1/auth/2fa/", {"code": "000000"}, format="json")
        assert resp.status_code == 400
        assert "inválido" in resp.json()["detail"]
        assert client.get("/api/v1/auth/me/").status_code in (401, 403)

    def test_cinco_erros_matam_o_codigo(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        codigo = _codigo_no_banco(cliente_2fa_email)
        for _ in range(5):
            client.post("/api/v1/auth/2fa/", {"code": "000000"}, format="json")
        # mesmo o código VERDADEIRO já não vale — só recomeçando o login
        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        assert resp.status_code == 400
        assert client.get("/api/v1/auth/me/").status_code in (401, 403)

    def test_pendencia_expirada_manda_recomecar(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        codigo = _codigo_no_banco(cliente_2fa_email)

        # envelhece o estado pendente além dos 5 minutos
        session = client.session
        pendente = session[PENDING_2FA_KEY]
        antigo = dt.datetime.fromisoformat(pendente["at"]) - dt.timedelta(minutes=6)
        pendente["at"] = antigo.isoformat()
        session[PENDING_2FA_KEY] = pendente
        session.save()

        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        assert resp.status_code == 400
        assert "expirou" in resp.json()["detail"]

    def test_verificar_sem_login_pendente_recusa(self):
        resp = APIClient().post("/api/v1/auth/2fa/", {"code": "123456"}, format="json")
        assert resp.status_code == 400

    def test_reenviar_emite_codigo_novo_e_invalida_o_anterior(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        primeiro = _codigo_no_banco(cliente_2fa_email)

        assert client.post("/api/v1/auth/2fa/resend/").status_code == 200
        segundo = _codigo_no_banco(cliente_2fa_email)
        assert LoginCode.objects.filter(
            user=cliente_2fa_email, purpose=LoginCode.Purpose.LOGIN,
            used_at__isnull=True,
        ).count() == 1  # só o último vale
        if primeiro != segundo:  # colisão aleatória de 6 dígitos é possível
            resp = client.post("/api/v1/auth/2fa/", {"code": primeiro}, format="json")
            assert resp.status_code == 400

    def test_totp_da_janela_atual_loga(self, agente_2fa_totp):
        client = APIClient()
        resp = _login(client, agente_2fa_totp.email)
        assert resp.json() == {"two_factor": "totp"}
        # TOTP não manda e-mail nenhum
        assert not OutboundEmail.objects.filter(template="login_code").exists()

        codigo = twofactor.totp_code(agente_2fa_totp.totp_secret)
        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        assert client.get("/api/v1/auth/me/").status_code == 200

    def test_totp_errado_nao_loga(self, agente_2fa_totp):
        client = APIClient()
        _login(client, agente_2fa_totp.email)
        resp = client.post("/api/v1/auth/2fa/", {"code": "000000"}, format="json")
        assert resp.status_code == 400
        assert client.get("/api/v1/auth/me/").status_code in (401, 403)


class TestAtivarDesativar:
    """Gestão do próprio método em /auth/2fa/setup|confirm|disable."""

    @pytest.fixture
    def logado(self, acme):
        user = User.objects.create_user(
            email="gerir@acme.test", password=SENHA, full_name="Gerir",
            kind=UserKind.CLIENT, company=acme,
        )
        client = APIClient()
        # 2FA obrigatório: o login de verdade tem sempre as DUAS etapas
        assert _login(client, user.email).status_code == 200
        codigo = _codigo_no_banco(user)
        assert client.post(
            "/api/v1/auth/2fa/", {"code": codigo}, format="json"
        ).status_code == 200
        return user, client

    def test_exige_autenticacao(self):
        anon = APIClient()
        for rota in ("status/", "setup/", "confirm/", "disable/", "request-code/"):
            resp = anon.post(f"/api/v1/auth/2fa/{rota}", {}, format="json")
            if rota == "status/":
                resp = anon.get("/api/v1/auth/2fa/status/")
            assert resp.status_code in (401, 403), rota

    def test_totp_so_ativa_depois_do_codigo_confirmado(self, logado):
        user, client = logado
        resp = client.post(
            "/api/v1/auth/2fa/setup/", {"method": "totp"}, format="json"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["otpauth_uri"].startswith("otpauth://totp/")
        user.refresh_from_db()
        assert user.two_factor_method == ""  # setup sozinho não liga nada

        # código errado não ativa
        resp = client.post("/api/v1/auth/2fa/confirm/", {"code": "000000"}, format="json")
        assert resp.status_code == 400

        codigo = twofactor.totp_code(body["secret"])
        resp = client.post("/api/v1/auth/2fa/confirm/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.two_factor_method == "totp"
        assert user.totp_secret == body["secret"]
        # trilha de auditoria da ativação
        assert AuditLog.objects.filter(
            actor=user, summary__icontains="duas etapas ativada"
        ).exists()

    def test_email_ativa_com_codigo_enviado_ao_proprio_email(self, logado):
        user, client = logado
        resp = client.post("/api/v1/auth/2fa/setup/", {"method": "email"}, format="json")
        assert resp.status_code == 200
        # o login (2FA obrigatório) já mandou um código — o do SETUP é o último
        email = OutboundEmail.objects.filter(template="login_code").latest("id")
        assert email.to_email == user.email

        codigo = LoginCode.objects.get(
            user=user, purpose=LoginCode.Purpose.SETUP, used_at__isnull=True
        ).code
        resp = client.post("/api/v1/auth/2fa/confirm/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.two_factor_method == "email"

    def test_metodo_invalido_recusado(self, logado):
        _, client = logado
        resp = client.post("/api/v1/auth/2fa/setup/", {"method": "sms"}, format="json")
        assert resp.status_code == 400

    def test_desativar_exige_codigo_valido(self, agente_2fa_totp):
        client = APIClient()
        _login(client, agente_2fa_totp.email)
        codigo = twofactor.totp_code(agente_2fa_totp.totp_secret)
        client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")

        resp = client.post("/api/v1/auth/2fa/disable/", {"code": "000000"}, format="json")
        assert resp.status_code == 400
        agente_2fa_totp.refresh_from_db()
        assert agente_2fa_totp.two_factor_method == "totp"

        # a mesma janela ainda vale (uso único é do código por e-mail)
        resp = client.post(
            "/api/v1/auth/2fa/disable/",
            {"code": twofactor.totp_code(agente_2fa_totp.totp_secret)},
            format="json",
        )
        assert resp.status_code == 200
        agente_2fa_totp.refresh_from_db()
        assert agente_2fa_totp.two_factor_method == ""
        assert agente_2fa_totp.totp_secret == ""
        assert AuditLog.objects.filter(
            actor=agente_2fa_totp, summary__icontains="desativada"
        ).exists()

    def test_desativar_por_email_usa_codigo_proprio(self, cliente_2fa_email):
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        client.post(
            "/api/v1/auth/2fa/",
            {"code": _codigo_no_banco(cliente_2fa_email)}, format="json",
        )

        assert client.post("/api/v1/auth/2fa/request-code/").status_code == 200
        codigo = _codigo_no_banco(cliente_2fa_email, LoginCode.Purpose.DISABLE)
        resp = client.post("/api/v1/auth/2fa/disable/", {"code": codigo}, format="json")
        assert resp.status_code == 200
        cliente_2fa_email.refresh_from_db()
        assert cliente_2fa_email.two_factor_method == ""


class TestCodigoMestreDeDesenvolvimento:
    """O código fixo de dev (`123456`) e — o que importa — o cerco dele.

    Ele existe para não ter de caçar seis dígitos no terminal a cada login
    local. Como é um código que entra em QUALQUER conta, o que estes testes
    guardam não é o atalho: é a garantia de que ele morre fora de DEBUG. A
    suíte roda com DEBUG=False (config/settings/test.py), então o caso
    "não vale" é o comportamento padrão aqui, e é o primeiro teste.
    """

    def test_nao_vale_com_debug_desligado(self, settings, cliente_2fa_email):
        # a variável até existe — o que barra é o DEBUG
        settings.TWO_FACTOR_DEV_CODE = "123456"
        settings.DEBUG = False
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        resp = client.post("/api/v1/auth/2fa/", {"code": "123456"}, format="json")
        assert resp.status_code == 400
        # e a sessão não nasceu
        assert client.get("/api/v1/auth/me/").status_code == 403

    def test_vale_em_dev(self, settings, cliente_2fa_email):
        settings.DEBUG = True
        settings.TWO_FACTOR_DEV_CODE = "123456"
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        resp = client.post("/api/v1/auth/2fa/", {"code": "123456"}, format="json")
        assert resp.status_code == 200
        assert client.get("/api/v1/auth/me/").status_code == 200

    def test_vazio_desliga_o_atalho(self, settings, cliente_2fa_email):
        settings.DEBUG = True
        settings.TWO_FACTOR_DEV_CODE = ""
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        # nem o código vazio nem um palpite passam — volta a valer só o real
        assert client.post(
            "/api/v1/auth/2fa/", {"code": ""}, format="json",
        ).status_code == 400
        assert client.post(
            "/api/v1/auth/2fa/", {"code": "123456"}, format="json",
        ).status_code == 400

    def test_o_codigo_de_verdade_continua_valendo(self, settings, cliente_2fa_email):
        settings.DEBUG = True
        settings.TWO_FACTOR_DEV_CODE = "123456"
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        resp = client.post(
            "/api/v1/auth/2fa/",
            {"code": _codigo_no_banco(cliente_2fa_email)}, format="json",
        )
        assert resp.status_code == 200

    def test_nao_serve_para_desativar_o_2fa_de_ninguem(self, settings, cliente_2fa_email):
        """Entrar em dev é uma coisa; MEXER na verificação da conta é outra.

        `2fa/disable/` passa pelo mesmo `_conferir_codigo`, então o mestre
        também abre essa porta — em dev, com sessão de dev, o que é aceitável.
        Fora de DEBUG, não: é este o caso que o teste fixa.
        """
        settings.DEBUG = False
        settings.TWO_FACTOR_DEV_CODE = "123456"
        client = APIClient()
        _login(client, cliente_2fa_email.email)
        client.post(
            "/api/v1/auth/2fa/",
            {"code": _codigo_no_banco(cliente_2fa_email)}, format="json",
        )
        resp = client.post("/api/v1/auth/2fa/disable/", {"code": "123456"}, format="json")
        assert resp.status_code == 400
        cliente_2fa_email.refresh_from_db()
        assert cliente_2fa_email.two_factor_method == TwoFactorMethod.EMAIL
