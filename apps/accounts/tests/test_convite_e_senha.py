"""O convite tem de LEVAR a algum lugar.

Este arquivo cobre o buraco mais caro que a tela de usuários tinha: dava para
criar conta, mas não dava para usar nenhuma delas.

Dois defeitos somados:

1. o link do convite apontava para `/portal/definir-senha/<uid>/<token>/` — uma
   rota que não existia na SPA e que não tinha endpoint no backend. Quem
   clicava caía no login sem ter senha para digitar;
2. usuário INTERNO nem convite recebia, porque o código assumia que ele "entra
   por Google" — premissa da arquitetura, não da configuração. Com o allauth
   desligado (o estado atual), todo agente criado nascia sem senha e sem Google,
   trancado para fora sem nenhum aviso na tela.

O resultado prático era o mesmo nos dois casos e era silencioso: a conta
aparecia na lista com cara de pronta.
"""

import pytest
from django.contrib.auth.tokens import default_token_generator
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APIClient

from apps.accounts.admin_api import login_por_google_ativo
from apps.accounts.models import AgentTeam, InternalRole, User, UserKind
from apps.customers.models import Company, Plan
from apps.notifications.models import OutboundEmail

pytestmark = pytest.mark.django_db


@pytest.fixture
def api_anon(db):
    """Cliente SEM sessão: é assim que quem abre o convite chega."""
    return APIClient()


def _link_de(user) -> dict:
    return {
        "uid": urlsafe_base64_encode(force_bytes(user.pk)),
        "token": default_token_generator.make_token(user),
    }


class TestOConviteAlcancaQuemPrecisa:
    def test_agente_criado_pela_equipe_recebe_convite(self, api, admin, suporte):
        """O caminho mais usado: "+ Adicionar agente" dentro da equipe."""
        resp = api(admin).post(
            f"/api/v1/settings/teams/{suporte.pk}/agents/",
            {"full_name": "Nina Novata", "email": "nina@x.test"}, format="json",
        )
        assert resp.status_code == 201, resp.data

        nina = User.objects.get(email="nina@x.test")
        assert not nina.has_usable_password()
        assert AgentTeam.objects.filter(user=nina, team=suporte).exists()
        convite = OutboundEmail.objects.filter(to_email="nina@x.test").latest("id")
        assert "definir-senha" in convite.context["link"]

    def test_usuario_criado_pela_tela_de_usuarios_recebe_convite(self, api, admin):
        resp = api(admin).post(
            "/api/v1/settings/users/",
            {
                "full_name": "Ivo Interno", "email": "ivo@x.test",
                "kind": UserKind.INTERNAL, "internal_role": InternalRole.AGENT,
            },
            format="json",
        )
        assert resp.status_code == 201, resp.data
        assert OutboundEmail.objects.filter(to_email="ivo@x.test").exists()

    def test_a_lista_mostra_o_convite_pendente(self, api, admin, suporte):
        """"ativo" não é "consegue entrar" — a lista tem de separar as duas."""
        api(admin).post(
            f"/api/v1/settings/teams/{suporte.pk}/agents/",
            {"full_name": "Nina Novata", "email": "nina@x.test"}, format="json",
        )
        linha = next(
            u for u in api(admin).get("/api/v1/settings/users/").data["results"]
            if u["email"] == "nina@x.test"
        )
        assert linha["invite_status"] == "pendente"

    def test_reenviar_convite_vale_para_interno(self, api, admin, agente_suporte):
        """O primeiro e-mail se perde; sem reenvio a conta morria ali."""
        resp = api(admin).post(f"/api/v1/settings/users/{agente_suporte.pk}/invite/")
        assert resp.status_code == 200, resp.data
        assert OutboundEmail.objects.filter(to_email=agente_suporte.email).exists()


class TestDefinirSenha:
    URL = "/api/v1/auth/definir-senha/"

    def test_o_link_valido_deixa_definir_a_senha(self, api_anon, admin, suporte):
        nova = User.objects.create_user(
            email="nina@x.test", full_name="Nina", kind=UserKind.INTERNAL,
            internal_role=InternalRole.AGENT,
        )
        nova.set_unusable_password()
        nova.save(update_fields=["password"])

        resp = api_anon.post(
            self.URL, {**_link_de(nova), "password": "SenhaBoa!2026"}, format="json"
        )
        assert resp.status_code == 200, resp.data
        nova.refresh_from_db()
        assert nova.check_password("SenhaBoa!2026")

    def test_a_tela_confere_o_link_antes_de_pedir_a_senha(self, api_anon, ana):
        """Descobrir que o convite venceu DEPOIS de digitar duas vezes é o
        pior momento possível."""
        resp = api_anon.get(self.URL, _link_de(ana))
        assert resp.status_code == 200
        assert resp.data["valid"] is True
        assert resp.data["email"] == ana.email

    def test_token_invalido_e_recusado(self, api_anon, ana):
        alvo = _link_de(ana)
        resp = api_anon.post(
            self.URL, {**alvo, "token": "nao-presta", "password": "SenhaBoa!2026"},
            format="json",
        )
        assert resp.status_code == 400
        ana.refresh_from_db()
        assert not ana.check_password("SenhaBoa!2026")

    def test_o_token_e_de_uso_unico(self, api_anon, ana):
        """Definir a senha invalida o hash que gerou o token — o mesmo link
        não serve para uma segunda troca."""
        alvo = _link_de(ana)
        primeira = api_anon.post(
            self.URL, {**alvo, "password": "SenhaBoa!2026"}, format="json"
        )
        assert primeira.status_code == 200

        segunda = api_anon.post(
            self.URL, {**alvo, "password": "OutraSenha!2026"}, format="json"
        )
        assert segunda.status_code == 400
        ana.refresh_from_db()
        assert ana.check_password("SenhaBoa!2026")

    def test_senha_fraca_e_recusada_com_motivo(self, api_anon, ana):
        resp = api_anon.post(
            self.URL, {**_link_de(ana), "password": "123"}, format="json"
        )
        assert resp.status_code == 400
        assert resp.data["password"], "a pessoa precisa saber POR QUE foi recusada"

    def test_definir_a_senha_nao_entra_no_sistema(self, api_anon, ana):
        """O segundo fator é obrigatório em todo login; entrar por aqui seria
        uma porta que o pula."""
        api_anon.post(self.URL, {**_link_de(ana), "password": "SenhaBoa!2026"},
                      format="json")
        assert api_anon.get("/api/v1/auth/me/").status_code in (401, 403)

    def test_conta_desativada_nao_define_senha(self, api_anon, ana):
        """Desativar é tirar o acesso; um convite antigo não pode devolvê-lo."""
        alvo = _link_de(ana)
        ana.is_active = False
        ana.save(update_fields=["is_active"])
        resp = api_anon.post(self.URL, {**alvo, "password": "SenhaBoa!2026"},
                             format="json")
        assert resp.status_code == 400


