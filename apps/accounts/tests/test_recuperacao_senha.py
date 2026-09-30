""""Esqueci minha senha" — o link por e-mail que troca a senha.

O que este arquivo segura, em ordem de gravidade:

1. o pedido NÃO conta quem tem conta: resposta idêntica para e-mail que
   existe, que não existe, conta inativa e visitante do chat público;
2. visitante do chat público nunca recebe link — senão qualquer um entraria
   no portal de qualquer empresa com chat público (ver recuperacao.py);
3. o link é de uso único, vence rápido e não serve de convite (nem o
   convite serve de link de recuperação);
4. a troca derruba as sessões abertas, não cria sessão nova (o 2FA continua
   valendo no próximo login) e deixa trilha: AccessEvent, AuditLog e o
   e-mail "Sua senha foi alterada".
"""

import datetime as dt
from unittest import mock

import pytest
from django.contrib.auth.tokens import default_token_generator
from django.contrib.sessions.models import Session
from django.test import Client, override_settings
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from apps.accounts.models import AccessEvent, AccessEventKind, TwoFactorMethod, User
from apps.accounts.recuperacao import RESPOSTA_PEDIDO, RecuperacaoTokenGenerator, gerador
from apps.accounts.sessions import live_sessions
from apps.audit.models import AuditLog
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db

PEDIR = "/api/v1/auth/recuperar-senha/"
TROCAR = "/api/v1/auth/redefinir-senha/"
SENHA_BOA = "Frase longa de 2026!"


@pytest.fixture
def anon():
    return APIClient()


@pytest.fixture
def cliente(ana):
    ana.set_password("Senha-antiga-123")
    ana.save()
    return ana


def _link(user, gerador_=gerador) -> dict:
    return {
        "uid": urlsafe_base64_encode(force_bytes(user.pk)),
        "token": gerador_.make_token(user),
    }


def _emails(para: str, template: str = "password_reset"):
    return OutboundEmail.objects.filter(to_email=para, template=template)


class TestPedidoNaoEnumera:
    def test_mesma_resposta_para_conta_que_existe_e_que_nao_existe(self, anon, cliente):
        existe = anon.post(PEDIR, {"email": cliente.email}, format="json")
        nao_existe = anon.post(PEDIR, {"email": "ninguem@acme.test"}, format="json")

        assert existe.status_code == nao_existe.status_code == 200
        assert existe.json() == nao_existe.json() == {"detail": RESPOSTA_PEDIDO}
        assert _emails(cliente.email).count() == 1
        assert not OutboundEmail.objects.filter(to_email="ninguem@acme.test").exists()

    def test_conta_inativa_nao_recebe_nada_e_a_resposta_e_a_mesma(self, anon, cliente):
        cliente.is_active = False
        cliente.save(update_fields=["is_active"])

        resp = anon.post(PEDIR, {"email": cliente.email}, format="json")

        assert resp.status_code == 200
        assert resp.json() == {"detail": RESPOSTA_PEDIDO}
        assert not _emails(cliente.email).exists()

    def test_visitante_do_chat_publico_nao_recebe_link(self, anon, acme):
        """O furo que isto fecharia: conversar no chat do site com o próprio
        e-mail e depois "recuperar" a senha de uma conta que nunca teve."""
        visitante = User.objects.create_user(
            email="curioso@fora.test", full_name="Curioso", kind="client",
            company=acme, client_role="member", is_widget_visitor=True,
        )

        resp = anon.post(PEDIR, {"email": visitante.email}, format="json")

        assert resp.json() == {"detail": RESPOSTA_PEDIDO}
        assert not _emails(visitante.email).exists()

    def test_conta_anonimizada_nao_recebe_link(self, anon, cliente):
        cliente.anonymized_at = timezone.now()
        cliente.save(update_fields=["anonymized_at"])
        anon.post(PEDIR, {"email": cliente.email}, format="json")
        assert not _emails(cliente.email).exists()

    def test_email_malformado_e_400_sem_depender_de_conta(self, anon):
        resp = anon.post(PEDIR, {"email": "isso-nao-e-email"}, format="json")
        assert resp.status_code == 400
        assert resp.json() == {"email": ["Informe um e-mail válido."]}

    def test_maiusculas_no_email_acham_a_mesma_conta(self, anon, cliente):
        anon.post(PEDIR, {"email": "  ANA@Acme.TEST "}, format="json")
        assert _emails(cliente.email).count() == 1

    def test_o_email_sai_em_texto_e_html_com_o_link(
        self, anon, cliente, django_capture_on_commit_callbacks
    ):
        from django.core import mail

        with django_capture_on_commit_callbacks(execute=True):
            anon.post(PEDIR, {"email": cliente.email}, format="json")

        enviado = mail.outbox[-1]
        link = _emails(cliente.email).get().context["link"]
        assert "/login/cliente/redefinir-senha/" in link
        assert link in enviado.body
        assert "vale por 60 minutos" in enviado.body
        html = dict((tipo, corpo) for corpo, tipo in enviado.alternatives)["text/html"]
        assert f'href="{link}"' in html

    def test_agente_interno_tambem_recupera(self, anon, agente_suporte):
        """Sem Google ligado, o agente entra por senha como o cliente."""
        anon.post(PEDIR, {"email": agente_suporte.email}, format="json")
        email = _emails(agente_suporte.email).get()
        assert "/redefinir-senha/" in email.context["link"]
        assert email.subject == "Redefina sua senha"
        assert email.context["valid_minutes"] == 60


