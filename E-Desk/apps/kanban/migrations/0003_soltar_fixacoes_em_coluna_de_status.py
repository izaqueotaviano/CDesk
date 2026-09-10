"""Fixação só faz sentido em coluna LIVRE.

A 0002 transformou todo card antigo em fixação, inclusive os que estavam em
colunas de status. Isso produz a contradição que o modelo novo existe para
evitar: um ticket "aberto" preso na coluna "Aguardando cliente" — visto no
banco de desenvolvimento antes de virar esta migração.

Nas colunas de status o ticket já aparece pelo próprio status; a fixação ali
não acrescenta nada e só mente. Ela é solta; o prazo interno, se houver, fica.
"""

from django.db import migrations


def soltar(apps, schema_editor):
    Card = apps.get_model("kanban", "Card")
    presos = Card.objects.filter(column__maps_to_status__isnull=False)
    presos.filter(due_at__isnull=True).delete()
    presos.update(column=None)


class Migration(migrations.Migration):
    dependencies = [("kanban", "0002_card_como_anotacao")]

    operations = [migrations.RunPython(soltar, migrations.RunPython.noop)]
