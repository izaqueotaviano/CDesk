"""Roda um ciclo de retenção e imprime o relatório.

Existe para o caminho de operação não depender do navegador: antes de habilitar
o expurgo você quer olhar, no terminal do servidor, exatamente o que sairia.

    python manage.py retention_report              # simulação (padrão)
    python manage.py retention_report --review     # simula e marca como revisado
    python manage.py retention_report --apply      # expurga de verdade
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.audit.services import retention

POLICY_LABEL = {
    "ticket_content": "Conteúdo de ticket fechado",
    "audit_log": "Log de auditoria (exceto LGPD)",
    "ticket_access_log": "Log de acesso restrito",
    "notification_read": "Notificação lida",
    "outbound_email": "E-mail enviado",
    "report_export_file": "Arquivo de exportação",
}


class Command(BaseCommand):
    help = "Executa um ciclo da política de retenção (D18) e imprime o resultado."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true",
            help="Expurga de verdade. Exige uma simulação revisada.",
        )
        parser.add_argument(
            "--review", action="store_true",
            help="Marca a simulação recém-gerada como revisada, destravando o expurgo.",
        )
        parser.add_argument(
            "--note", default="Revisado via manage.py retention_report.",
            help="Observação gravada na revisão.",
        )

    def handle(self, *args, **options):
        apply_now = options["apply"]
        if apply_now and options["review"]:
            raise CommandError("--review vale para simulação; não combine com --apply.")

        try:
            cycle = retention.run(dry_run=not apply_now)
        except retention.PurgeNotAuthorized as exc:
            raise CommandError(
                f"{exc}\n\n"
                "Rode `manage.py retention_report --review` para registrar a "
                "revisão desta simulação."
            ) from exc

        modo = "EXPURGO EFETIVO" if apply_now else "SIMULAÇÃO (nada foi apagado)"
        self.stdout.write(self.style.MIGRATE_HEADING(f"\nRetenção — {modo}"))
        self.stdout.write(f"Ciclo #{cycle.pk} · {cycle.get_status_display()}\n")

        width = max(len(label) for label in POLICY_LABEL.values())
        for key, result in cycle.results.items():
            label = POLICY_LABEL.get(key, key).ljust(width)
            line = f"  {label}  {result['matched']:>6} elegível(is)"
            if apply_now:
                line += f"  {result['applied']:>6} aplicado(s)"
            if result.get("error"):
                self.stdout.write(self.style.ERROR(f"{line}  ERRO: {result['error']}"))
                continue
            if result["matched"]:
                amostra = ", ".join(result["sample"][:5])
                line += f"   ex.: {amostra}"
            self.stdout.write(line)

        self.stdout.write(
            f"\n  Total: {cycle.total_matched} elegível(is), "
            f"{cycle.total_applied} aplicado(s).\n"
        )

        if options["review"]:
            cycle.reviewed_at = timezone.now()
            cycle.review_note = options["note"][:250]
            cycle.save(update_fields=["reviewed_at", "review_note"])
            self.stdout.write(self.style.SUCCESS(
                "Simulação marcada como revisada. Com RETENTION_DRY_RUN=0 o "
                "expurgo passa a rodar no ciclo diário."
            ))
        elif not apply_now:
            self.stdout.write(
                "Nada foi apagado. Para autorizar o expurgo: confira a lista "
                "acima e rode de novo com --review."
            )
