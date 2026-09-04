"""Mostra o código de verificação (2FA) de um usuário — SÓ em desenvolvimento.

O 2FA é obrigatório para todo login, e o código viaja por e-mail. Em
desenvolvimento o backend de e-mail é o console — mas quem imprime é o
**worker** do Celery, não o `web`, então `make logs` (que segue o `web`) não
mostra nada e a pessoa fica presa na tela do código achando que quebrou.

Este comando lê o código direto do banco, onde ele já fica em claro por
decisão registrada em `LoginCode` (vale 10 minutos, uso único, trava em 5
erros). Não enfraquece nada: quem roda isto já tem o banco na mão.

    python manage.py codigo_de_login ana@acme.test
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.accounts.models import LoginCode, User


class Command(BaseCommand):
    help = "Mostra o código de verificação vigente de um usuário (só em DEBUG)."

    def add_arguments(self, parser):
        parser.add_argument("email", help="e-mail de quem está tentando entrar")

    def handle(self, *args, **options):
        permitido = settings.DEBUG or getattr(settings, "DEMO_SEED_ALLOWED", False)
        if not permitido:
            raise CommandError(
                "codigo_de_login é só para desenvolvimento "
                "(DEBUG=True ou DEMO_SEED_ALLOWED=True)."
            )

        email = options["email"].strip().lower()
        user = User.objects.filter(email=email).first()
        if user is None:
            raise CommandError(f"Não existe usuário com o e-mail {email}.")

        codigo = (
            LoginCode.objects
            .filter(user=user, used_at__isnull=True, expires_at__gt=timezone.now())
            .order_by("-id")
            .first()
        )
        if codigo is None:
            raise CommandError(
                "Nenhum código válido agora. Peça o login na tela (ou 'Reenviar "
                "código') e rode de novo."
            )

        faltam = int((codigo.expires_at - timezone.now()).total_seconds() // 60)
        self.stdout.write(self.style.SUCCESS(codigo.code))
        self.stdout.write(f"({codigo.get_purpose_display()}, expira em ~{faltam} min)")
