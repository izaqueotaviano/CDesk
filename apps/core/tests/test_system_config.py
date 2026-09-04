"""Configuração operacional editável pelo admin (D22).

Antes destes campos, cada um era variável de ambiente: mudar o limite de anexo
exigia deploy. Isso é certo para segredo e endereço de serviço, e errado para
número que a operação ajusta com o uso.

O que precisa ficar provado:
- é **singleton** — duas linhas divergentes seriam duas verdades;
- o valor efetivo vem do banco, e a setting é só **piso de fallback**;
- a mudança vale **na hora**, sem restart;
- limite incoerente é recusado antes de virar erro na cara do usuário.
"""

import pytest

from apps.core.models import SystemConfig

pytestmark = pytest.mark.django_db


class TestSingleton:
    def test_load_creates_the_row_on_first_read(self):
        SystemConfig.objects.all().delete()
        config = SystemConfig.load()
        assert config.pk == 1
        assert SystemConfig.objects.count() == 1

    def test_a_second_row_is_impossible(self):
        SystemConfig.load()
        outra = SystemConfig(attachment_max_bytes=1234)
        outra.save()
        assert SystemConfig.objects.count() == 1
        assert SystemConfig.load().attachment_max_bytes == 1234

    def test_it_cannot_be_deleted(self):
        from django.core.exceptions import ValidationError

        with pytest.raises(ValidationError):
            SystemConfig.load().delete()


class TestDefaultsAreTheBusinessDecision:
    def test_factory_defaults(self):
        """10 MB por arquivo é regra de produto, não número solto: "anexos de
        mídia e documentos até 10MB". Era 20 MB; a migração `core/0008`
        trocou o default E a linha singleton que ainda estava no valor
        antigo, sem pisar em quem tivesse ajustado à mão."""
        config = SystemConfig.load()
        assert config.attachment_max_bytes == 10 * 1024 * 1024   # 10 MB
        assert config.attachment_max_files_per_message == 10
        assert config.attachment_max_bytes_per_message == 100 * 1024 * 1024


class TestEffectiveValueComesFromTheDatabase:
    def test_attachment_limit_changes_without_restart(self, config):
        from apps.tickets.services.attachments import limits

        config(attachment_max_bytes=5 * 1024 * 1024)
        assert limits()[0] == 5 * 1024 * 1024

    def test_settings_are_only_a_fallback(self, settings, monkeypatch):
        """Se a leitura da configuração falhar, o sistema usa o default do
        código em vez de virar "nenhum anexo é aceito"."""
        from apps.tickets.services import attachments

        settings.ATTACHMENT_MAX_BYTES = 777
        settings.ATTACHMENT_MAX_BYTES_PER_MESSAGE = 888
        settings.ATTACHMENT_MAX_FILES_PER_MESSAGE = 9
        monkeypatch.setattr(
            SystemConfig, "load",
            classmethod(lambda cls: (_ for _ in ()).throw(RuntimeError("banco fora"))),
        )
        assert attachments.limits() == (777, 888, 9)


class TestCoherence:
    def test_total_above_files_times_size_is_refused(self):
        from django.core.exceptions import ValidationError

        config = SystemConfig.load()
        config.attachment_max_bytes = 10 * 1024 * 1024
        config.attachment_max_files_per_message = 2
        config.attachment_max_bytes_per_message = 100 * 1024 * 1024

        with pytest.raises(ValidationError) as exc:
            config.clean()
        assert "inalcançável" in str(exc.value)

    def test_coherent_values_pass(self):
        config = SystemConfig.load()
        config.attachment_max_bytes = 10 * 1024 * 1024
        config.attachment_max_files_per_message = 5
        config.attachment_max_bytes_per_message = 50 * 1024 * 1024
        config.clean()  # não levanta


class TestApi:
    URL = "/api/v1/settings/system/"

    def test_internal_reads(self, api, agente_suporte):
        resp = api(agente_suporte).get(self.URL)
        assert resp.status_code == 200
        assert resp.json()["attachment_max_mb"] == 10

    def test_client_is_locked_out(self, api, ana):
        assert api(ana).get(self.URL).status_code == 403

    def test_only_admin_writes(self, api, agente_suporte):
        resp = api(agente_suporte).put(
            self.URL, {"auto_close_pending_hours": 20}, format="json"
        )
        assert resp.status_code == 403

    def test_admin_writes_and_it_takes_effect(self, api, admin):
        from apps.core.models import SystemConfig

        resp = api(admin).put(self.URL, {"auto_close_pending_hours": 96}, format="json")
        assert resp.status_code == 200
        assert resp.json()["auto_close_pending_hours"] == 96
        assert SystemConfig.load().auto_close_pending_hours == 96

    def test_incoherent_write_is_refused_with_a_reason(self, api, admin):
        resp = api(admin).put(self.URL, {
            "attachment_max_bytes": 1024 * 1024,
            "attachment_max_files_per_message": 2,
            "attachment_max_bytes_per_message": 500 * 1024 * 1024,
        }, format="json")
        assert resp.status_code == 400
        assert "attachment_max_bytes_per_message" in resp.json()

    def test_csat_fields_are_configurable(self, api, admin):
        """Existiam no model desde sempre, mas de fora do serializer — só
        dava para mudar pelo shell. Mesmo par attachment/attachment_mb: o
        model é fonte de verdade, o serializer só faltava listar os dois."""
        from apps.core.models import SystemConfig

        resp = api(admin).put(self.URL, {
            "csat_enabled": False, "csat_expires_days": 10,
        }, format="json")
        assert resp.status_code == 200
        assert resp.json()["csat_enabled"] is False
        assert resp.json()["csat_expires_days"] == 10
        config = SystemConfig.load()
        assert config.csat_enabled is False
        assert config.csat_expires_days == 10

    def test_change_is_audited(self, api, admin):
        from apps.audit.models import AuditAction, AuditLog

        api(admin).put(self.URL, {"auto_close_pending_hours": 96}, format="json")
        log = AuditLog.objects.filter(action=AuditAction.CONFIG_CHANGE).latest("created_at")
        assert log.actor_id == admin.pk
        assert log.changes["auto_close_pending_hours"] == "96"

    def test_auto_close_warning_fields_round_trip(self, api, admin):
        resp = api(admin).put(self.URL, {
            "auto_close_pending_hours": 72,
            "auto_close_warning_hours": 24,
            "auto_close_warning_message": "Faltam poucas horas para fecharmos.",
        }, format="json")
        assert resp.status_code == 200
        assert resp.json()["auto_close_warning_hours"] == 24
        assert resp.json()["auto_close_warning_message"] == "Faltam poucas horas para fecharmos."

    def test_warning_must_come_before_the_close_deadline(self, api, admin):
        """Aviso >= prazo chegaria depois do fechamento (ou junto) — inútil."""
        resp = api(admin).put(self.URL, {
            "auto_close_pending_hours": 24,
            "auto_close_warning_hours": 48,
        }, format="json")
        assert resp.status_code == 400
        assert "auto_close_warning_hours" in resp.json()


