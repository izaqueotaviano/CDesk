"""Histórico de acesso por usuário (tela do admin em Configurações → Usuários).

O que estas travas protegem: o histórico registra o que aconteceu de verdade
(login, tentativa falha, troca de senha) SEM vazar nada na resposta pública do
login — e só admin lê, porque IP e dispositivo de cada acesso é dado de
investigação, não de operação.
"""

import pytest
from django.contrib.sessions.models import Session
from rest_framework.test import APIClient

from apps.accounts.models import AccessEvent, AccessEventKind, User, UserKind
from apps.accounts.sessions import browser_of, live_sessions

pytestmark = pytest.mark.django_db

SENHA = "senha-forte"

UA_CHROME_WIN = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


@pytest.fixture
def cliente_ana(acme):
    return User.objects.create_user(
        email="ana.hist@acme.test", password=SENHA, full_name="Ana Histórico",
        kind=UserKind.CLIENT, company=acme,
    )


def _login(email, senha=SENHA, ua=UA_CHROME_WIN):
    """Login COMPLETO: senha + código do 2FA obrigatório. Senha errada devolve
    a resposta da primeira etapa (o fluxo nem chega ao código)."""
    from apps.accounts.models import LoginCode

    client = APIClient(HTTP_USER_AGENT=ua)
    resp = client.post(
        "/api/v1/auth/login/", {"email": email, "password": senha}, format="json"
    )
    if resp.status_code != 200 or "two_factor" not in resp.json():
        return client, resp
    user = User.objects.get(email=email)
    codigo = (
        LoginCode.objects.filter(
            user=user, purpose=LoginCode.Purpose.LOGIN, used_at__isnull=True
        ).latest("created_at").code
    )
    resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
    return client, resp


class TestRegistroDeEventos:
    def test_login_com_sucesso_registra_com_ip_e_navegador(self, cliente_ana):
        _, resp = _login(cliente_ana.email)
        assert resp.status_code == 200

        evento = cliente_ana.access_events.get()
        assert evento.kind == AccessEventKind.LOGIN
        assert evento.ip  # o test client sempre traz REMOTE_ADDR
        assert "Chrome" in evento.user_agent

    def test_senha_errada_registra_sem_vazar_na_resposta(self, cliente_ana):
        _, resp = _login(cliente_ana.email, senha="errada")
        assert resp.status_code == 400

        assert cliente_ana.access_events.filter(
            kind=AccessEventKind.LOGIN_FAILED
        ).exists()
        # a resposta é idêntica à de e-mail inexistente — nada denuncia a conta
        _, resp_fantasma = _login("nao-existe@acme.test", senha="errada")
        assert resp_fantasma.status_code == 400
        assert resp_fantasma.json() == resp.json()

    def test_email_inexistente_nao_cria_evento(self, db):
        antes = AccessEvent.objects.count()
        _login("fantasma@acme.test", senha="qualquer")
        assert AccessEvent.objects.count() == antes

    def test_trocar_senha_registra(self, cliente_ana):
        cliente_ana.set_password("outra-senha")
        cliente_ana.save(update_fields=["password"])
        assert cliente_ana.access_events.filter(
            kind=AccessEventKind.PASSWORD_CHANGED
        ).exists()

    def test_criar_usuario_nao_registra_troca(self, acme):
        novo = User.objects.create_user(
            email="recente@acme.test", password=SENHA, full_name="Recente",
            kind=UserKind.CLIENT, company=acme,
        )
        # definir a primeira senha na criação não é o evento que o admin procura
        assert not novo.access_events.filter(
            kind=AccessEventKind.PASSWORD_CHANGED
        ).exists()


