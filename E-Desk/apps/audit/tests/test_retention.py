"""Política de retenção (D18).

O que precisa ficar provado aqui, em ordem de gravidade:

- **dry-run não apaga nada** — é o default, e é o que separa "revisar" de
  "perder dado";
- o ticket perde o **conteúdo**, não a **linha**: referência, datas, status e
  métricas sobrevivem, porque é sobre eles que o relatório do ano passado foi
  feito;
- ticket **aberto** nunca expira, por mais velho que seja;
- o log de uma anonimização **não** é expurgado — ele é a prova de cumprimento.
"""

import datetime as dt

import pytest
from django.test import override_settings
from django.utils import timezone

from apps.audit.models import AuditAction, AuditLog, RetentionRun, TicketAccessLog
from apps.audit.services import retention
from apps.audit.services.retention import PURGED_MARKER
from apps.tickets.models import Ticket, TicketStatus

pytestmark = pytest.mark.django_db


class TestDryRun:
    def test_dry_run_counts_without_touching_anything(self, closed_long_ago):
        ticket = closed_long_ago(subject="Fatura de 2020")

        cycle = retention.run(dry_run=True)

        assert cycle.results["ticket_content"]["matched"] == 1
        assert cycle.results["ticket_content"]["applied"] == 0
        assert ticket.reference in cycle.results["ticket_content"]["sample"]

        ticket.refresh_from_db()
        assert ticket.subject == "Fatura de 2020"
        assert ticket.retention_purged_at is None

    @override_settings(RETENTION_DRY_RUN=True)
    def test_default_is_dry_run(self, closed_long_ago):
        closed_long_ago()
        cycle = retention.run()
        assert cycle.dry_run is True
        assert cycle.total_applied == 0

    def test_run_is_recorded_for_review(self, closed_long_ago):
        """Dry-run que só vai para o log é teatro — precisa dar para revisar."""
        closed_long_ago()
        cycle = retention.run(dry_run=True)

        stored = RetentionRun.objects.get(pk=cycle.pk)
        assert stored.status == RetentionRun.Status.DONE
        assert stored.finished_at is not None
        assert stored.total_matched >= 1

    def test_cycle_is_audited(self, closed_long_ago):
        closed_long_ago()
        retention.run(dry_run=True)
        assert AuditLog.objects.filter(
            action=AuditAction.DELETE, summary__contains="simulação"
        ).exists()


class TestTicketContent:
    def test_purge_removes_content_keeps_the_row_and_metrics(
        self, closed_long_ago, ana, purge_authorized
    ):
        ticket = closed_long_ago(subject="Erro no boleto")
        reference, created = ticket.reference, ticket.created_at

        retention.run(dry_run=False)

        ticket.refresh_from_db()
        assert ticket.subject == PURGED_MARKER
        assert ticket.messages.first().body == PURGED_MARKER
        assert ticket.retention_purged_at is not None
        # o esqueleto sobrevive: é sobre ele que os relatórios foram feitos
        assert ticket.reference == reference
        assert ticket.created_at == created
        assert ticket.status == TicketStatus.CLOSED
        assert ticket.requester_id == ana.pk
        assert Ticket.objects.filter(pk=ticket.pk).exists()

    def test_open_ticket_never_expires(self, make_ticket, ana, suporte, purge_authorized):
        old = make_ticket(ana, suporte, subject="aberto há anos")
        Ticket.objects.filter(pk=old.pk).update(
            closed_at=timezone.now() - dt.timedelta(days=365 * 10)
        )

        cycle = retention.run(dry_run=False)

        assert cycle.results["ticket_content"]["matched"] == 0
        old.refresh_from_db()
        assert old.subject == "aberto há anos"

    def test_reopened_ticket_counts_from_the_last_close(
        self, closed_long_ago, purge_authorized
    ):
        """Gatilho é `closed_at`, reescrito a cada fechamento — reabrir em 2030
        não pode expirar pelo fechamento de 2026."""
        ticket = closed_long_ago()
        Ticket.objects.filter(pk=ticket.pk).update(closed_at=timezone.now())

        cycle = retention.run(dry_run=False)
        assert cycle.results["ticket_content"]["matched"] == 0

    def test_recent_ticket_is_untouched(self, make_ticket, ana, suporte, purge_authorized):
        recent = make_ticket(ana, suporte, subject="de ontem")
        Ticket.objects.filter(pk=recent.pk).update(
            status=TicketStatus.CLOSED, closed_at=timezone.now()
        )
        retention.run(dry_run=False)
        recent.refresh_from_db()
        assert recent.subject == "de ontem"

    def test_purge_is_idempotent(self, closed_long_ago, purge_authorized):
        closed_long_ago()
        first = retention.run(dry_run=False)
        second = retention.run(dry_run=False)

        assert first.results["ticket_content"]["applied"] == 1
        assert second.results["ticket_content"]["matched"] == 0


