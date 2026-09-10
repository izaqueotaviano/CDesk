"""Anonimização de titular (D11).

É o código mais destrutivo do sistema. O que precisa ficar provado:

- o dado pessoal sai e a **linha fica** — histórico das outras empresas e
  métricas intactos;
- o pseudônimo é **estável**: sem isso, dois titulares anonimizados viram
  indistinguíveis e a auditoria perde "estas ações foram da mesma pessoa";
- anexo perde o **blob**, não a linha;
- chat entra no escopo;
- texto livre **não** é apagado automaticamente: é sugerido para revisão.
"""

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.accounts.models import User
from apps.audit.services import anonymization
from apps.audit.services.anonymization import REDACTED
from apps.tickets.models import Ticket, TicketAttachment
from apps.tickets.services.attachments import attach_to_message

pytestmark = pytest.mark.django_db

PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestUserScrub:
    def test_pii_leaves_row_stays(self, dsr, ana, make_ticket, suporte):
        ticket = make_ticket(ana, suporte)
        request = dsr(user=ana)

        result = anonymization.anonymize(request)

        ana.refresh_from_db()
        assert ana.full_name == "Usuário anonimizado"
        assert ana.email == f"anonimizado-{ana.pk}@anonimizado.invalid"
        assert ana.phone == ""
        assert ana.google_sub is None
        assert ana.is_active is False
        assert ana.has_usable_password() is False
        assert result["users"] == [ana.pk]

        # o ticket continua inteiro: métrica e histórico da empresa não mudam
        ticket.refresh_from_db()
        assert Ticket.objects.filter(pk=ticket.pk).exists()
        assert ticket.requester_id == ana.pk

    def test_pseudonym_is_stable_and_distinct(self, dsr, ana, beto):
        anonymization.anonymize(dsr(user=ana))
        anonymization.anonymize(dsr(user=beto))

        ana.refresh_from_db()
        beto.refresh_from_db()
        assert ana.email != beto.email  # ainda dá para dizer que são pessoas diferentes

    def test_second_run_does_not_double_scrub(self, dsr, ana):
        anonymization.anonymize(dsr(user=ana))
        ana.refresh_from_db()
        first = ana.anonymized_at

        result = anonymization.anonymize(dsr(user=ana))
        ana.refresh_from_db()
        assert ana.anonymized_at == first
        assert result["users"] == []

    def test_other_company_is_untouched(self, dsr, ana, carla):
        anonymization.anonymize(dsr(user=ana))
        carla.refresh_from_db()
        assert carla.full_name != "Usuário anonimizado"
        assert carla.is_active is True


class TestCompanyScope:
    def test_company_request_drags_all_its_users(self, dsr, acme, ana, beto, carla):
        result = anonymization.anonymize(dsr(company=acme))

        assert set(result["users"]) >= {ana.pk, beto.pk}
        acme.refresh_from_db()
        assert acme.tax_id is None
        assert acme.is_active is False
        # nome fantasia fica: é âncora de relatório, não PII de titular
        assert acme.name

        carla.refresh_from_db()  # outra empresa
        assert carla.is_active is True

    def test_user_request_does_not_drag_the_company(self, dsr, ana, acme, beto):
        anonymization.anonymize(dsr(user=ana))

        acme.refresh_from_db()
        beto.refresh_from_db()
        assert acme.is_active is True
        assert beto.is_active is True


class TestAttachments:
    def test_blob_is_purged_row_survives(self, dsr, ana, make_ticket, suporte):
        ticket = make_ticket(ana, suporte)
        attachment = attach_to_message(
            message=ticket.messages.first(),
            uploads=[SimpleUploadedFile("doc.png", PNG, content_type="image/png")],
            uploaded_by=ana,
        )[0]
        storage, name = attachment.file.storage, attachment.file.name

        result = anonymization.anonymize(dsr(user=ana))

        attachment.refresh_from_db()
        assert result["attachments_purged"] == 1
        assert attachment.purged_at is not None
        assert attachment.is_downloadable is False
        assert not storage.exists(name)
        # a linha fica: a thread continua legível ("houve um anexo aqui")
        assert TicketAttachment.objects.filter(pk=attachment.pk).exists()
        assert attachment.filename == "doc.png"
        assert attachment.checksum


class TestChat:
    def test_chat_messages_are_redacted(self, dsr, ana, suporte, acme):
        from apps.chat.models import Chat, ChatMessage

        chat = Chat.objects.create(company=acme, client=ana)
        message = ChatMessage.objects.create(
            chat=chat, author=ana, body="meu cartão é 1234 5678 9012 3456"
        )

        result = anonymization.anonymize(dsr(user=ana))

        message.refresh_from_db()
        assert result["chat_messages_redacted"] == 1
        assert message.body == REDACTED


