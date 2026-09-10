"""Atualiza as contas de demonstração criadas antes da troca de nome.

O `seed_demo` só semeia banco vazio — quem já tinha o sistema rodando
continua com `admin@demo.titodesk.test` (ou `@demo.cvzdesk.test`) e a senha
antiga, enquanto a tela de boas-vindas passou a anunciar o endereço novo. O
resultado seria alguém tentando entrar com uma conta que não existe e
concluindo que o sistema quebrou.

Só mexe em endereço terminado em `.test`, que a RFC 6761 reserva para teste e
nenhuma pessoa de verdade usa. Rodar de novo não faz nada.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

# O produto já trocou de nome duas vezes; quem parou num banco de qualquer
# uma das eras precisa chegar no endereço de hoje.
DOMINIOS_ANTIGOS = ("@demo.titodesk.test", "@demo.cvzdesk.test")
DOMINIO_NOVO = "@demo.resolv.test"
SENHA_NOVA = "resolv123"


class Command(BaseCommand):
    help = "Migra as contas de demonstração para o nome novo (idempotente)."

    @transaction.atomic
    def handle(self, *args, **options):
        from apps.accounts.models import User

        # `.test` é o cinto de segurança: sem isto um endereço real poderia ter
        # a senha trocada por uma constante pública.
        demo = User.objects.filter(email__endswith=".test")
        if not demo.exists():
            self.stdout.write("Nenhuma conta de demonstração encontrada.")
            return

        renomeadas = 0
        for antigo in DOMINIOS_ANTIGOS:
            for user in demo.filter(email__endswith=antigo):
                novo = user.email.replace(antigo, DOMINIO_NOVO)
                if User.objects.filter(email=novo).exclude(pk=user.pk).exists():
                    # já existe a conta nova (banco semeado depois): a antiga é
                    # duplicata e fica como está, para não perder o histórico dela
                    continue
                user.email = novo
                user.save(update_fields=["email"])
                renomeadas += 1

        # a senha é a mesma para todo perfil de demonstração, e ela também mudou
        trocadas = 0
        for user in User.objects.filter(email__endswith=".test"):
            if not user.check_password(SENHA_NOVA):
                user.set_password(SENHA_NOVA)
                user.save(update_fields=["password"])
                trocadas += 1

        self.stdout.write(
            f"Contas de demonstração: {renomeadas} com endereço novo, "
            f"{trocadas} com a senha nova."
        )
