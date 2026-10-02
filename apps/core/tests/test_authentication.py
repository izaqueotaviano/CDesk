"""401 vs 403: quem decide é `apps.core.authentication`, não a permissão.

DRF só consulta a `authenticate_header()` da autenticadora de ÍNDICE 0 pra
decidir se "sem autenticar" vira 401 ou é rebaixado pra 403
(`APIView.handle_exception`). Antes desta classe, a de índice 0 era a
`SessionAuthentication` de fábrica, que devolve `None` ali — e isso baixava
TODO "sem sessão" pra 403, indistinguível de "autenticado sem permissão".
"""

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import InternalRole, User, UserKind

pytestmark = pytest.mark.django_db


@pytest.fixture
def agente(db):
    return User.objects.create_user(
        email="agente@x.test", full_name="Samuel", kind=UserKind.INTERNAL,
        internal_role=InternalRole.AGENT,
    )


class TestSemSessaoE401:
    def test_anonimo_em_view_autenticada_recebe_401(self):
        resp = APIClient().get("/api/v1/auth/me/")
        assert resp.status_code == 401

    def test_anonimo_em_viewset_recebe_401(self):
        resp = APIClient().get("/api/v1/tickets/")
        assert resp.status_code == 401


class TestAutenticadoSemPermissaoContinuaSendo403:
    """A distinção não pode desaparecer: quem PROVOU quem é, mas não pode
    fazer aquilo, continua recebendo 403 — nunca 401."""

    def test_agente_em_endpoint_so_de_admin_recebe_403(self, agente):
        client = APIClient()
        client.force_authenticate(user=agente)
        resp = client.put("/api/v1/settings/system/", {}, format="json")
        assert resp.status_code == 403
