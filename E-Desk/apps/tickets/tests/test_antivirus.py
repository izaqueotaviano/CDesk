"""Quarentena antivírus dos anexos (D19).

O daemon é mockado: a suíte testa a *política* (o que o sistema faz com cada
veredito), não o ClamAV. O que precisa ficar provado aqui:

- anexo nasce bloqueado e só é liberado por um veredito explícito;
- daemon fora do ar nunca vira aprovação;
- a permissão continua vindo ANTES da quarentena — o status da varredura não
  pode virar um oráculo que revela a existência de anexo de outra empresa.
"""

import io
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.tickets.models import ScanStatus, TicketAttachment
from apps.tickets.services import antivirus
from apps.tickets.services.attachments import attach_to_message
from apps.tickets.tasks import scan_attachment

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def png(name="captura.png"):
    return SimpleUploadedFile(name, PNG, content_type="image/png")


@pytest.fixture
def message(make_ticket, ana, suporte):
    return make_ticket(ana, suporte).messages.first()


@pytest.fixture
def attachment(message, ana):
    """Anexo criado com o antivírus LIGADO — nasce em quarentena."""
    with override_settings(CLAMAV_ENABLED=True), mock.patch(
        "apps.tickets.services.attachments._schedule_scan"
    ):
        return attach_to_message(message=message, uploads=[png()], uploaded_by=ana)[0]


def scanner(verdict=None, raises=None):
    """Substitui o cliente do daemon por um resultado combinado."""
    if raises is not None:
        return mock.patch.object(antivirus, "scan_stream", side_effect=raises)
    return mock.patch.object(antivirus, "scan_stream", return_value=verdict)


class TestDaemonProtocol:
    """A tradução da resposta do clamd — a única parte que fala com o daemon.

    O resto da suíte mocka `scan_stream`; se a tradução estiver errada, tudo
    passa e nada funciona. Aqui o mock é só o socket.
    """

    def client(self, **behaviour):
        import clamd

        fake = mock.Mock()
        fake.instream.configure_mock(**behaviour)
        return mock.patch.object(
            antivirus, "_client", return_value=(clamd, fake)
        ), fake

    def test_ok_becomes_clean(self):
        patch, _ = self.client(return_value={"stream": ("OK", None)})
        with patch:
            assert antivirus.scan_stream(io.BytesIO(b"x")) == (antivirus.CLEAN, "")

    def test_found_carries_the_signature(self):
        patch, _ = self.client(
            return_value={"stream": ("FOUND", "Eicar-Test-Signature")}
        )
        with patch:
            assert antivirus.scan_stream(io.BytesIO(b"x")) == (
                antivirus.INFECTED,
                "Eicar-Test-Signature",
            )

    def test_daemon_error_is_not_an_approval(self):
        """ERROR do daemon não pode cair no caminho feliz por omissão."""
        patch, _ = self.client(return_value={"stream": ("ERROR", "database error")})
        with patch, pytest.raises(antivirus.ScanUnavailable):
            antivirus.scan_stream(io.BytesIO(b"x"))

    def test_connection_error_is_transient(self):
        import clamd

        patch, _ = self.client(side_effect=clamd.ConnectionError("refused"))
        with patch, pytest.raises(antivirus.ScanUnavailable):
            antivirus.scan_stream(io.BytesIO(b"x"))

    def test_buffer_too_long_is_definitive(self):
        import clamd

        patch, _ = self.client(side_effect=clamd.BufferTooLongError())
        with patch, pytest.raises(antivirus.ScanRejected):
            antivirus.scan_stream(io.BytesIO(b"x"))

    def test_missing_clamd_package_never_approves(self):
        """Sem o extra instalado, a varredura falha — não passa batido."""
        with mock.patch.dict("sys.modules", {"clamd": None}):
            with pytest.raises(antivirus.ScanUnavailable):
                antivirus.scan_stream(io.BytesIO(b"x"))