class TestTeto:
    def test_por_email_mesmo_trocando_de_ip(self, anon, cliente):
        for i in range(5):
            resp = anon.post(
                PEDIR, {"email": cliente.email}, format="json", REMOTE_ADDR=f"10.0.0.{i}"
            )
            assert resp.status_code == 200
        resp = anon.post(PEDIR, {"email": cliente.email}, format="json", REMOTE_ADDR="10.0.0.99")
        assert resp.status_code == 429
        assert _emails(cliente.email).count() == 5

    def test_o_teto_por_email_vale_para_email_sem_conta(self, anon):
        """Um teto só para quem existe contaria quem existe."""
        for i in range(5):
            anon.post(PEDIR, {"email": "fantasma@x.test"}, format="json", REMOTE_ADDR=f"10.0.1.{i}")
        resp = anon.post(
            PEDIR, {"email": "fantasma@x.test"}, format="json", REMOTE_ADDR="10.0.1.99"
        )
        assert resp.status_code == 429

    def test_por_ip_mesmo_trocando_de_email(self, anon):
        for i in range(10):
            resp = anon.post(
                PEDIR, {"email": f"p{i}@x.test"}, format="json", REMOTE_ADDR="10.9.9.9"
            )
            assert resp.status_code == 200
        resp = anon.post(PEDIR, {"email": "outra@x.test"}, format="json", REMOTE_ADDR="10.9.9.9")
        assert resp.status_code == 429