class TestSlaWriteFromTheScreen:
    """A tela de SLA passou a escrever. O que ela manda precisa ser aceito —
    e a regra de negócio precisa continuar barrando o que é incoerente."""

    URL = "/api/v1/settings/sla-policies/"

    def payload(self, plan, **extra):
        return {
            "name": "Gold — Suporte", "plan": plan.pk, "team": None,
            "first_response_minutes": 240, "resolution_minutes": 960,
            "use_business_hours": True, "is_active": True, **extra,
        }

    def test_admin_creates_a_policy(self, api, admin, plan_gold):
        resp = api(admin).post(self.URL, self.payload(plan_gold), format="json")
        assert resp.status_code == 201
        assert resp.json()["plan_name"] == "Gold"

    def test_admin_edits_the_deadline(self, api, admin, plan_gold):
        created = api(admin).post(self.URL, self.payload(plan_gold), format="json").json()
        resp = api(admin).patch(
            f"{self.URL}{created['id']}/", {"first_response_minutes": 120},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.json()["first_response_minutes"] == 120

    def test_admin_removes_a_policy(self, api, admin, plan_gold):
        created = api(admin).post(self.URL, self.payload(plan_gold), format="json").json()
        assert api(admin).delete(f"{self.URL}{created['id']}/").status_code == 204

    def test_resolution_shorter_than_first_response_is_refused(
        self, api, admin, plan_gold
    ):
        """Prazo de resolução menor que o de primeira resposta é impossível de
        cumprir — barrar aqui evita um SLA que nasce estourado."""
        resp = api(admin).post(self.URL, self.payload(
            plan_gold, first_response_minutes=960, resolution_minutes=240,
        ), format="json")
        assert resp.status_code == 400

    def test_agent_cannot_write(self, api, agente_suporte, plan_gold):
        resp = api(agente_suporte).post(
            self.URL, self.payload(plan_gold), format="json"
        )
        assert resp.status_code == 403

    def test_new_plan_can_get_its_own_policy(self, api, admin):
        """Item que motivou a tela: 'pode ser que mude ou tenha mais planos'."""
        from apps.customers.models import LimitPeriod, Plan

        novo = Plan.objects.create(
            slug="platinum", name="Platinum", rank=30,
            default_ticket_limit=50, default_limit_period=LimitPeriod.MONTHLY,
        )
        resp = api(admin).post(self.URL, {
            "name": "Platinum — global", "plan": novo.pk, "team": None,
            "first_response_minutes": 60, "resolution_minutes": 480,
            "use_business_hours": True, "is_active": True,
        }, format="json")
        assert resp.status_code == 201


class TestCalendarWriteFromTheScreen:
    URL = "/api/v1/settings/calendars/"

    def test_admin_edits_business_hours(self, api, admin):
        criado = api(admin).post(self.URL, {
            "name": "Comercial estendido", "timezone": "America/Sao_Paulo",
            "workdays": [{"weekday": d, "start": "08:00", "end": "20:00"}
                         for d in range(5)],
        }, format="json").json()

        resp = api(admin).patch(f"{self.URL}{criado['id']}/", {
            "workdays": [{"weekday": d, "start": "09:00", "end": "18:00"}
                         for d in range(6)],  # inclui sábado
        }, format="json")
        assert resp.status_code == 200
        assert len(resp.json()["workdays"]) == 6

    def test_admin_adds_a_holiday(self, api, admin):
        calendario = api(admin).post(self.URL, {
            "name": "Comercial", "timezone": "America/Sao_Paulo",
            "workdays": [{"weekday": 0, "start": "09:00", "end": "18:00"}],
        }, format="json").json()

        resp = api(admin).post("/api/v1/settings/holidays/", {
            "calendar": calendario["id"], "date": "2026-12-25", "name": "Natal",
        }, format="json")
        assert resp.status_code == 201
