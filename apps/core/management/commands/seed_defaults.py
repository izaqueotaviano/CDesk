"""Seed dos dados de configuração: planos, equipes, calendário e SLA.

Idempotente: usa update_or_create com os valores de docs/04-decisoes-tomadas.md.
Rode após `migrate`. Os números de SLA são os defaults marcados ⚠️ no doc —
ajustá-los é edição de dados, não de código.
"""

import datetime as dt

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from apps.accounts.models import Team, TeamVisibility
from apps.chat.models import ChatCloseReason, ClientQuickReply
from apps.core.models import BusinessCalendar, Holiday
from apps.customers.models import LimitPeriod, Plan
from apps.tickets.models import SLAPolicy, TicketCategory

WORKDAYS = [{"weekday": d, "start": "09:00", "end": "18:00"} for d in range(5)]

HOLIDAYS_2026 = [
    ("2026-01-01", "Confraternização Universal"),
    ("2026-02-16", "Carnaval"),
    ("2026-02-17", "Carnaval"),
    ("2026-04-03", "Sexta-feira Santa"),
    ("2026-04-21", "Tiradentes"),
    ("2026-05-01", "Dia do Trabalho"),
    ("2026-06-04", "Corpus Christi"),
    ("2026-09-07", "Independência"),
    ("2026-10-12", "Nossa Senhora Aparecida"),
    ("2026-11-02", "Finados"),
    ("2026-11-15", "Proclamação da República"),
    ("2026-11-20", "Consciência Negra"),
    ("2026-12-25", "Natal"),
]

PLANS = [
    # slug, name, rank, limite mensal de tickets, franquia de manutenção (min)
    #
    # A escada é Gold (básico) → Platinum → Black. Tudo acompanha o rank: quem
    # paga mais tem mais ticket, mais hora de manutenção e SLA mais curto.
    # Nenhum código supõe essa ordem — ela existe no dado, e mudar os números
    # aqui (ou na tela de Planos) não quebra nada.
    ("black", "Black", 30, 30, 600),
    ("platinum", "Platinum", 20, 15, 300),
    ("gold", "Gold", 10, 8, 180),
]

# D10 (⚠️ default): horas comerciais → minutos. (1ª resposta, resolução)
SLA_GLOBAL = {"black": (120, 480), "platinum": (240, 960), "gold": (480, 1440)}
SLA_FINANCEIRO = {"black": (240, 960), "platinum": (480, 1440), "gold": (960, 2400)}


#: Atalhos que o cliente clica em vez de digitar, no começo da conversa.
#: Cada texto é uma frase INACABADA de propósito — ela leva a pessoa até o
#: ponto em que só falta o dado que só ela tem (o número do pedido, o que a
#: tela mostrou). Frase pronta demais viraria mensagem vazia de conteúdo.
# Chat: frases que ABREM a conversa — é onde a pessoa trava.
QUICK_REPLIES = [
    ("Problema com um pedido", "Estou com um problema no pedido nº "),
    ("Erro na integração", "A integração parou de funcionar. O erro que aparece é: "),
    ("Dúvida sobre cobrança", "Tenho uma dúvida sobre a cobrança de "),
    ("Erro na loja", "A loja está apresentando este erro: "),
]

# Chamado: frases que RESPONDEM a quem já perguntou. Catálogo separado —
# "Estou com um problema no pedido nº" não é resposta a nada.
QUICK_REPLIES_TICKET = [
    ("Ainda estou com o problema", "O problema continua acontecendo. "),
    ("Já resolvi, pode fechar", "Consegui resolver por aqui, pode encerrar o ticket. Obrigado!"),
    ("Vou verificar e retorno", "Recebi, vou verificar por aqui e retorno com a informação."),
    ("Segue o print", "Segue em anexo o print do que está acontecendo."),
]