class TestLink:
    def test_a_tela_confere_o_link_antes_do_formulario(self, anon, cliente):
        resp = anon.get(TROCAR, _link(cliente))
        assert resp.json() == {
            "valid": True, "email": cliente.email, "full_name": cliente.full_name,
            "kind": "client",
        }

    def test_link_valido_troca_a_senha_e_manda_para_o_login_certo(self, anon, cliente):
        resp = anon.post(TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json")

        assert resp.status_code == 200, resp.json()
        assert resp.json()["login"] == "/login/cliente"
        cliente.refresh_from_db()
        assert cliente.check_password(SENHA_BOA)

    def test_uso_unico(self, anon, cliente):
        link = _link(cliente)
        primeira = anon.post(TROCAR, {**link, "new_password": SENHA_BOA}, format="json")
        assert primeira.status_code == 200

        resp = anon.post(TROCAR, {**link, "new_password": "Outra frase 2026!"}, format="json")

        assert resp.status_code == 400
        assert resp.json()["code"] == "link_invalido"
        assert anon.get(TROCAR, link).json() == {"valid": False}
        cliente.refresh_from_db()
        assert cliente.check_password(SENHA_BOA)

    def test_vence_em_uma_hora(self, anon, cliente):
        link = _link(cliente)
        depois = dt.datetime.now() + dt.timedelta(minutes=61)
        with mock.patch.object(RecuperacaoTokenGenerator, "_now", return_value=depois):
            resp = anon.post(TROCAR, {**link, "new_password": SENHA_BOA}, format="json")
        assert resp.status_code == 400
        assert resp.json()["code"] == "link_invalido"

    def test_ainda_vale_antes_de_uma_hora(self, anon, cliente):
        link = _link(cliente)
        depois = dt.datetime.now() + dt.timedelta(minutes=50)
        with mock.patch.object(RecuperacaoTokenGenerator, "_now", return_value=depois):
            assert anon.get(TROCAR, link).json()["valid"] is True

    def test_convite_e_recuperacao_nao_servem_um_pelo_outro(self, anon, cliente):
        convite = _link(cliente, default_token_generator)
        resp = anon.post(TROCAR, {**convite, "new_password": SENHA_BOA}, format="json")
        assert resp.status_code == 400

        recuperacao = _link(cliente)
        resp = anon.post(
            "/api/v1/auth/definir-senha/", {**recuperacao, "password": SENHA_BOA}, format="json"
        )
        assert resp.status_code == 400

    def test_conta_desativada_depois_do_pedido_perde_o_link(self, anon, cliente):
        link = _link(cliente)
        cliente.is_active = False
        cliente.save(update_fields=["is_active"])
        resp = anon.post(TROCAR, {**link, "new_password": SENHA_BOA}, format="json")
        assert resp.status_code == 400

    def test_uid_lixo_nao_estoura(self, anon):
        resp = anon.post(
            TROCAR, {"uid": "@@@", "token": "x-y", "new_password": SENHA_BOA}, format="json"
        )
        assert resp.status_code == 400


class TestValidadores:
    def test_senha_fraca_volta_com_os_motivos_e_o_link_continua_valendo(self, anon, cliente):
        link = _link(cliente)
        resp = anon.post(TROCAR, {**link, "new_password": "curta"}, format="json")

        assert resp.status_code == 400
        motivos = resp.json()["new_password"]
        assert any("12 caracteres" in m for m in motivos)
        cliente.refresh_from_db()
        assert cliente.check_password("Senha-antiga-123")
        # errar a senha nova não queima o link
        assert anon.get(TROCAR, link).json()["valid"] is True

    def test_senha_parecida_com_o_email_e_recusada(self, anon, cliente):
        resp = anon.post(
            TROCAR, {**_link(cliente), "new_password": "ana@acme.test1A"}, format="json"
        )
        assert resp.status_code == 400
        assert "new_password" in resp.json()


class TestDepoisDaTroca:
    def _logar(self, user) -> Client:
        c = Client()
        c.force_login(user)
        return c

    def test_encerra_todas_as_sessoes_abertas(self, anon, cliente, beto):
        self._logar(cliente)
        self._logar(cliente)
        outra = self._logar(beto)
        assert len(live_sessions(cliente)) == 2

        anon.post(TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json")

        assert live_sessions(cliente) == []
        # a de outra pessoa fica
        assert Session.objects.filter(session_key=outra.session.session_key).exists()

    def test_nao_cria_sessao(self, anon, cliente):
        anon.post(TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json")
        assert anon.get("/api/v1/auth/me/").status_code in (401, 403)

    def test_o_2fa_continua_valendo_no_proximo_login(self, anon, cliente):
        cliente.two_factor_method = TwoFactorMethod.EMAIL
        cliente.save(update_fields=["two_factor_method"])
        anon.post(TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json")

        resp = APIClient().post(
            "/api/v1/auth/login/", {"email": cliente.email, "password": SENHA_BOA}, format="json"
        )
        assert resp.json() == {"two_factor": "email"}

    def test_deixa_trilha_e_avisa_por_email(self, anon, cliente):
        AccessEvent.objects.filter(user=cliente).delete()  # a senha da fixture
        anon.post(
            TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json",
            REMOTE_ADDR="10.1.2.3", HTTP_USER_AGENT="Firefox de teste",
        )

        eventos = AccessEvent.objects.filter(user=cliente, kind=AccessEventKind.PASSWORD_CHANGED)
        assert eventos.count() == 1  # uma vez só, e com o aparelho de quem trocou
        assert eventos.get().ip == "10.1.2.3"

        log = AuditLog.objects.get(object_id=str(cliente.pk), summary__icontains="recuperação")
        assert log.actor == cliente
        assert log.ip_address == "10.1.2.3"

        aviso = _emails(cliente.email, "password_changed").get()
        assert aviso.subject == "Sua senha foi alterada"
        assert aviso.context["email"] == cliente.email

    @override_settings(AXES_ENABLED=True, AXES_FAILURE_LIMIT=3)
    def test_destrava_o_login_travado_neste_aparelho(self, anon, cliente):
        from axes.helpers import get_cache

        get_cache().clear()
        login = APIClient()
        for _ in range(3):
            login.post("/api/v1/auth/login/", {"email": cliente.email, "password": "errada"})
        travado = login.post("/api/v1/auth/login/", {"email": cliente.email, "password": "errada"})
        assert travado.status_code == 429

        anon.post(TROCAR, {**_link(cliente), "new_password": SENHA_BOA}, format="json")

        resp = login.post("/api/v1/auth/login/", {"email": cliente.email, "password": SENHA_BOA})
        assert resp.status_code == 200, resp.json()
