"""Reaplica anonimizações LGPD já concluídas.

**Rode isto depois de todo restore de backup.**

O problema que este comando resolve é fácil de não enxergar: uma anonimização
executada na terça e um restore do backup de segunda **desfazem** a exclusão.
O dado pessoal volta, o `DataSubjectRequest` continua dizendo "concluído", e
ninguém percebe — o sistema fica alegando ter cumprido um pedido que, na
prática, foi revertido.

Como a anonimização é idempotente e o `DataSubjectRequest` nunca é expurgado,
dá para simplesmente reexecutar todos os pedidos concluídos. O que já está
anonimizado é ignorado; o que voltou é limpo de novo.

    python manage.py reapply_lgpd --dry-run   # o que seria reaplicado
    python manage.py reapply_lgpd             # reaplica
    python manage.py reapply_lgpd --since 2026-01-01
"""

import datetime as dt

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.audit.models import DataSubjectRequest
from apps.audit.services import anonymization


class Command(BaseCommand):
    help = "Reaplica anonimizações concluídas (rodar após restore de backup)."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="Lista o que seria reaplicado, sem alterar nada.")
        parser.add_argument("--since", help="Só pedidos executados a partir de AAAA-MM-DD.")

    def handle(self, *args, **options):
        queryset = DataSubjectRequest.objects.filter(
            kind=DataSubjectRequest.Kind.ANONYMIZE,
            status=DataSubjectRequest.Status.DONE,
        ).select_related("subject_user", "subject_company").order_by("executed_at")

        if options["since"]:
            try:
                since = dt.datetime.strptime(options["since"], "%Y-%m-%d")
            except ValueError as exc:
                raise CommandError("Use o formato AAAA-MM-DD em --since.") from exc
            queryset = queryset.filter(
                executed_at__gte=timezone.make_aware(since)
            )

        total = queryset.count()
        if not total:
            self.stdout.write("Nenhuma anonimização concluída para reaplicar.")
            return

        self.stdout.write(
            self.style.MIGRATE_HEADING(f"\n{total} anonimização(ões) concluída(s)\n")
        )

        restored = 0
        for dsr in queryset:
            subject = (
                dsr.subject_user.email if dsr.subject_user_id
                else f"empresa #{dsr.subject_company_id}"
            )
            # se o titular voltou a ter PII, o restore desfez a exclusão
            reverted = bool(
                dsr.subject_user_id and dsr.subject_user.anonymized_at is None
            )
            mark = self.style.WARNING("REVERTIDO") if reverted else "ok"
            self.stdout.write(f"  #{dsr.pk:<5} {subject:<40} {mark}")

            if reverted:
                restored += 1
            if not options["dry_run"]:
                result = anonymization.anonymize(dsr)
                if result["users"] or result["attachments_purged"]:
                    dsr.result = {**dsr.result, "reapplied_at": timezone.now().isoformat()}
                    dsr.save(update_fields=["result"])

        if options["dry_run"]:
            self.stdout.write(
                f"\nSimulação: {restored} pedido(s) apareceriam revertidos.\n"
            )
        else:
            self.stdout.write(self.style.SUCCESS(
                f"\nReaplicado. {restored} pedido(s) estavam revertidos pelo restore.\n"
            ))