class TestEndpointDoAdmin:
    def _url(self, user):
        return f"/api/v1/settings/users/{user.pk}/access-history/"

    def test_so_admin_le(self, admin, agente_suporte, cliente_ana, api):
        assert api(agente_suporte).get(self._url(cliente_ana)).status_code == 403
        assert api(cliente_ana).get(self._url(cliente_ana)).status_code == 403
        assert api(admin).get(self._url(cliente_ana)).status_code == 200

    def test_forma_da_resposta(self, admin, cliente_ana, api):
        # um login de verdade: gera evento E sessão viva carimbada
        _login(cliente_ana.email)
        _login(cliente_ana.email, senha="errada")

        body = api(admin).get(self._url(cliente_ana)).json()
        assert set(body) == {"events", "logins", "sessions", "session_limit"}

        kinds = [e["kind"] for e in body["events"]]
        assert AccessEventKind.LOGIN in kinds
        assert AccessEventKind.LOGIN_FAILED in kinds
        evento = body["events"][0]  # mais recente primeiro
        assert set(evento) == {
            "kind", "kind_label", "ip", "browser", "created_at", "success"
        }
        assert evento["kind_label"]  # rótulo legível, não o valor cru

        assert len(body["sessions"]) == 1
        sessao = body["sessions"][0]
        assert sessao["browser"] == "Chrome · Windows"
        assert sessao["ip"]
        assert sessao["started_at"]
        assert sessao["key"]  # é o que o botão "desconectar" devolve

    def test_limita_aos_50_mais_recentes(self, admin, cliente_ana, api):
        for _ in range(55):
            AccessEvent.objects.create(user=cliente_ana, kind=AccessEventKind.LOGIN)
        body = api(admin).get(self._url(cliente_ana)).json()
        assert len(body["events"]) == 50

    def test_logins_sao_20_e_so_de_entrada(self, admin, cliente_ana, api):
        """A aba "Acessos" pergunta quem entrou nesta conta. Filtrar no
        frontend devolveria menos de 20 sempre que houvesse troca de senha no
        meio — por isso o recorte é do servidor."""
        for _ in range(25):
            AccessEvent.objects.create(user=cliente_ana, kind=AccessEventKind.LOGIN)
        AccessEvent.objects.create(
            user=cliente_ana, kind=AccessEventKind.PASSWORD_CHANGED
        )
        body = api(admin).get(self._url(cliente_ana)).json()
        assert len(body["logins"]) == 20
        assert {e["kind"] for e in body["logins"]} == {AccessEventKind.LOGIN}
        assert all(e["success"] for e in body["logins"])

    def test_login_falho_vem_marcado_como_insucesso(self, admin, cliente_ana, api):
        _login(cliente_ana.email, senha="errada")
        body = api(admin).get(self._url(cliente_ana)).json()
        assert body["logins"][0]["success"] is False

    def test_traz_o_teto_de_sessoes_simultaneas(self, admin, cliente_ana, api,
                                                settings):
        settings.SESSION_MAX_PER_USER = 3
        body = api(admin).get(self._url(cliente_ana)).json()
        assert body["session_limit"] == 3


class TestEndpointSelfService:
    """`GET me/access-history/` — a peça que faltava depois do endpoint do
    admin acima: a régua "só admin lê" faz sentido quando é uma pessoa
    olhando a conta de OUTRA, não quando é a própria dona da conta olhando o
    que aconteceu com ela mesma (toda conta séria mostra isso pro próprio
    dono). Mesma forma da resposta, sempre `request.user`, nunca um id na
    URL — não tem como pedir o histórico de outra pessoa por aqui. Ver
    GAPS.md."""

    URL = "/api/v1/me/access-history/"

    def test_qualquer_autenticado_ve_o_proprio_historico(self, cliente_ana, api):
        _login(cliente_ana.email)
        resp = api(cliente_ana).get(self.URL)
        assert resp.status_code == 200
        assert set(resp.json()) == {"events", "logins", "sessions", "session_limit"}

    def test_vale_pro_interno_tambem(self, agente_suporte, api):
        """Nenhuma view aqui distingue `kind` — o self-service sempre foi
        "qualquer autenticado", nunca cliente-only."""
        resp = api(agente_suporte).get(self.URL)
        assert resp.status_code == 200

    def test_anonimo_nao_entra(self):
        assert APIClient().get(self.URL).status_code in (401, 403)

    def test_traz_so_os_proprios_eventos(self, cliente_ana, acme, api):
        outro = User.objects.create_user(
            email="outro-self@acme.test", password=SENHA, full_name="Outro",
            kind=UserKind.CLIENT, company=acme,
        )
        _login(outro.email)
        _login(cliente_ana.email)

        body = api(cliente_ana).get(self.URL).json()
        assert len(body["events"]) == 1
        assert len(body["sessions"]) == 1  # não vaza a sessão do outro


