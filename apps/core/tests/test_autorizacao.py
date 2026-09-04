"""`apps.core.authz` — o decorator e o mixin em cima do catálogo RBAC."""

import pytest
from django.contrib.auth.models import AnonymousUser
from django.test import RequestFactory

from apps.accounts.rbac import Perm
from apps.core.authz import require_perm
from apps.core.middleware import RequestIdMiddleware

pytestmark = pytest.mark.django_db


@require_perm(Perm.SETTINGS_MANAGE)
def _view_de_admin(request):
    from django.http import JsonResponse

    return JsonResponse({"ok": True})


def _req(user):
    r = RequestFactory().get("/x")
    r.user = user
    return r


def test_anonimo_recebe_401_json_e_nao_redirect():
    r = _view_de_admin(_req(AnonymousUser()))
    assert r.status_code == 401
    assert r["Content-Type"].startswith("application/json")


def test_autenticado_sem_a_permissao_recebe_403(ana):
    assert _view_de_admin(_req(ana)).status_code == 403


def test_quem_tem_a_permissao_passa(admin):
    assert _view_de_admin(_req(admin)).status_code == 200


def test_request_id_vai_no_header_e_um_id_forjado_e_ignorado():
    mw = RequestIdMiddleware(lambda request: __import__("django.http").http.HttpResponse("ok"))
    r = mw(RequestFactory().get("/x"))
    assert len(r["X-Request-ID"]) == 32

    r = mw(RequestFactory().get("/x", HTTP_X_REQUEST_ID="<script>alert(1)</script>"))
    assert "<" not in r["X-Request-ID"]

    r = mw(RequestFactory().get("/x", HTTP_X_REQUEST_ID="abcdef12-3456"))
    assert r["X-Request-ID"] == "abcdef12-3456"
