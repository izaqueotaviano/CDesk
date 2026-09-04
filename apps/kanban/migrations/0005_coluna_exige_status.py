"""Prepara os dados para a coluna passar a exigir status.

Coluna sem status era o buraco por onde o quadro deixava de ser "a fila vista
por coluna": chamado fixado ali ficava fora do próprio status, e status sem
coluna sumia da tela. O quadro é separado por status do ticket, e a partir
daqui isso é estrutura, não convenção.

O ALTER TABLE vem na migração seguinte: mexer nas linhas e alterar a
tabela na mesma transação faz o Postgres recusar (pending trigger events).

A conversão é conservadora — coluna livre VAZIA some, coluna livre COM cards
vira uma coluna de status (o status do primeiro chamado que está nela), para
que nenhum trabalho de ninguém desapareça na migração.
"""

from django.db import migrations


def resolver_colunas_livres(apps, schema_editor):
    BoardColumn = apps.get_model("kanban", "BoardColumn")
    Card = apps.get_model("kanban", "Card")

    for coluna in BoardColumn.objects.filter(maps_to_status__isnull=True):
        card = Card.objects.filter(column=coluna).select_related("ticket").first()
        if card is None:
            coluna.delete()
            continue
        # tinha gente fixada aqui: a coluna vira a do status desses chamados, e
        # a fixação some sozinha (o quadro passa a posicionar pelo status)
        coluna.maps_to_status = card.ticket.status
        coluna.save(update_fields=["maps_to_status"])


def sobra_alguma_sem_status(apps, schema_editor):
    """Rede: se sobrar coluna sem status, a coluna vira NOT NULL e o banco
    estoura no meio. Melhor parar aqui, com a causa à vista."""
    BoardColumn = apps.get_model("kanban", "BoardColumn")
    restantes = BoardColumn.objects.filter(maps_to_status__isnull=True).count()
    if restantes:
        raise RuntimeError(
            f"{restantes} coluna(s) ainda sem status — a conversão não cobriu tudo."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0004_board_sem_departamento"),
        ("tickets", "0014_ticketmention"),
    ]

    operations = [
        migrations.RunPython(resolver_colunas_livres, migrations.RunPython.noop),
        migrations.RunPython(sobra_alguma_sem_status, migrations.RunPython.noop),
    ]
