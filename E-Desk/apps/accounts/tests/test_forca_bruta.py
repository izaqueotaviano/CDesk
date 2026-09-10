"""Bloqueio por força bruta (django-axes) na porta de login da API.

A suíte roda com AXES_ENABLED=False; aqui liga de propósito. O cache é
locmem em teste, então cada teste limpa a contagem antes de começar.
"""

import pytest
from axes.helpers import get_cache
from django.test import override_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db

LOGIN = "/api/v1/auth/login/"


@pytest.fixture
def api():
    get_cache().clear()
    return APIClient()


@pytest.fixture
def cliente(ana):
    ana.set_password("Senha-forte-123")
    ana.save()
    return ana


@pytest.fixture
def agente(agente_suporte):
    return agente_suporte


@override_settings(AXES_ENABLED=True, AXES_FAILURE_LIMIT=3)
def test_fecha_a_trava_depois_do_limite_e_nao_olha_mais_a_senha(api, cliente):
    for _ in range(2):
        r = api.post(LOGIN, {"email": cliente.email, "password": "errada"})
        assert r.status_code == 400

    # a tentativa que atinge o limite já volta bloqueada
    r = api.post(LOGIN, {"email": cliente.email, "password": "errada"})
    assert r.status_code == 429

    # e a seguinte é recusada ANTES de conferir — mesmo com a senha certa
    r = api.post(LOGIN, {"email": cliente.email, "password": "Senha-forte-123"})
    assert r.status_code == 429
    assert r["Retry-After"]
    assert "Aguarde" in r.json()["detail"]
    assert r.json()["code"] == "login_bloqueado"


@override_settings(AXES_ENABLED=True, AXES_FAILURE_LIMIT=3)
def test_a_trava_e_por_par_email_ip__outro_email_do_mesmo_ip_continua_entrando(
    api, cliente, agente
):
    for _ in range(3):
        api.post(LOGIN, {"email": cliente.email, "password": "errada"})

    r = api.post(LOGIN, {"email": agente.email, "password": "errada"})
    assert r.status_code == 400  # errou a senha, mas não está bloqueado


@override_settings(AXES_ENABLED=True, AXES_FAILURE_LIMIT=3)
def test_a_trava_e_por_par_email_ip__mesmo_email_de_outro_ip_continua_entrando(api, cliente):
    for _ in range(3):
        api.post(LOGIN, {"email": cliente.email, "password": "errada"}, REMOTE_ADDR="10.0.0.1")

    r = api.post(LOGIN, {"email": cliente.email, "password": "errada"}, REMOTE_ADDR="10.0.0.2")
    assert r.status_code == 400
