"""API admin do embed — `/settings/companies/<id>/chat-embed/` e
`.../chat-embed/regenerate-secret/` (docs/14-seguranca.md §10).

Mesma trava de `CompanyAdminViewSet` (`IsInternalReadAdminWrite`): qualquer
interno lê a config, só admin liga/desliga, muda origens ou troca a chave.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, CompanyChatEmbed, CompanyChatEmbedOrigin, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def plan(db):
    return Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)


@pytest.fixture
def acme(plan):
    return Company.objects.create(name="Acme", slug="acme", plan=plan)


@pytest.fixture
def admin(db):
    return User.objects.create_user(
        email="admin@x.test", full_name="Alice Admin", kind=UserKind.INTERNAL,
        internal_role=InternalRole.ADMIN,
    )


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="samuel@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def api():
    def _for(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client
    return _for


def _url(company, sufixo=""):
    return f"/api/v1/settings/companies/{company.pk}/chat-embed/{sufixo}"


class TestLeitura:
    def test_get_cria_a_config_desligada_na_primeira_vez(self, api, admin, acme):
        assert not CompanyChatEmbed.objects.filter(company=acme).exists()
        resp = api(admin).get(_url(acme))
        assert resp.status_code == 200
        assert resp.data == {"enabled": False, "origins": [], "rotated_at": resp.data["rotated_at"]}
        assert CompanyChatEmbed.objects.filter(company=acme).exists()

    def test_agente_nao_admin_le_normalmente(self, api, agente, acme):
        assert api(agente).get(_url(acme)).status_code == 200

    def test_a_chave_crua_nunca_aparece_na_leitura(self, api, admin, acme):
        embed = CompanyChatEmbed.objects.create(company=acme, enabled=True)
        resp = api(admin).get(_url(acme))
        assert "secret" not in resp.data
        assert embed.secret not in str(resp.data)


class TestEscrita:
    def test_agente_nao_admin_nao_liga(self, api, agente, acme):
        resp = api(agente).patch(_url(acme), {"enabled": True}, format="json")
        assert resp.status_code == 403
        # bloqueado no nível do ViewSet (IsInternalReadAdminWrite exige
        # SETTINGS_MANAGE pra qualquer método de escrita) — a view nem chega
        # a rodar, então a config nem chega a nascer
        assert not CompanyChatEmbed.objects.filter(company=acme).exists()

    def test_admin_liga_e_desliga(self, api, admin, acme):
        resp = api(admin).patch(_url(acme), {"enabled": True}, format="json")
        assert resp.status_code == 200
        assert resp.data["enabled"] is True
        assert CompanyChatEmbed.objects.get(company=acme).enabled

        resp = api(admin).patch(_url(acme), {"enabled": False}, format="json")
        assert resp.data["enabled"] is False

    def test_origens_substituem_o_conjunto_inteiro(self, api, admin, acme):
        embed = CompanyChatEmbed.objects.create(company=acme)
        CompanyChatEmbedOrigin.objects.create(embed=embed, origin="https://velha.com")

        resp = api(admin).patch(
            _url(acme), {"origins": ["https://acme.myvtex.com", "https://acme.tray.com.br"]},
            format="json",
        )
        assert resp.status_code == 200
        assert sorted(resp.data["origins"]) == ["https://acme.myvtex.com", "https://acme.tray.com.br"]
        assert not CompanyChatEmbedOrigin.objects.filter(origin="https://velha.com").exists()

    def test_origem_e_normalizada_minusculo_sem_barra_final(self, api, admin, acme):
        resp = api(admin).patch(
            _url(acme), {"origins": ["HTTPS://Acme.MyVtex.com/"]}, format="json"
        )
        assert resp.data["origins"] == ["https://acme.myvtex.com"]

    def test_origem_sem_esquema_e_recusada_com_mensagem_clara(self, api, admin, acme):
        resp = api(admin).patch(
            _url(acme), {"origins": ["acme.myvtex.com"]}, format="json"
        )
        assert resp.status_code == 400
        assert "acme.myvtex.com" in str(resp.data["origins"])

    def test_origem_com_caminho_e_recusada(self, api, admin, acme):
        resp = api(admin).patch(
            _url(acme), {"origins": ["https://acme.myvtex.com/admin"]}, format="json"
        )
        assert resp.status_code == 400

    def test_origins_que_nao_e_lista_e_recusado(self, api, admin, acme):
        resp = api(admin).patch(_url(acme), {"origins": "https://acme.myvtex.com"}, format="json")
        assert resp.status_code == 400


class TestRegenerarChave:
    def test_agente_nao_admin_nao_regenera(self, api, agente, acme):
        assert api(agente).post(_url(acme, "regenerate-secret/")).status_code == 403

    def test_admin_regenera_e_recebe_a_chave_uma_vez(self, api, admin, acme):
        embed = CompanyChatEmbed.objects.create(company=acme)
        antiga = embed.secret

        resp = api(admin).post(_url(acme, "regenerate-secret/"))
        assert resp.status_code == 200
        nova = resp.data["secret"]
        assert nova != antiga
        assert len(nova) == 64

        embed.refresh_from_db()
        assert embed.secret == nova

    def test_regenerar_sem_config_previa_cria_e_devolve_a_chave(self, api, admin, acme):
        assert not CompanyChatEmbed.objects.filter(company=acme).exists()
        resp = api(admin).post(_url(acme, "regenerate-secret/"))
        assert resp.status_code == 200
        assert resp.data["secret"]
