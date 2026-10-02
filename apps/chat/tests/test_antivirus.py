"""Anexo de chat infectado (D19) — mesma política do anexo de ticket
(apps/tickets/tests/test_antivirus.py), incluindo o aviso por e-mail que
faltava: ATTACHMENT_BLOCKED só existia in-app, e o toggle de e-mail da tela
de Notificações não tinha efeito nenhum para este tipo.
"""

from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.chat.models import ChatMessage
from apps.chat.services.attachments import attach_to_chat_message
from apps.chat.tasks import scan_chat_file
from apps.notifications.models import NotificationPreference, OutboundEmail
from apps.tickets.services import antivirus

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def png(name="captura.png"):
    return SimpleUploadedFile(name, PNG, content_type="image/png")


@pytest.fixture
def message(chat_da_ana, ana):
    return ChatMessage.objects.create(chat=chat_da_ana, author=ana, body="segue o print")


@pytest.fixture
def chat_file(message, ana):
    """Anexo criado com o antivírus LIGADO — nasce em quarentena."""
    with override_settings(CLAMAV_ENABLED=True), mock.patch(
        "apps.chat.services.attachments._schedule_scan"
    ):
        return attach_to_chat_message(message=message, uploads=[png()], uploaded_by=ana)[0]


def scanner(verdict):
    return mock.patch.object(antivirus, "scan_stream", return_value=verdict)


class TestInfeccaoAvisaQuemEnviou:
    def test_infection_notifies_uploader(self, chat_file, ana):
        with scanner((antivirus.INFECTED, "Win.Trojan.Fake")):
            scan_chat_file(chat_file.pk)

        assert ana.notifications.filter(kind="attachment_blocked").exists()

    def test_infection_emails_the_uploader(self, chat_file, ana):
        with scanner((antivirus.INFECTED, "Win.Trojan.Fake")):
            scan_chat_file(chat_file.pk)

        email = OutboundEmail.objects.get(to_email=ana.email, template="attachment_blocked")
        assert chat_file.filename in email.subject

    def test_infection_email_desligado_nao_envia(self, chat_file, ana):
        NotificationPreference.objects.create(user=ana, email={"attachment_blocked": False})
        with scanner((antivirus.INFECTED, "Win.Trojan.Fake")):
            scan_chat_file(chat_file.pk)

        # sino continua ligado — só o e-mail foi desligado
        assert ana.notifications.filter(kind="attachment_blocked").exists()
        assert not OutboundEmail.objects.filter(template="attachment_blocked").exists()

    def test_clean_verdict_does_not_email(self, chat_file, ana):
        with scanner((antivirus.CLEAN, "")):
            scan_chat_file(chat_file.pk)

        assert not OutboundEmail.objects.filter(template="attachment_blocked").exists()
