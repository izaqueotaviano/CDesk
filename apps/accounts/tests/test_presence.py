"""Presença ao vivo do agente (Disponível/Ausente/Offline).

O que estas travas protegem: o valor de existir isto é os OUTROS agentes
enxergarem quem está por perto — sem persistir e sem forçar OFFLINE ao
sair, a informação vira exatamente o que já era antes (um estado que só o
próprio navegador lembrava, e nem isso depois de um F5). O broadcast por
WebSocket (`_avisar_presenca`) não é testado aqui — é conferido ao vivo
(Playwright, dois agentes reais) — pytest cobre o que é determinístico sem
subir um channel layer de verdade: o dado persistido e quem pode mexer nele.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, LoginCode, PresenceStatus, User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db

SENHA = "senha-forte"


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="presenca@x.test", password=SENHA, full_name="Pedro Presença",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def cliente(db):
    plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana-presenca@acme.test", password=SENHA, full_name="Ana",
        kind=UserKind.CLIENT, company=acme, client_role="member",
    )


@pytest.fixture
def api(agente):
    client = APIClient()
    client.force_authenticate(user=agente)
    return client


def _login_completo(email, senha=SENHA):
    """Login de verdade — senha + código por e-mail — porque é isso que
    dispara o efeito colateral que este arquivo testa (forçar AVAILABLE)."""
    client = APIClient()
    resp = client.post(
        "/api/v1/auth/login/", {"email": email, "password": senha}, format="json"
    )
    assert resp.status_code == 200, resp.content
    if resp.json().get("two_factor"):
        # só há segunda etapa se a conta ligou a verificação (é opcional)
        user = User.objects.get(email=email)
        codigo = LoginCode.objects.filter(
            user=user, purpose=LoginCode.Purpose.LOGIN, used_at__isnull=True
        ).latest("created_at").code
        resp = client.post("/api/v1/auth/2fa/", {"code": codigo}, format="json")
    assert resp.status_code == 200, resp.content
    return client


class TestValorPadrao:
    def test_novo_usuario_nasce_offline(self, agente):
        assert agente.presence == PresenceStatus.OFFLINE


class TestLoginELogout:
    def test_login_forca_disponivel(self, agente):
        assert agente.presence == PresenceStatus.OFFLINE
        _login_completo(agente.email)
        agente.refresh_from_db()
        assert agente.presence == PresenceStatus.AVAILABLE

    def test_logout_forca_offline(self, agente):
        client = _login_completo(agente.email)
        agente.refresh_from_db()
        assert agente.presence == PresenceStatus.AVAILABLE

        resp = client.post("/api/v1/auth/logout/")
        assert resp.status_code == 204
        agente.refresh_from_db()
        assert agente.presence == PresenceStatus.OFFLINE

    def test_login_nao_mexe_em_presenca_de_cliente(self, cliente):
        _login_completo(cliente.email)
        cliente.refresh_from_db()
        # cliente não usa o recurso — nunca sai do default
        assert cliente.presence == PresenceStatus.OFFLINE


class TestEndpointDeTrocaManual:
    URL = "/api/v1/me/presence/"

    def test_agente_troca_o_proprio_status(self, api, agente):
        resp = api.post(self.URL, {"presence": "away"}, format="json")
        assert resp.status_code == 200
        assert resp.json() == {"presence": "away"}
        agente.refresh_from_db()
        assert agente.presence == PresenceStatus.AWAY

    def test_pode_se_marcar_offline_manualmente_sem_deslogar(self, api, agente):
        """Diferente do offline automático do logout: aqui é escolha, e a
        sessão continua viva — só fica "invisível" pra fila, não saiu."""
        resp = api.post(self.URL, {"presence": "offline"}, format="json")
        assert resp.status_code == 200
        assert api.get("/api/v1/auth/me/").status_code == 200  # sessão intocada

    def test_valor_invalido_e_recusado(self, api, agente):
        resp = api.post(self.URL, {"presence": "almoçando"}, format="json")
        assert resp.status_code == 400
        agente.refresh_from_db()
        assert agente.presence == PresenceStatus.OFFLINE  # intocado

    def test_cliente_nao_pode(self, cliente):
        client = APIClient()
        client.force_authenticate(user=cliente)
        resp = client.post(self.URL, {"presence": "available"}, format="json")
        assert resp.status_code == 400

    def test_anonimo_nao_pode(self):
        resp = APIClient().post(self.URL, {"presence": "available"}, format="json")
        assert resp.status_code in (401, 403)


class TestApareceNoDiretorioEnoMe:
    def test_presence_no_diretorio_de_agentes(self, api, agente):
        api.post("/api/v1/me/presence/", {"presence": "away"}, format="json")
        resp = api.get("/api/v1/users/")
        assert resp.status_code == 200
        linha = next(u for u in resp.json()["results"] if u["id"] == agente.id)
        assert linha["presence"] == "away"

    def test_presence_no_proprio_me(self, api):
        resp = api.get("/api/v1/auth/me/")
        assert resp.json()["presence"] == "offline"
