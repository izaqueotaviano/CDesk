"""Os quatro status de fábrica, e todo chamado existente ligado ao seu.

Separada da 0015 (que só cria tabela e coluna) porque mexer em linha e alterar
tabela na mesma transação faz o Postgres recusar — a mesma lição de
kanban/0005+0006 e 0008+0009.

O `slug` de cada status de fábrica é IGUAL ao valor da categoria (`new`,
`open`, ...). Não é coincidência nem preguiça: é o que faz o backfill ser uma
igualdade simples e o que deixa uma URL antiga com `?status=open` continuar
significando a mesma coisa depois desta migração.
"""

from django.db import migrations

# (slug/categoria, nome, cor, ordem) — a ordem é a do fluxo, que é a ordem em
# que as colunas aparecem no quadro
DE_FABRICA = [
    ("new", "Novo", "#6C4E9C", 0),
    ("open", "Aberto", "#5A87B8", 1),
    ("pending_customer", "Aguardando retorno", "#E9A23B", 2),
    ("closed", "Fechado", "#8A8A85", 3),
]


def criar_e_ligar(apps, schema_editor):
    TicketStage = apps.get_model("tickets", "TicketStage")
    Ticket = apps.get_model("tickets", "Ticket")

    por_categoria = {}
    for slug, nome, cor, ordem in DE_FABRICA:
        stage, _ = TicketStage.objects.get_or_create(
            slug=slug,
            defaults={
                "name": nome, "category": slug, "color": cor,
                "order": ordem, "is_system": True, "is_active": True,
            },
        )
        por_categoria[slug] = stage

    # todo chamado começa no stage de fábrica da própria categoria — nenhum
    # fica sem coluna, que é a regra do quadro
    for categoria, stage in por_categoria.items():
        Ticket.objects.filter(status=categoria, stage__isnull=True).update(stage=stage)


def desligar(apps, schema_editor):
    """Reverso: solta os chamados e apaga os de fábrica. `Ticket.stage` é
    PROTECT, então soltar primeiro é obrigatório."""
    TicketStage = apps.get_model("tickets", "TicketStage")
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.update(stage=None)
    TicketStage.objects.filter(is_system=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0015_status_do_quadro"),
    ]

    operations = [
        migrations.RunPython(criar_e_ligar, desligar),
    ]
