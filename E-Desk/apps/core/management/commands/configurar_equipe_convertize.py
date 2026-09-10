"""Substitui as equipes/agentes de demonstração pela equipe real da Convertize.

Pedido do Izaque: sair do "brinquedo" (Suporte/Financeiro de demo, com tickets
e chats fictícios) e já deixar o sistema com a equipe de verdade — Suporte,
Financeiro e Comercial, com as pessoas e e-mails reais, todo mundo admin.

Apaga TUDO que travaria a exclusão das equipes antigas (ticket, consumo de
cota e chat apontam pra equipe com `on_delete=PROTECT`) — ou seja, apaga
também os tickets e conversas de demonstração. As empresas clientes de
demo continuam (não têm relação nenhuma com equipe).

Idempotente: pode rodar mais de uma vez — cada rodada apaga o que sobrou da
vez anterior e recria do mesmo jeito.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Q

from apps.accounts.models import AgentTeam, InternalRole, Team, User, UserKind
from apps.chat.models import Chat
from apps.customers.models import TicketQuotaConsumption
from apps.tickets.models import Ticket

SENHA = "123mudar"  # noqa: S105 — senha inicial combinada; a pessoa troca depois

# equipe → [(nome, e-mail), ...], na ordem que o Izaque passou
EQUIPES = {
    "Suporte": [
        ("Marina", "marina@convertize.com.br"),
        ("Caroline", "caroline.tartaro@convertize.com.br"),
        ("Kelli", "kelli@convertize.com.br"),
        ("Izaque", "izaque@convertize.com.br"),
        ("Rafael", "rafael.cardoso@convertize.com.br"),
        ("Victor", "victor@convertize.com.br"),
        ("Luiz", "luiz@convertize.com.br"),
        ("Carla", "carla@convertize.com.br"),
    ],
    "Financeiro": [
        ("Bruna", "bruna.rodrigues@convertize.com.br"),
    ],
    "Comercial": [
        ("Rodrigo", "rodrigo@convertize.com.br"),
    ],
}


class Command(BaseCommand):
    help = "Troca as equipes/agentes de demonstração pela equipe real da Convertize."

    @transaction.atomic
    def handle(self, *args, **options):
        # mesma trava do seed_demo: isto apaga ticket e chat de verdade se
        # rodado no lugar errado — só em dev/demo, nunca em produção real.
        permitido = settings.DEBUG or getattr(settings, "DEMO_SEED_ALLOWED", False)
        if not permitido:
            raise CommandError(
                "Só roda em desenvolvimento ou ambiente de demonstração "
                "(DEBUG=True ou DEMO_SEED_ALLOWED=True) — apaga ticket e chat de verdade."
            )

        # ordem importa: consumo de cota e ticket se protegem mutuamente
        # (`on_delete=PROTECT`) — sem apagar o consumo primeiro, o ticket
        # não sai; sem apagar o ticket, a equipe não sai.
        n_cota, _ = TicketQuotaConsumption.objects.all().delete()
        n_tickets, _ = Ticket.objects.all().delete()
        n_chats, _ = Chat.objects.all().delete()
        n_equipes, _ = Team.objects.all().delete()

        # duas condições, não só `kind=INTERNAL`: uma conta com um dos e-mails
        # que vamos criar pode ter sobrado de uma rodada anterior interrompida
        # (ou de qualquer outro jeito) como CLIENTE — o e-mail é único no
        # banco inteiro, então essa sobra travaria o `create_user` mais abaixo
        # com "duplicate key" mesmo depois de limpar só os internos.
        emails_novos = [email for pessoas in EQUIPES.values() for _, email in pessoas]
        n_agentes, _ = User.objects.filter(
            Q(kind=UserKind.INTERNAL) | Q(email__in=emails_novos)
        ).delete()

        self.stdout.write(
            f"Apagado: {n_tickets} ticket(s), {n_cota} consumo(s) de cota, "
            f"{n_chats} sessão(ões) de chat, {n_equipes} equipe(s), "
            f"{n_agentes} conta(s) (interna ou com e-mail que ia ser recriado)."
        )

        criadas = []
        for nome_equipe, pessoas in EQUIPES.items():
            equipe = Team.objects.create(
                name=nome_equipe, slug=_slug(nome_equipe),
            )
            for nome, email in pessoas:
                pessoa = User.objects.create_user(
                    email=email, password=SENHA, full_name=nome,
                    kind=UserKind.INTERNAL, internal_role=InternalRole.ADMIN,
                )
                AgentTeam.objects.create(user=pessoa, team=equipe, is_default=True)
                criadas.append(f"{nome} <{email}> — {nome_equipe}")

        self.stdout.write(self.style.SUCCESS(
            f"\nCriadas {len(EQUIPES)} equipes e {len(criadas)} contas, "
            f"todas admin, senha \"{SENHA}\":",
        ))
        for linha in criadas:
            self.stdout.write(f"  {linha}")


def _slug(nome: str) -> str:
    from django.utils.text import slugify
    return slugify(nome)
