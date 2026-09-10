"""O ALTER em si, depois de 0005 já ter resolvido as colunas livres."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("kanban", "0005_coluna_exige_status")]

    operations = [
        migrations.AlterField(
            model_name="boardcolumn",
            name="maps_to_status",
            field=models.CharField(
                choices=[
                    ("new", "Novo"),
                    ("open", "Aberto"),
                    ("pending_customer", "Aguardando retorno"),
                    ("closed", "Fechado"),
                ],
                max_length=20,
            ),
        ),
    ]