class Command(BaseCommand):
    help = "Popula planos, equipes, calendário comercial e políticas de SLA."

    #: Motivos de encerramento do chat. Nascem cadastrados pelo mesmo motivo
    #: dos atalhos: catálogo vazio faz o seletor sumir da tela de encerrar, e
    #: o relatório por motivo nasce sem eixo nenhum. O admin edita.
    #: (nome, exige observação)
    CLOSE_REASONS = [
        ("Resolvido", False),
        ("Sem resposta do cliente", False),
        ("Cliente desistiu", False),
        ("Duplicado", False),
        ("Virou ticket", False),
        ("Transferido para outro canal", True),
        ("Outro", True),
    ]

    #: Motivo renomeado depois de já existir em banco: a chave do
    #: `update_or_create` é o slug, então ele fica o de antes. Com o slug
    #: derivado do nome novo, rodar o seed de novo criaria um segundo motivo
    #: em vez de renomear o que já estava lá.
    SLUG_FIXO = {"Virou ticket": "virou-chamado"}

    @transaction.atomic
    def handle(self, *args, **options):
        calendar, _ = BusinessCalendar.objects.update_or_create(
            name="Horário comercial",
            defaults={
                "timezone": "America/Sao_Paulo",
                "is_default": True,
                "workdays": WORKDAYS,
            },
        )
        for date_str, name in HOLIDAYS_2026:
            Holiday.objects.update_or_create(
                calendar=calendar,
                date=dt.date.fromisoformat(date_str),
                defaults={"name": name},
            )

        plans = {}
        for slug, name, rank, limit, manutencao in PLANS:
            plans[slug], _ = Plan.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "rank": rank,
                    "default_ticket_limit": limit,
                    "monthly_maintenance_minutes": manutencao,
                    "default_limit_period": LimitPeriod.MONTHLY,
                    "chat_enabled": True,
                    "chat_consumes_quota": False,  # D2/F-A
                },
            )

        suporte, _ = Team.objects.update_or_create(
            slug="suporte",
            defaults={
                "name": "Suporte",
                "order": 1,
                "visibility": TeamVisibility.COMPANY_WIDE,
                "chat_calendar": calendar,
            },
        )
        financeiro, _ = Team.objects.update_or_create(
            slug="financeiro",
            defaults={
                "name": "Financeiro",
                "order": 2,
                # P2: a restrição é configuração da equipe, não código
                "visibility": TeamVisibility.REQUESTER_ONLY,
                "mask_subject_for_others": True,  # D6
                "chat_calendar": calendar,
            },
        )

        # Comercial é interno: o cliente não abre chamado aqui nem vê os que
        # existem. É para onde vai o aviso de franquia de horas esgotada.
        Team.objects.update_or_create(
            slug="comercial",
            defaults={
                "name": "Comercial",
                "order": 3,
                "visibility": TeamVisibility.COMPANY_WIDE,
                "internal_only": True,
                "chat_calendar": calendar,
            },
        )

        # ponto de partida da classificação — o admin cadastra as demais na tela
        for order, (slug, name) in enumerate([
            ("duvida", "Dúvida"),
            ("problema", "Problema"),
            ("solicitacao-de-servico", "Solicitação de serviço"),
        ], start=1):
            TicketCategory.objects.update_or_create(
                slug=slug, defaults={"name": name, "order": order}
            )

        for slug, (fr, res) in SLA_GLOBAL.items():
            SLAPolicy.objects.update_or_create(
                plan=plans[slug],
                team=None,  # vale para todas as equipes (menos específico)
                defaults={
                    "name": f"SLA {plans[slug].name} (geral)",
                    "first_response_minutes": fr,
                    "resolution_minutes": res,
                    "use_business_hours": True,  # D15
                },
            )
        for slug, (fr, res) in SLA_FINANCEIRO.items():
            SLAPolicy.objects.update_or_create(
                plan=plans[slug],
                team=financeiro,  # mais específico: vence sobre o geral
                defaults={
                    "name": f"SLA {plans[slug].name} (Financeiro)",
                    "first_response_minutes": fr,
                    "resolution_minutes": res,
                    "use_business_hours": True,
                },
            )

        # Atalhos de mensagem do chat. Nascem cadastrados de propósito: um
        # catálogo vazio deixa a fileira de chips sumir da tela, e o recurso
        # passa a depender de alguém descobrir a tela de admin para existir.
        # São de e-commerce porque é o negócio deste desk; o admin edita.
        for contexto, catalogo in (
            (ClientQuickReply.Contexto.CHAT, QUICK_REPLIES),
            (ClientQuickReply.Contexto.TICKET, QUICK_REPLIES_TICKET),
        ):
            for ordem, (rotulo, texto) in enumerate(catalogo):
                # a chave é (contexto, rotulo) — a mesma do UniqueConstraint,
                # senão rodar de novo criaria a linha do outro catálogo
                ClientQuickReply.objects.update_or_create(
                    contexto=contexto, rotulo=rotulo,
                    defaults={"texto": texto, "order": ordem},
                )

        for ordem, (nome, exige_nota) in enumerate(self.CLOSE_REASONS):
            ChatCloseReason.objects.update_or_create(
                slug=self.SLUG_FIXO.get(nome) or slugify(nome)[:50],
                defaults={"name": nome, "requires_note": exige_nota, "order": ordem},
            )

        self.stdout.write(self.style.SUCCESS(
            f"Defaults ok: {Plan.objects.count()} planos, "
            f"{Team.objects.count()} equipes, "
            f"{SLAPolicy.objects.count()} políticas de SLA, "
            f"{Holiday.objects.count()} feriados, "
            f"{ClientQuickReply.objects.count()} atalhos de mensagem, "
            f"{ChatCloseReason.objects.count()} motivos de encerramento."
        ))