class TestLogPolicies:
    def test_old_audit_log_is_purged(self, ana, purge_authorized):
        from django.contrib.contenttypes.models import ContentType

        log = AuditLog.objects.create(
            actor=ana, action=AuditAction.UPDATE,
            content_type=ContentType.objects.get_for_model(ana),
            object_id=str(ana.pk), summary="antigo",
        )
        AuditLog.objects.filter(pk=log.pk).update(
            created_at=timezone.now() - dt.timedelta(days=365 * 3)
        )

        retention.run(dry_run=False)
        assert not AuditLog.objects.filter(pk=log.pk).exists()

    def test_lgpd_log_survives_the_purge(self, ana, purge_authorized):
        """Se o log da anonimização sumisse em 2 anos, você perderia justamente
        a prova de que cumpriu o pedido."""
        from django.contrib.contenttypes.models import ContentType

        log = AuditLog.objects.create(
            actor=ana, action=AuditAction.ANONYMIZE,
            content_type=ContentType.objects.get_for_model(ana),
            object_id=str(ana.pk), summary="pedido LGPD executado",
        )
        AuditLog.objects.filter(pk=log.pk).update(
            created_at=timezone.now() - dt.timedelta(days=365 * 9)
        )

        retention.run(dry_run=False)
        assert AuditLog.objects.filter(pk=log.pk).exists()

    def test_old_access_log_is_purged(self, make_ticket, ana, financeiro,
                                      agente_suporte, purge_authorized):
        ticket = make_ticket(ana, financeiro)
        log = TicketAccessLog.objects.create(
            ticket=ticket, user=agente_suporte, context="detail", was_granted=False
        )
        TicketAccessLog.objects.filter(pk=log.pk).update(
            created_at=timezone.now() - dt.timedelta(days=400)
        )

        retention.run(dry_run=False)
        assert not TicketAccessLog.objects.filter(pk=log.pk).exists()

    def test_read_notification_expires_unread_does_not(self, ana, purge_authorized):
        from apps.notifications.models import Notification, NotificationKind

        old = timezone.now() - dt.timedelta(days=120)
        read = Notification.objects.create(
            recipient=ana, kind=NotificationKind.ANNOUNCEMENT, title="lida",
            read_at=old,
        )
        unread = Notification.objects.create(
            recipient=ana, kind=NotificationKind.ANNOUNCEMENT, title="não lida",
        )
        Notification.objects.filter(pk__in=[read.pk, unread.pk]).update(created_at=old)

        retention.run(dry_run=False)

        assert not Notification.objects.filter(pk=read.pk).exists()
        assert Notification.objects.filter(pk=unread.pk).exists()


class TestResilience:
    def test_one_broken_policy_does_not_stop_the_others(
        self, closed_long_ago, monkeypatch, purge_authorized
    ):
        closed_long_ago()

        def explode(*, dry_run):
            raise RuntimeError("banco fora do ar")

        monkeypatch.setitem(retention.POLICIES, "audit_log", explode)
        cycle = retention.run(dry_run=False)

        assert cycle.status == RetentionRun.Status.FAILED
        assert "banco fora do ar" in cycle.results["audit_log"]["error"]
        # a política que funciona rodou assim mesmo
        assert cycle.results["ticket_content"]["applied"] == 1


