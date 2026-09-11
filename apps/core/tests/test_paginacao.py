"""`?limit=` com teto: um inteiro que não cabe no bigint não pode dar 500."""

import pytest
from rest_framework.request import Request
from rest_framework.settings import api_settings
from rest_framework.test import APIRequestFactory

from apps.core.pagination import LimitOffsetComTeto

pytestmark = pytest.mark.django_db

ESTOURO = "99999999999999999999"  # > 2**63, o bigint do PostgreSQL


class TestLimiteComTeto:
    def test_e_a_paginacao_padrao_da_api(self):
        assert api_settings.DEFAULT_PAGINATION_CLASS is LimitOffsetComTeto

    def test_apara_no_teto_em_vez_de_repassar_ao_banco(self):
        pedido = Request(APIRequestFactory().get("/", {"limit": ESTOURO}))

        assert LimitOffsetComTeto().get_limit(pedido) == LimitOffsetComTeto.max_limit

    @pytest.mark.parametrize("rota", ["/api/v1/tickets/", "/api/v1/companies/"])
    def test_endpoint_paginado_responde_200(self, api, admin, ana, suporte, make_ticket, rota):
        # Pelo menos uma linha: com a lista vazia o DRF nem executa o LIMIT
        # (`count == 0` devolve `[]` antes da fatia), e o teste passaria sem
        # provar nada. `ana` já traz a empresa dela para `/companies/`.
        make_ticket(ana, suporte)

        r = api(admin).get(rota, {"limit": ESTOURO})

        assert r.status_code == 200, r.content[:200]

    def test_offset_estourado_tambem_nao_derruba(self, api, admin):
        r = api(admin).get("/api/v1/tickets/", {"offset": ESTOURO})

        assert r.status_code == 200
