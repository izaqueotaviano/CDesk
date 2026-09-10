"""A trava em si — depois da 0008 ter unificado qualquer duplicata."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0008_coluna_status_unico"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="boardcolumn",
            constraint=models.UniqueConstraint(
                fields=("board", "maps_to_status"), name="uniq_status_per_board"
            ),
        ),
    ]
