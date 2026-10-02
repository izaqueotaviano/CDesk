"""Preferências de conforto da própria conta: tamanho do texto, som dos
avisos, ausência automática e densidade.

O que estas travas protegem: a escolha vale para a PESSOA, não para o
navegador. Quem aumentou o texto no escritório abre o Resolv em casa e
encontra o texto grande; quem silenciou o bipe não volta a ouvi-lo por ter
trocado de computador. Para isso o `/auth/me/` precisa devolver exatamente
o que o PATCH gravou (uma lista de campos para ler e outra para escrever já
divergiram antes), e valor fora das opções da tela precisa ser recusado em
vez de gravado.
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind
from apps.customers.models import Company, Plan

pytestmark = pytest.mark.django_db


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="conforto@agencia.com.br", password="x", full_name="Carla Conforto",
        kind=UserKind.INTERNAL, internal_role=InternalRole.AGENT,
    )


@pytest.fixture
def cliente(db):
    plan = Plan.objects.create(slug="gold", name="Gold", default_ticket_limit=10)
    acme = Company.objects.create(name="Acme", slug="acme", plan=plan)
    return User.objects.create_user(
        email="ana-conforto@acme.test", password="x", full_name="Ana",
        kind=UserKind.CLIENT, company=acme, client_role="member",
    )


def _api(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class TestPadrao:
    def test_conta_nova_vem_com_o_padrao_do_produto(self, agente):
        dados = _api(agente).get("/api/v1/auth/me/").json()
        # texto no tamanho do produto, bipe ligado (é o comportamento de
        # antes desta preferência existir) e ausência em 15 minutos
        assert dados["ui_text_size"] == ""
        assert dados["notification_sound"] is True
        assert dados["auto_away_minutes"] == 15
        assert dados["ui_density"] == ""


class TestGravacao:
    def test_patch_grava_e_devolve_as_quatro_preferencias(self, agente):
        resp = _api(agente).patch("/api/v1/auth/me/", {
            "ui_text_size": "larger",
            "notification_sound": False,
            "auto_away_minutes": 0,
            "ui_density": "comfortable",
        }, format="json")
        assert resp.status_code == 200
        dados = resp.json()
        # a resposta do PATCH é o `Me` novo — é ela que entra no cache do
        # front, então precisa trazer o que acabou de ser gravado
        assert dados["ui_text_size"] == "larger"
        assert dados["notification_sound"] is False
        assert dados["auto_away_minutes"] == 0
        assert dados["ui_density"] == "comfortable"

        agente.refresh_from_db()
        assert agente.ui_text_size == "larger"
        assert agente.notification_sound is False
        assert agente.auto_away_minutes == 0
        assert agente.ui_density == "comfortable"

    def test_patch_parcial_nao_mexe_no_resto(self, agente):
        agente.ui_text_size = "large"
        agente.save(update_fields=["ui_text_size"])
        _api(agente).patch("/api/v1/auth/me/", {"notification_sound": False}, format="json")
        agente.refresh_from_db()
        assert agente.ui_text_size == "large"
        assert agente.auto_away_minutes == 15

    def test_cliente_tambem_escolhe_o_tamanho_do_texto(self, cliente):
        # o portal aplica o tamanho do texto; o cliente não tem presença, mas
        # a preferência de leitura é dele como de qualquer um
        resp = _api(cliente).patch("/api/v1/auth/me/", {"ui_text_size": "large"}, format="json")
        assert resp.status_code == 200
        assert resp.json()["ui_text_size"] == "large"


class TestValoresRecusados:
    @pytest.mark.parametrize("campo, valor", [
        ("ui_text_size", "gigante"),
        ("auto_away_minutes", 7),
        ("auto_away_minutes", -5),
        ("ui_density", "apertada"),
    ])
    def test_valor_fora_das_opcoes_e_400_e_nada_muda(self, agente, campo, valor):
        antes = getattr(agente, campo)
        resp = _api(agente).patch("/api/v1/auth/me/", {campo: valor}, format="json")
        assert resp.status_code == 400
        assert campo in resp.json()
        agente.refresh_from_db()
        assert getattr(agente, campo) == antes

    def test_anonimo_nao_grava(self, agente):
        resp = APIClient().patch("/api/v1/auth/me/", {"ui_text_size": "large"}, format="json")
        assert resp.status_code in (401, 403)
        agente.refresh_from_db()
        assert agente.ui_text_size == ""
