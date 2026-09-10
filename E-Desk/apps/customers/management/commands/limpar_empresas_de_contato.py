"""Desfaz as "empresas" que na verdade são pessoas, vindas do import antigo.

O importador criava a empresa a partir do nome do contato, porque o export do
Movidesk não trazia a organização. O resultado é uma listagem cheia de
"Adrielly Saponi", "Alicia Moraes" — cada uma uma empresa Platinum com um
usuário só. O importador já foi corrigido; isto conserta o que ficou.

Roda em simulação por padrão. `--aplicar` é o que grava.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.tickets.services.movidesk import BALDE_NOME, BALDE_SLUG


class Command(BaseCommand):
    help = "Move contatos que viraram empresa para o balde 'Sem empresa'."

    def add_arguments(self, parser):
        parser.add_argument(
            "--aplicar", action="store_true",
            help="Grava as alterações. Sem esta opção, só mostra o que faria.",
        )

    def handle(self, *args, **options):
        from apps.accounts.models import User, UserKind
        from apps.customers.models import Company
        from apps.tickets.models import Ticket

        aplicar = options["aplicar"]
        alvos = []
        for empresa in Company.objects.exclude(slug=BALDE_SLUG):
            pessoas = list(User.objects.filter(company=empresa, kind=UserKind.CLIENT))
            # O critério é estreito de propósito: UMA pessoa, e o nome dela é o
            # nome da empresa. Empresa de verdade com um funcionário só existe,
            # mas ela não se chama igual ao funcionário. Preferir deixar passar
            # a arrastar um cliente legítimo para o balde.
            unica = len(pessoas) == 1
            if unica and pessoas[0].full_name.strip().lower() == empresa.name.strip().lower():
                alvos.append((empresa, pessoas[0]))

        if not alvos:
            self.stdout.write("Nenhuma empresa-contato encontrada.")
            return

        self.stdout.write(f"{len(alvos)} empresa(s) que são, na verdade, contatos:")
        for empresa, _pessoa in alvos[:20]:
            n = Ticket.objects.filter(company=empresa).count()
            self.stdout.write(f"  - {empresa.name} ({n} chamado(s))")
        if len(alvos) > 20:
            self.stdout.write(f"  … e mais {len(alvos) - 20}")

        if not aplicar:
            self.stdout.write(self.style.WARNING(
                "\nSimulação — nada foi gravado. Repita com --aplicar."
            ))
            return

        with transaction.atomic():
            from apps.customers.models import Plan

            balde, _ = Company.objects.get_or_create(
                slug=BALDE_SLUG,
                defaults={"name": BALDE_NOME, "plan": Plan.objects.order_by("rank").first(),
                          "is_active": False},
            )
            movidos = 0
            for empresa, pessoa in alvos:
                # o chamado acompanha a pessoa: cliente enxerga pelo vínculo de
                # empresa, e deixar o chamado para trás o tornaria invisível
                Ticket.objects.filter(company=empresa).update(company=balde)
                pessoa.company = balde
                # inativo enquanto está no balde — lá todos dividem a mesma
                # empresa, e cliente ativo veria o chamado dos outros
                pessoa.is_active = False
                pessoa.save(update_fields=["company", "is_active"])
                empresa.delete()
                movidos += 1

        self.stdout.write(self.style.SUCCESS(
            f"{movidos} contato(s) movidos para '{BALDE_NOME}' e as empresas falsas removidas."
        ))