class TestQuarantineOnUpload:
    def test_attachment_is_born_pending_and_blocked(self, attachment):
        assert attachment.scan_status == ScanStatus.PENDING
        assert attachment.is_downloadable is False

    def test_scan_is_scheduled_after_commit(self, message, ana):
        """A task só pode ser enfileirada depois do commit: antes disso o
        worker buscaria uma linha que ainda não existe."""
        with override_settings(CLAMAV_ENABLED=True), mock.patch(
            "apps.tickets.tasks.scan_attachment.delay"
        ) as delay, mock.patch("django.db.transaction.on_commit", lambda fn: fn()):
            created = attach_to_message(
                message=message, uploads=[png()], uploaded_by=ana
            )
        delay.assert_called_once_with(created[0].pk)

    def test_disabled_scanner_says_skipped_not_clean(self, message, ana):
        """Desligado não é 'limpo'. O registro precisa dizer a verdade."""
        with override_settings(CLAMAV_ENABLED=False):
            created = attach_to_message(
                message=message, uploads=[png()], uploaded_by=ana
            )
        assert created[0].scan_status == ScanStatus.SKIPPED
        assert created[0].is_downloadable is True


class TestScanTask:
    def test_clean_verdict_releases_the_file(self, attachment):
        with scanner((antivirus.CLEAN, "")):
            scan_attachment(attachment.pk)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.CLEAN
        assert attachment.scanned_at is not None
        assert attachment.is_downloadable is True

    def test_infected_verdict_records_the_signature(self, attachment):
        with scanner((antivirus.INFECTED, "Eicar-Test-Signature")):
            scan_attachment(attachment.pk)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.INFECTED
        assert attachment.scan_signature == "Eicar-Test-Signature"
        assert attachment.is_downloadable is False

    def test_infected_file_is_kept_as_evidence(self, attachment):
        """Apagar o arquivo destruiria a evidência de que o upload aconteceu."""
        with scanner((antivirus.INFECTED, "Win.Trojan.Fake")):
            scan_attachment(attachment.pk)

        attachment.refresh_from_db()
        assert attachment.file.storage.exists(attachment.file.name)

    def test_infection_notifies_uploader_and_audits(self, attachment, ana):
        from apps.audit.models import AuditAction, AuditLog

        with scanner((antivirus.INFECTED, "Win.Trojan.Fake")):
            scan_attachment(attachment.pk)

        assert ana.notifications.filter(kind="attachment_blocked").exists()
        log = AuditLog.objects.get(action=AuditAction.SCAN_BLOCKED)
        assert "Win.Trojan.Fake" in log.summary

    def test_daemon_down_never_becomes_approval(self, attachment):
        """Retry, não aprovação. O anexo continua bloqueado no meio-tempo."""
        from celery.exceptions import Retry

        with scanner(raises=antivirus.ScanUnavailable("connection refused")):
            with pytest.raises(Retry):
                scan_attachment.apply(args=[attachment.pk], retries=0)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.PENDING
        assert attachment.scan_attempts == 1
        assert attachment.is_downloadable is False

    def test_exhausted_retries_fail_closed(self, attachment):
        with scanner(raises=antivirus.ScanUnavailable("connection refused")):
            scan_attachment.apply(args=[attachment.pk], retries=5)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.ERROR
        assert attachment.is_downloadable is False

    @override_settings(ATTACHMENT_BLOCK_ON_SCAN_ERROR=False)
    def test_fail_open_is_possible_but_explicit(self, attachment):
        """Existe a válvula para operação, mas ela é uma escolha declarada."""
        with scanner(raises=antivirus.ScanUnavailable("timeout")):
            scan_attachment.apply(args=[attachment.pk], retries=5)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.ERROR
        assert attachment.is_downloadable is True

    def test_file_too_large_for_daemon_is_definitive(self, attachment):
        """StreamMaxLength estourado: retry não ajuda, então não faz retry."""
        with scanner(raises=antivirus.ScanRejected("stream too long")):
            scan_attachment(attachment.pk)

        attachment.refresh_from_db()
        assert attachment.scan_status == ScanStatus.ERROR
        assert attachment.scan_attempts == 1

    def test_rescan_of_settled_attachment_is_a_noop(self, attachment):
        with scanner((antivirus.CLEAN, "")):
            scan_attachment(attachment.pk)
        attachment.refresh_from_db()
        before = attachment.scanned_at

        with scanner((antivirus.INFECTED, "tarde-demais")) as spy:
            scan_attachment(attachment.pk)

        spy.assert_not_called()
        attachment.refresh_from_db()
        assert attachment.scanned_at == before

    def test_deleted_attachment_does_not_crash_the_worker(self, attachment):
        pk = attachment.pk
        TicketAttachment.objects.filter(pk=pk).delete()
        assert scan_attachment(pk) == "gone"


