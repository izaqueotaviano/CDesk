"""Prazo legal dos pedidos de titular (LGPD art. 19: 15 dias).

Sem varredura, `due_at` é um campo bonito no banco que ninguém olha até a ANPD
perguntar. E um pedido que **falhou** precisa continuar sendo cobrado — foi
justamente esse o buraco do fluxo anterior, que devolvia falha para "pendente"
e a fazia parecer um pedido que nunca começou.
"""

import datetime as dt

import pytest
from django.utils import timezone

from apps.audit.models import DataSubjectRequest
from apps.audit.tasks import scan_lgpd_deadlines

pytestmark = pytest.mark.django_db


def due_in(request, days):
    DataSubjectRequest.objects.filter(pk=request.pk).update(
        due_at=timezone.now() + dt.timedelta(days=days, hours=1)
    )
    request.refresh_from_db()
    return request


class TestDeadlineIsSetOnCreation:
    def test_fifteen_days_by_default(self, dsr, ana):
        request = dsr(user=ana)
        assert request.due_at is not None
        assert 14 <= (request.due_at - timezone.now()).days <= 15

    def test_days_left_and_overdue_flags(self, dsr, ana):
        request = due_in(dsr(user=ana), 3)
        assert request.days_left == 3
        assert request.is_overdue is False

        request = due_in(dsr(user=ana), -1)
        assert request.is_overdue is True

    def test_closed_request_is_not_overdue(self, dsr, ana):
        request = due_in(dsr(user=ana), -5)
        request.status = DataSubjectRequest.Status.DONE
        request.save(update_fields=["status"])
        assert request.is_overdue is False
        assert request.days_left is None


class TestScan:
    def test_warns_at_eight_and_three_days(self, dsr, ana, admin):
        due_in(dsr(user=ana), 8)
        result = scan_lgpd_deadlines()

        assert result["warned"] == 1
        assert admin.notifications.filter(kind="lgpd_deadline").exists()

    def test_silent_on_a_quiet_day(self, dsr, ana, admin):
        due_in(dsr(user=ana), 11)
        assert scan_lgpd_deadlines() == {"warned": 0, "overdue": 0}
        assert not admin.notifications.filter(kind="lgpd_deadline").exists()

    def test_overdue_is_reported(self, dsr, ana, admin):
        due_in(dsr(user=ana), -2)
        result = scan_lgpd_deadlines()

        assert result["overdue"] == 1
        assert "VENCIDO" in admin.notifications.filter(
            kind="lgpd_deadline"
        ).first().title

    def test_failed_request_keeps_being_chased(self, dsr, ana, admin):
        """O prazo legal não para porque a execução quebrou."""
        request = due_in(dsr(user=ana), -1)
        request.status = DataSubjectRequest.Status.FAILED
        request.save(update_fields=["status"])

        assert scan_lgpd_deadlines()["overdue"] == 1

    def test_done_request_is_left_alone(self, dsr, ana, admin):
        request = due_in(dsr(user=ana), -30)
        request.status = DataSubjectRequest.Status.DONE
        request.save(update_fields=["status"])

        assert scan_lgpd_deadlines() == {"warned": 0, "overdue": 0}


class TestRejectionNeedsAReason:
    def test_rejecting_without_reason_is_refused(self, api, admin, dsr, ana):
        request = dsr(user=ana)
        resp = api(admin).post(
            f"/api/v1/audit/lgpd/{request.pk}/reject/", {}, format="json"
        )
        assert resp.status_code == 400

    def test_rejection_records_reason_and_who(self, api, admin, dsr, ana):
        request = dsr(user=ana)
        resp = api(admin).post(f"/api/v1/audit/lgpd/{request.pk}/reject/", {
            "rejection_reason": "Titular não confirmou identidade em 10 dias.",
        }, format="json")

        assert resp.status_code == 200
        request.refresh_from_db()
        assert request.status == DataSubjectRequest.Status.REJECTED
        assert "identidade" in request.rejection_reason
        assert request.executed_by_id == admin.pk


class TestFailedIsVisiblyDifferentFromPending:
    def test_failure_marks_failed_not_pending(self, dsr, ana, monkeypatch):
        from apps.audit import tasks
        from apps.audit.services import anonymization

        def explode(_dsr):
            raise RuntimeError("storage fora do ar")

        monkeypatch.setattr(anonymization, "anonymize", explode)
        request = dsr(user=ana)

        with pytest.raises(RuntimeError):
            tasks.execute_data_subject_request(request.pk)

        request.refresh_from_db()
        assert request.status == DataSubjectRequest.Status.FAILED
        assert "storage fora do ar" in request.error


class TestClamavCheckCommand:
    """O comando que fecha a lacuna que os testes não alcançam: o daemon real.

    Aqui ele é exercitado contra o servidor falso — o que prova a *lógica* de
    verificação (inclusive o caso perigoso: daemon que responde mas não
    detecta). A validação contra o ClamAV de verdade é o próprio comando, no
    ambiente de vocês.
    """

    def run_check(self, **kwargs):
        from django.core.management import call_command

        call_command("clamav_check", **kwargs)

    def test_fails_loudly_when_scanner_is_disabled(self, settings):
        from django.core.management.base import CommandError

        settings.CLAMAV_ENABLED = False
        with pytest.raises(CommandError, match="CLAMAV_ENABLED"):
            self.run_check()

    def test_fails_when_daemon_is_unreachable(self, settings):
        from django.core.management.base import CommandError

        settings.CLAMAV_ENABLED = True
        settings.CLAMAV_HOST, settings.CLAMAV_PORT = "127.0.0.1", 1
        with pytest.raises(CommandError, match="PING"):
            self.run_check()

    def test_fails_when_daemon_answers_but_does_not_detect(self, settings, monkeypatch):
        """O caso perigoso: base vazia aprova tudo em silêncio, o que é pior
        que estar fora do ar — dá falsa segurança."""
        from django.core.management.base import CommandError

        from apps.tickets.services import antivirus

        settings.CLAMAV_ENABLED = True
        monkeypatch.setattr(antivirus, "ping", lambda: True)
        monkeypatch.setattr(
            antivirus, "scan_stream", lambda fileobj: (antivirus.CLEAN, "")
        )
        with pytest.raises(CommandError, match="NÃO detectou o EICAR"):
            self.run_check()

    def test_passes_when_the_chain_is_healthy(self, settings, monkeypatch):
        from apps.tickets.services import antivirus

        settings.CLAMAV_ENABLED = True
        monkeypatch.setattr(antivirus, "ping", lambda: True)
        monkeypatch.setattr(
            antivirus, "scan_stream",
            lambda fileobj: (antivirus.INFECTED, "Eicar-Test-Signature"),
        )
        self.run_check(skip_size=True)  # não levanta

    def test_reports_stream_limit_smaller_than_attachment_limit(
        self, settings, monkeypatch
    ):
        """Se o StreamMaxLength for menor que o limite de anexo, todo anexo
        grande cai em `error` e fica bloqueado — melhor descobrir agora."""
        from django.core.management.base import CommandError

        from apps.tickets.services import antivirus

        settings.CLAMAV_ENABLED = True
        monkeypatch.setattr(antivirus, "ping", lambda: True)

        def scan(fileobj):
            payload = fileobj.read()
            if len(payload) > 1024:
                raise antivirus.ScanRejected("stream too long")
            return antivirus.INFECTED, "Eicar-Test-Signature"

        monkeypatch.setattr(antivirus, "scan_stream", scan)
        with pytest.raises(CommandError, match="StreamMaxLength"):
            self.run_check()