class TestAdminDesconectaSessaoDeOutro:
    """O gêmeo administrativo de `DELETE /me/sessions/<key>/`.

    Quem perde o notebook não é quem está logado no painel — sem isto, a única
    saída seria esperar a sessão expirar sozinha.
    """

    def _url(self, user, key=""):
        return f"/api/v1/settings/users/{user.pk}/sessions/{key}"

    def test_admin_derruba_uma_sessao(self, admin, cliente_ana, api):
        cliente, _ = _login(cliente_ana.email)
        chave = api(admin).get(
            f"/api/v1/settings/users/{cliente_ana.pk}/access-history/"
        ).json()["sessions"][0]["key"]

        assert api(admin).delete(self._url(cliente_ana, f"{chave}/")).status_code == 204
        assert not Session.objects.filter(session_key=chave).exists()
        # e a sessão derrubada realmente perdeu o acesso
        assert cliente.get("/api/v1/auth/me/").status_code in (401, 403)

    def test_admin_derruba_todas(self, admin, cliente_ana, api):
        _login(cliente_ana.email)
        _login(cliente_ana.email, ua="Mozilla/5.0 (Macintosh) Firefox/126.0")
        assert len(live_sessions(cliente_ana)) == 2

        assert api(admin).delete(self._url(cliente_ana)).status_code == 204
        assert live_sessions(cliente_ana) == []

    def test_chave_de_outra_pessoa_nao_serve(self, admin, cliente_ana, acme, api):
        """A chave só vale para quem está na URL — senão uma chave adivinhada
        (ou copiada da tela ao lado) derrubaria qualquer um."""
        outro = User.objects.create_user(
            email="outro@acme.test", password=SENHA, full_name="Outro",
            kind=UserKind.CLIENT, company=acme,
        )
        _login(outro.email)
        chave = live_sessions(outro)[0]["key"]

        assert api(admin).delete(
            self._url(cliente_ana, f"{chave}/")
        ).status_code == 404
        assert Session.objects.filter(session_key=chave).exists()

    def test_so_admin_desconecta(self, agente_suporte, cliente_ana, api):
        _login(cliente_ana.email)
        chave = live_sessions(cliente_ana)[0]["key"]

        assert api(agente_suporte).delete(
            self._url(cliente_ana, f"{chave}/")
        ).status_code == 403
        assert api(cliente_ana).delete(self._url(cliente_ana)).status_code == 403
        assert Session.objects.filter(session_key=chave).exists()

    def test_limite_de_sessoes_simultaneas_continua_valendo(self, cliente_ana,
                                                           settings):
        """O teto é do login, não da tela: a 4ª entrada derruba a mais antiga."""
        settings.SESSION_MAX_PER_USER = 3
        for _ in range(4):
            _login(cliente_ana.email)
        assert len(live_sessions(cliente_ana)) == 3


class TestNavegadorHumanizado:
    @pytest.mark.parametrize("ua, esperado", [
        (UA_CHROME_WIN, "Chrome · Windows"),
        ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Gecko Firefox/126.0",
         "Firefox · macOS"),
        ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17 Safari/604.1",
         "Safari · iOS"),
        ("Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36 Edg/125.0",
         "Edge · Windows"),
        ("", "Desconhecido"),
    ])
    def test_traduz_os_user_agents_comuns(self, ua, esperado):
        assert browser_of(ua) == esperado

    def test_desconhecido_cai_no_texto_truncado(self):
        assert browser_of("curl/8.5.0" + "x" * 100) == ("curl/8.5.0" + "x" * 100)[:60]