class TestDownloadGate:
    def url(self, attachment):
        return f"/api/v1/attachments/{attachment.pk}/"

    def test_pending_returns_409_not_a_broken_file(self, api, attachment, ana):
        resp = api(ana).get(self.url(attachment))
        assert resp.status_code == 409
        # o código é o que a UI usa para decidir "tentar de novo" vs "desistir"
        assert resp.data["detail"].code == "attachment_scan_pending"

    def test_infected_returns_403(self, api, attachment, ana):
        with scanner((antivirus.INFECTED, "Eicar-Test-Signature")):
            scan_attachment(attachment.pk)

        resp = api(ana).get(self.url(attachment))
        assert resp.status_code == 403

    def test_clean_is_served(self, api, attachment, ana):
        with scanner((antivirus.CLEAN, "")):
            scan_attachment(attachment.pk)

        resp = api(ana).get(self.url(attachment))
        assert resp.status_code == 200
        assert b"".join(resp.streaming_content) == PNG

    def test_error_is_blocked_by_default(self, api, attachment, ana):
        TicketAttachment.objects.filter(pk=attachment.pk).update(
            scan_status=ScanStatus.ERROR
        )
        assert api(ana).get(self.url(attachment)).status_code == 403

    def test_permission_is_checked_before_quarantine(self, api, attachment, carla):
        """O status da varredura não pode virar oráculo de existência: quem não
        enxerga o ticket recebe 404, nunca o 409 de 'está em verificação'."""
        resp = api(carla).get(self.url(attachment))
        assert resp.status_code == 404

    def test_restricted_team_still_wins_over_scan_state(
        self, api, make_ticket, ana, beto, financeiro
    ):
        ticket = make_ticket(ana, financeiro)
        with override_settings(CLAMAV_ENABLED=True), mock.patch(
            "apps.tickets.services.attachments._schedule_scan"
        ):
            att = attach_to_message(
                message=ticket.messages.first(), uploads=[png()], uploaded_by=ana
            )[0]
        with scanner((antivirus.CLEAN, "")):
            scan_attachment(att.pk)

        # limpo, mas o colega do Financeiro continua sem acesso ao conteúdo
        assert api(beto).get(self.url(att)).status_code == 403


class TestDeployCheck:
    """Desligar o antivírus precisa ser uma decisão escrita, não um
    esquecimento que só aparece no incidente."""

    def test_disabled_scanner_fails_deploy_check(self):
        from apps.core.checks import antivirus_configured

        with override_settings(CLAMAV_ENABLED=False):
            ids = [problem.id for problem in antivirus_configured(None)]
        assert "edesk.E001" in ids

    def test_fail_open_is_a_warning_not_silence(self):
        from apps.core.checks import antivirus_configured

        with override_settings(
            CLAMAV_ENABLED=True, ATTACHMENT_BLOCK_ON_SCAN_ERROR=False
        ):
            ids = [problem.id for problem in antivirus_configured(None)]
        assert ids == ["edesk.W001"]

    def test_properly_configured_is_silent(self):
        from apps.core.checks import antivirus_configured

        with override_settings(
            CLAMAV_ENABLED=True, ATTACHMENT_BLOCK_ON_SCAN_ERROR=True
        ):
            assert antivirus_configured(None) == []


class TestSerializerExposesScanState:
    def test_ui_can_tell_pending_from_ready(self, api, attachment, ana):
        ticket = attachment.message.ticket
        detail = api(ana).get(f"/api/v1/tickets/{ticket.pk}/").json()
        payload = detail["messages"][0]["attachments"][0]

        assert payload["scan_status"] == "pending"
        assert payload["is_downloadable"] is False
        assert payload["url"] == f"/api/v1/attachments/{attachment.pk}/"