class TestFreeText:
    def test_pii_in_body_is_flagged_not_erased(self, dsr, ana, make_ticket, suporte):
        """Regex que apaga sozinho destrói conteúdo legítimo — e é irreversível."""
        ticket = make_ticket(ana, suporte, subject="Cobrança para 123.456.789-00")
        message = ticket.messages.first()
        message.body = "meu telefone é (11) 98765-4321, podem ligar"
        message.save(update_fields=["body"])

        result = anonymization.anonymize(dsr(user=ana))

        ticket.refresh_from_db()
        message.refresh_from_db()
        # o texto continua lá — o que temos é uma lista para revisão humana
        assert "123.456.789-00" in ticket.subject
        assert "98765-4321" in message.body

        patterns = {c["pattern"] for c in result["free_text_candidates"]}
        assert "cpf" in patterns
        assert "telefone" in patterns

    def test_clean_text_produces_no_candidates(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte, subject="Site fora do ar")
        result = anonymization.anonymize(dsr(user=ana))
        assert result["free_text_candidates"] == []

    def test_manual_redaction_keeps_the_original_in_the_audit(
        self, ana, make_ticket, suporte, admin
    ):
        from apps.audit.models import AuditAction, AuditLog

        ticket = make_ticket(ana, suporte, subject="CPF 123.456.789-00")

        done = anonymization.redact_free_text(
            model="ticket", pk=ticket.pk, actor=admin
        )

        ticket.refresh_from_db()
        assert done is True
        assert ticket.subject == REDACTED

        # sem o original guardado, uma redação equivocada é irreversível e
        # ninguém consegue nem dizer o que havia ali
        log = AuditLog.objects.filter(action=AuditAction.ANONYMIZE).latest("created_at")
        assert log.changes["subject"][0] == "CPF 123.456.789-00"
        assert log.actor_id == admin.pk

    def test_redacting_twice_is_a_noop(self, ana, make_ticket, suporte, admin):
        ticket = make_ticket(ana, suporte, subject="CPF 123.456.789-00")
        anonymization.redact_free_text(model="ticket", pk=ticket.pk, actor=admin)
        assert anonymization.redact_free_text(
            model="ticket", pk=ticket.pk, actor=admin
        ) is False


class TestReferentialIntegrity:
    def test_nothing_is_hard_deleted(self, dsr, ana, make_ticket, suporte):
        make_ticket(ana, suporte)
        before = Ticket.objects.count()

        anonymization.anonymize(dsr(user=ana))

        assert Ticket.objects.count() == before
        assert User.objects.filter(pk=ana.pk).exists()


class TestBackupRestoreSafetyNet:
    """Uma anonimização executada na terça e um restore do backup de segunda
    desfazem a exclusão — e o pedido continua dizendo "concluído".

    `reapply_lgpd` é o antídoto: como a anonimização é idempotente e o
    `DataSubjectRequest` nunca é expurgado, dá para reexecutar tudo.
    """

    def test_reapply_restores_anonymization_undone_by_a_restore(self, dsr, ana):
        from django.core.management import call_command

        from apps.audit.models import DataSubjectRequest

        request = dsr(user=ana)
        anonymization.anonymize(request)
        request.status = DataSubjectRequest.Status.DONE
        request.save(update_fields=["status"])

        # simula o restore: o backup trouxe o usuário de volta com PII
        ana.full_name = "Ana Almeida"
        ana.email = "ana@acme.test"
        ana.phone = "(11) 99999-0000"
        ana.anonymized_at = None
        ana.is_active = True
        ana.save()

        call_command("reapply_lgpd", verbosity=0)

        ana.refresh_from_db()
        assert ana.full_name == "Usuário anonimizado"
        assert ana.anonymized_at is not None
        assert ana.phone == ""

    def test_dry_run_reports_without_changing(self, dsr, ana):
        from django.core.management import call_command

        from apps.audit.models import DataSubjectRequest

        request = dsr(user=ana)
        anonymization.anonymize(request)
        request.status = DataSubjectRequest.Status.DONE
        request.save(update_fields=["status"])

        ana.full_name = "Ana Almeida"
        ana.anonymized_at = None
        ana.save()

        call_command("reapply_lgpd", "--dry-run", verbosity=0)

        ana.refresh_from_db()
        assert ana.full_name == "Ana Almeida"  # intocado

    def test_reapply_is_a_noop_when_nothing_was_reverted(self, dsr, ana):
        from django.core.management import call_command

        from apps.audit.models import DataSubjectRequest

        request = dsr(user=ana)
        anonymization.anonymize(request)
        request.status = DataSubjectRequest.Status.DONE
        request.save(update_fields=["status"])
        ana.refresh_from_db()
        before = ana.anonymized_at

        call_command("reapply_lgpd", verbosity=0)

        ana.refresh_from_db()
        assert ana.anonymized_at == before  # não re-anonimiza o já anonimizado