class TestPurgeAuthorization:
    """A trava do expurgo efetivo (D20).

    `RETENTION_DRY_RUN=0` é uma linha de env. O que ela libera é exclusão
    irreversível de anos de histórico, na madrugada seguinte, sem ninguém por
    perto. A trava exige que alguém tenha aberto um relatório e dito, com nome
    e data, "pode apagar isso".
    """

    def test_effective_purge_without_a_reviewed_dry_run_is_refused(
        self, closed_long_ago
    ):
        ticket = closed_long_ago(subject="Fatura de 2019")

        with pytest.raises(retention.PurgeNotAuthorized):
            retention.run(dry_run=False)

        ticket.refresh_from_db()
        assert ticket.subject == "Fatura de 2019"  # nada foi tocado

    def test_simulation_never_needs_authorization(self, closed_long_ago):
        closed_long_ago()
        assert retention.run(dry_run=True).status == RetentionRun.Status.DONE

    def test_reviewing_a_simulation_unlocks_the_purge(self, closed_long_ago, admin):
        ticket = closed_long_ago()
        simulation = retention.run(dry_run=True)

        simulation.reviewed_by = admin
        simulation.reviewed_at = timezone.now()
        simulation.save(update_fields=["reviewed_by", "reviewed_at"])

        cycle = retention.run(dry_run=False)
        assert cycle.results["ticket_content"]["applied"] == 1
        ticket.refresh_from_db()
        assert ticket.subject == PURGED_MARKER

    def test_an_unreviewed_simulation_does_not_count(self, closed_long_ago):
        closed_long_ago()
        retention.run(dry_run=True)  # gerada, não revisada

        with pytest.raises(retention.PurgeNotAuthorized):
            retention.run(dry_run=False)

    @override_settings(RETENTION_REQUIRE_REVIEWED_DRY_RUN=False)
    def test_the_guard_can_be_disabled_but_that_is_a_declared_choice(
        self, closed_long_ago
    ):
        closed_long_ago()
        assert retention.run(dry_run=False).total_applied == 1

    def test_beat_does_not_explode_every_night_when_blocked(self, closed_long_ago):
        """A trava fazendo o trabalho dela não é erro de execução — estourar
        todo dia às 03h30 só ensinaria a ignorar o alerta."""
        from apps.audit.tasks import apply_retention_policy

        closed_long_ago()
        result = apply_retention_policy(dry_run=False)
        assert "blocked" in result


class TestReviewApi:
    def test_admin_simulates_reviews_and_unlocks(self, api, admin, closed_long_ago):
        closed_long_ago()
        client = api(admin)

        created = client.post("/api/v1/audit/retention/simulate/", {}, format="json")
        assert created.status_code == 201
        assert created.json()["dry_run"] is True
        assert created.json()["is_reviewed"] is False
        run_id = created.json()["id"]

        reviewed = client.post(f"/api/v1/audit/retention/{run_id}/review/", {
            "review_note": "Conferi as 3 referências; pode apagar.",
        }, format="json")
        assert reviewed.status_code == 200
        assert reviewed.json()["is_reviewed"] is True
        assert reviewed.json()["reviewed_by"] == admin.pk

        assert retention.run(dry_run=False).status == RetentionRun.Status.DONE

    def test_an_effective_cycle_cannot_be_reviewed(self, api, admin,
                                                   purge_authorized, closed_long_ago):
        closed_long_ago()
        cycle = retention.run(dry_run=False)
        resp = api(admin).post(f"/api/v1/audit/retention/{cycle.pk}/review/",
                               {}, format="json")
        assert resp.status_code == 400

    def test_non_admin_cannot_reach_it(self, api, agente_suporte):
        assert api(agente_suporte).post(
            "/api/v1/audit/retention/simulate/", {}, format="json"
        ).status_code == 403
