"""Importa tickets exportados do Movidesk.

    python manage.py import_movidesk tickets_completo.json --limit 100
    python manage.py import_movidesk tickets_completo.csv  --limit 100

JSON ou CSV — o formato é decidido pela extensão. Sem `--limit` importa o
arquivo inteiro. A regra de negócio toda vive em
`apps.tickets.services.movidesk`; aqui é só a linha de comando.
"""

import csv
import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import Team
from apps.customers.models import Plan
from apps.tickets.services import movidesk


def em_container() -> bool:
    """O arquivo que o Docker cria na raiz de todo contêiner."""
    return Path("/.dockerenv").exists()


class Command(BaseCommand):
    help = "Importa tickets do arquivo JSON exportado do Movidesk."

    def add_arguments(self, parser):
        parser.add_argument("arquivo", help="Caminho do tickets_completo.json")
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Importa só os N mais recentes (por data de abertura).",
        )
        parser.add_argument(
            "--team", default=None,
            help="Slug da equipe de destino (padrão: a primeira ativa). "
                 "O export do Movidesk não traz equipe.",
        )
        parser.add_argument(
            "--plan", default=None,
            help="Slug do plano das empresas criadas (padrão: o de menor rank).",
        )
        parser.add_argument(
            "--dry-run", action="store_true",
            help="Lê o arquivo e mostra o que faria, sem gravar nada.",
        )

    def handle(self, *args, **options):
        tickets = self._load(options["arquivo"])
        team = self._team(options["team"])
        plan = self._plan(options["plan"])
        limit = options["limit"]

        self.stdout.write(
            f"{len(tickets)} tickets no arquivo; "
            f"importando {limit or len(tickets)} para “{team.name}”."
        )

        if options["dry_run"]:
            self._preview(movidesk.most_recent(tickets, limit))
            return

        report = movidesk.import_tickets(
            tickets, team=team, plan=plan, limit=limit
        )
        for line in report.as_lines():
            self.stdout.write(f"  {line}")
        for aviso in report.warning_lines():
            self.stdout.write(self.style.WARNING(f"  ! {aviso}"))
        self.stdout.write(self.style.SUCCESS("Importação concluída."))

    # ---- entrada -----------------------------------------------------------

    @classmethod
    def _load(cls, caminho: str) -> list[dict]:
        path = Path(caminho)
        if not path.exists():
            raise CommandError(cls._nao_encontrado(path))

        if path.suffix.lower() == ".csv":
            # utf-8-sig: o exportador escreve BOM para o Excel abrir certo em
            # pt-BR, e sem isto o BOM entra colado no nome da primeira coluna
            with path.open(encoding="utf-8-sig", newline="") as arquivo:
                linhas = list(csv.DictReader(arquivo))
            if not linhas or "ticket_id" not in (linhas[0] or {}):
                raise CommandError(
                    "O CSV não parece ser o do exportador: falta a coluna "
                    "`ticket_id`. Gere com `scripts/baixar_movidesk.py --csv`."
                )
            return movidesk.from_csv(linhas)

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise CommandError(f"JSON inválido em {path}: {exc}") from exc
        if not isinstance(data, list):
            raise CommandError(
                "O arquivo deve ser a LISTA de tickets gerada pelo exportador "
                "(tickets_completo.json)."
            )
        return data

    @staticmethod
    def _nao_encontrado(path: Path) -> str:
        """O erro provável não é o nome errado — é o arquivo fora do volume.

        Dentro do contêiner só existe o que o compose monta, e ele monta a
        pasta do projeto em `/app`. Um CSV em `~/Downloads` não existe daqui,
        e "arquivo não encontrado" sozinho manda conferir um nome que está
        certo. Então: digo onde o arquivo precisa estar e listo o que já está.
        """
        recado = [f"Arquivo não encontrado: {path}"]

        if em_container():
            recado += [
                "",
                "Dentro do contêiner só existe o que está montado, e o compose "
                "monta a pasta do projeto em /app. Copie o arquivo para lá "
                "(no terminal da sua máquina, dentro da pasta do projeto):",
                "",
                f"    cp ~/Downloads/{path.name} .",
                f"    docker compose exec web python manage.py import_movidesk /app/{path.name}",
            ]

        raiz = Path(settings.BASE_DIR)
        achados = sorted(
            p.name for p in raiz.glob("*")
            if p.is_file() and p.suffix.lower() in {".csv", ".json"}
        )
        if achados:
            recado += ["", "Arquivos de dados na pasta do projeto: " + ", ".join(achados[:8])]

        return "\n".join(recado)

    @staticmethod
    def _team(slug: str | None) -> Team:
        if slug:
            team = Team.objects.filter(slug=slug).first()
            if team is None:
                raise CommandError(f"Equipe “{slug}” não existe.")
            return team
        team = Team.objects.filter(is_active=True).order_by("order").first()
        if team is None:
            raise CommandError("Nenhuma equipe cadastrada. Rode `seed_defaults` antes.")
        return team

    @staticmethod
    def _plan(slug: str | None) -> Plan:
        if slug:
            plan = Plan.objects.filter(slug=slug).first()
            if plan is None:
                raise CommandError(f"Plano “{slug}” não existe.")
            return plan
        plan = Plan.objects.filter(is_active=True).order_by("rank").first()
        if plan is None:
            raise CommandError("Nenhum plano cadastrado. Rode `seed_defaults` antes.")
        return plan

    def _preview(self, tickets: list[dict]) -> None:
        self.stdout.write("\n  (simulação — nada foi gravado)\n")
        for raw in tickets[:10]:
            clients = raw.get("clients") or [{}]
            self.stdout.write(
                f"  MD-{raw.get('id')}  {(raw.get('createdDate') or '')[:10]}  "
                f"{(raw.get('status') or '—'):<16} "
                f"{(clients[0].get('businessName') or '—')[:28]:<30} "
                f"{(raw.get('subject') or '')[:50]}"
            )
        if len(tickets) > 10:
            self.stdout.write(f"  … e mais {len(tickets) - 10}")
