"""API do calendário: expediente partido é aceito, sobreposição é recusada.

A regra que importa: `add_business_minutes` soma cada janela do dia
separadamente. Duas janelas sobrepostas (09-13 e 12-18) fariam a hora comum
contar DUAS vezes, e o prazo de SLA sairia menor do que o combinado. Por isso a
validação barra na entrada, antes de virar cálculo errado em produção.
"""

import pytest

from apps.core.models import BusinessCalendar

pytestmark = pytest.mark.django_db

URL = "/api/v1/settings/calendars/"


@pytest.fixture
def calendar(db):
    return BusinessCalendar.objects.create(
        name="Comercial", timezone="America/Sao_Paulo",
        workdays=[{"weekday": 0, "start": "09:00", "end": "18:00"}],
    )


def _split():
    """Segunda-feira em dois turnos: manhã e tarde, com almoço no meio."""
    return {"workdays": [
        {"weekday": 0, "start": "09:00", "end": "12:00"},
        {"weekday": 0, "start": "13:00", "end": "18:00"},
    ]}


class TestSplitShift:
    def test_two_windows_on_the_same_day_are_accepted(self, api, admin, calendar):
        resp = api(admin).patch(f"{URL}{calendar.pk}/", _split(), format="json")
        assert resp.status_code == 200
        calendar.refresh_from_db()
        assert len(calendar.workdays) == 2

    def test_touching_windows_are_fine(self, api, admin, calendar):
        """12:00–13:00 encostadas não é sobreposição: fim de uma = início da outra."""
        resp = api(admin).patch(f"{URL}{calendar.pk}/", {"workdays": [
            {"weekday": 0, "start": "09:00", "end": "12:00"},
            {"weekday": 0, "start": "12:00", "end": "18:00"},
        ]}, format="json")
        assert resp.status_code == 200


class TestOverlapIsRefused:
    def test_overlapping_windows_are_rejected(self, api, admin, calendar):
        resp = api(admin).patch(f"{URL}{calendar.pk}/", {"workdays": [
            {"weekday": 0, "start": "09:00", "end": "13:00"},
            {"weekday": 0, "start": "12:00", "end": "18:00"},  # 12–13 em dobro
        ]}, format="json")
        assert resp.status_code == 400
        calendar.refresh_from_db()
        assert len(calendar.workdays) == 1  # nada foi gravado

    def test_overlap_is_detected_out_of_order(self, api, admin, calendar):
        """A tarde vem antes da manhã no payload — a checagem ordena primeiro."""
        resp = api(admin).patch(f"{URL}{calendar.pk}/", {"workdays": [
            {"weekday": 0, "start": "12:00", "end": "18:00"},
            {"weekday": 0, "start": "09:00", "end": "13:00"},
        ]}, format="json")
        assert resp.status_code == 400

    def test_same_window_twice_is_rejected(self, api, admin, calendar):
        resp = api(admin).patch(f"{URL}{calendar.pk}/", {"workdays": [
            {"weekday": 0, "start": "09:00", "end": "18:00"},
            {"weekday": 0, "start": "09:00", "end": "18:00"},
        ]}, format="json")
        assert resp.status_code == 400

    def test_windows_on_different_days_never_collide(self, api, admin, calendar):
        resp = api(admin).patch(f"{URL}{calendar.pk}/", {"workdays": [
            {"weekday": 0, "start": "09:00", "end": "18:00"},
            {"weekday": 1, "start": "09:00", "end": "18:00"},
        ]}, format="json")
        assert resp.status_code == 200


class TestPermissions:
    def test_agent_cannot_change_hours(self, api, agente_suporte, calendar):
        assert api(agente_suporte).patch(
            f"{URL}{calendar.pk}/", _split(), format="json"
        ).status_code == 403

    def test_client_cannot_even_read(self, api, ana, calendar):
        assert api(ana).get(URL).status_code == 403
