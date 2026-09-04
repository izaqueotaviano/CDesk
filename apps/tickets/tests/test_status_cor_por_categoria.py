"""Cor de um status novo: sem escolha explícita, herda a paleta semântica da
categoria — não o cinza fixo do model. Achado da auditoria de paridade de
regras de negócio (ciclo de vida do ticket, item 10)."""

import pytest

from apps.tickets.models import COR_POR_CATEGORIA, TicketStage, TicketStatus

pytestmark = pytest.mark.django_db


class TestCorDoStatusNovo:
    def test_sem_cor_explicita_herda_a_paleta_da_categoria(self, api, admin):
        resp = api(admin).post(
            "/api/v1/settings/statuses/",
            {"name": "Em análise", "category": TicketStatus.OPEN},
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["color"] == COR_POR_CATEGORIA[TicketStatus.OPEN]

    @pytest.mark.parametrize("categoria", list(COR_POR_CATEGORIA))
    def test_cada_categoria_puxa_a_cor_certa(self, api, admin, categoria):
        resp = api(admin).post(
            "/api/v1/settings/statuses/",
            {"name": f"Status {categoria}", "category": categoria},
            format="json",
        )
        assert resp.json()["color"] == COR_POR_CATEGORIA[categoria]

    def test_cor_explicita_do_admin_sempre_vence(self, api, admin):
        resp = api(admin).post(
            "/api/v1/settings/statuses/",
            {"name": "Resolvido", "category": TicketStatus.CLOSED, "color": "#FF00AA"},
            format="json",
        )
        assert resp.status_code == 201
        assert resp.json()["color"] == "#FF00AA"  # nunca sobrescrita pela paleta

    def test_editar_nao_mexe_na_cor_se_nao_pedido(self, api, admin):
        criado = api(admin).post(
            "/api/v1/settings/statuses/",
            {"name": "Triagem", "category": TicketStatus.NEW},
            format="json",
        ).json()
        assert criado["color"] == COR_POR_CATEGORIA[TicketStatus.NEW]

        resp = api(admin).patch(
            f"/api/v1/settings/statuses/{criado['id']}/",
            {"name": "Triagem inicial"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["color"] == COR_POR_CATEGORIA[TicketStatus.NEW]

    def test_status_de_fabrica_continua_com_a_cor_da_migracao(self):
        """Trava de regressão: a paleta em COR_POR_CATEGORIA precisa
        continuar batendo com o que a migration 0016 gravou nos quatro
        status de fábrica — são a mesma fonte de verdade, só que uma delas
        já rodou e não pode ser reaplicada."""
        for categoria, cor in COR_POR_CATEGORIA.items():
            fabrica = TicketStage.objects.get(slug=categoria, is_system=True)
            assert fabrica.color == cor
