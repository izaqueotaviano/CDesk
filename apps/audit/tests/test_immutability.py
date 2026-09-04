"""Imutabilidade das trilhas de auditoria (Pilar 4 §2).

O requisito: sobre AuditLog/TicketAccessLog um ator só faz INSERT — nunca UPDATE
nem DELETE de linha. Aqui isso deixa de ser convenção e vira invariante do ORM.

A retenção (expurgo em massa por queryset) é o único caminho que ainda apaga, de
propósito e auditado — está coberta em test_retention.py, e um teste abaixo prova
que ela não é bloqueada pela trava de instância.
"""

import pytest

from apps.audit.models import (
    AppendOnlyError,
    AuditAction,
    AuditLog,
    TicketAccessLog,
)

pytestmark = pytest.mark.django_db


def _make_log(**extra):
    from django.contrib.contenttypes.models import ContentType

    from apps.accounts.models import User

    ct = ContentType.objects.get_for_model(User)
    return AuditLog.objects.create(
        action=AuditAction.LOGIN, content_type=ct, object_id="1",
        summary="entrou", **extra,
    )


class TestAuditLogImmutable:
    def test_insert_is_allowed(self):
        log = _make_log()
        assert log.pk is not None

    def test_update_via_save_is_blocked(self):
        log = _make_log()
        log.summary = "adulterado"
        with pytest.raises(AppendOnlyError):
            log.save()
        log.refresh_from_db()
        assert log.summary == "entrou"  # nada mudou

    def test_update_via_save_update_fields_is_blocked(self):
        log = _make_log()
        log.action = AuditAction.DELETE
        with pytest.raises(AppendOnlyError):
            log.save(update_fields=["action"])

    def test_instance_delete_is_blocked(self):
        log = _make_log()
        with pytest.raises(AppendOnlyError):
            log.delete()
        assert AuditLog.objects.filter(pk=log.pk).exists()


class TestTicketAccessLogImmutable:
    def test_update_and_delete_blocked(self, make_ticket, ana, suporte):
        from apps.audit.services import record_ticket_access

        ticket = make_ticket(ana, suporte)
        record_ticket_access(ticket=ticket, user=ana, context="detail", granted=True)
        log = TicketAccessLog.objects.get(ticket=ticket)

        log.was_granted = False
        with pytest.raises(AppendOnlyError):
            log.save()
        with pytest.raises(AppendOnlyError):
            log.delete()


class TestRetentionStillPurges:
    """A trava de instância não pode quebrar o expurgo de sistema (delete em massa)."""

    def test_queryset_bulk_delete_bypasses_the_guard(self):
        log = _make_log()
        # é assim que a retenção apaga: queryset.delete(), não instance.delete()
        deleted, _ = AuditLog.objects.filter(pk=log.pk).delete()
        assert deleted == 1
        assert not AuditLog.objects.filter(pk=log.pk).exists()