# ────────────────────────────────────────────────────────────────────────
# Trocar a PRÓPRIA senha (me/password/)
#
# O gêmeo self-service do convite: lá a prova de identidade é o token do
# e-mail, aqui é a senha atual. O que este bloco protege é a diferença entre
# as duas — e o efeito colateral que quebraria a tela sem ninguém notar até
# a próxima requisição (a sessão caindo depois de trocar a senha).
# ────────────────────────────────────────────────────────────────────────

class TestTrocarPropriaSenha:
    @pytest.fixture
    def empresa(self, db):
        # cliente sem empresa esbarra na constraint `client_requires_company`
        plano = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)
        return Company.objects.create(name="Casa", slug="casa", plan=plano)

    @pytest.fixture
    def cliente(self, empresa):
        u = User.objects.create_user(
            email="fabiana@casa.test", full_name="Fabiana", kind=UserKind.CLIENT,
            company=empresa, password="senhaAntiga!2026",
        )
        api = APIClient()
        api.force_authenticate(u)
        return u, api

    def test_troca_com_a_senha_atual_certa(self, cliente):
        user, api = cliente
        resp = api.post("/api/v1/me/password/", {
            "current_password": "senhaAntiga!2026",
            "new_password": "outraSenha!2026",
        }, format="json")

        assert resp.status_code == 200
        user.refresh_from_db()
        assert user.check_password("outraSenha!2026")

    def test_senha_atual_errada_recusa_e_nao_troca(self, cliente):
        user, api = cliente
        resp = api.post("/api/v1/me/password/", {
            "current_password": "chutei",
            "new_password": "outraSenha!2026",
        }, format="json")

        assert resp.status_code == 400
        assert "current_password" in resp.data
        user.refresh_from_db()
        assert user.check_password("senhaAntiga!2026")

    def test_senha_nova_fraca_passa_pelos_validadores_do_django(self, cliente):
        user, api = cliente
        resp = api.post("/api/v1/me/password/", {
            "current_password": "senhaAntiga!2026",
            "new_password": "123",
        }, format="json")

        assert resp.status_code == 400
        assert "new_password" in resp.data
        user.refresh_from_db()
        assert user.check_password("senhaAntiga!2026")

    def test_anonimo_nao_troca_senha_de_ninguem(self, api_anon):
        resp = api_anon.post("/api/v1/me/password/", {
            "current_password": "x", "new_password": "y",
        }, format="json")
        assert resp.status_code in (401, 403)

    def test_a_sessao_de_quem_trocou_continua_valendo(self, empresa, client):
        """`set_password` invalida o hash da sessão. Sem
        `update_session_auth_hash` a pessoa é deslogada no request seguinte —
        e a tela promete exatamente o contrário."""
        User.objects.create_user(
            email="ana@casa.test", full_name="Ana", kind=UserKind.CLIENT,
            company=empresa, password="senhaAntiga!2026",
        )
        assert client.login(email="ana@casa.test", password="senhaAntiga!2026")

        resp = client.post(
            "/api/v1/me/password/",
            data={"current_password": "senhaAntiga!2026", "new_password": "outraSenha!2026"},
            content_type="application/json",
        )
        assert resp.status_code == 200
        # mesma sessão, request novo: continua autenticada
        assert client.get("/api/v1/auth/me/").status_code == 200


class TestLoginPorGoogleAtivo:
    """As DUAS condições importam — backend registrado sozinho não basta
    (é exatamente o bug que este arquivo documenta no topo, versão nova:
    religar o allauth em código sem configurar a allowlist trancaria o
    agente para fora de novo, só que agora com `invite_status` mentindo
    que está tudo bem)."""

    def test_sem_allauth_no_backend_esta_desligado(self, settings):
        settings.AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["x.test"]
        assert login_por_google_ativo() is False

    def test_com_allauth_mas_allowlist_vazia_continua_desligado(self, settings):
        settings.AUTHENTICATION_BACKENDS = [
            "django.contrib.auth.backends.ModelBackend",
            "allauth.account.auth_backends.AuthenticationBackend",
        ]
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = []
        assert login_por_google_ativo() is False

    def test_com_as_duas_coisas_esta_ligado(self, settings):
        settings.AUTHENTICATION_BACKENDS = [
            "django.contrib.auth.backends.ModelBackend",
            "allauth.account.auth_backends.AuthenticationBackend",
        ]
        settings.GOOGLE_OAUTH_ALLOWED_DOMAINS = ["x.test"]
        assert login_por_google_ativo() is True
