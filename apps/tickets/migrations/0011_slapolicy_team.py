"""Passo 2 da fusão: a política de SLA ganha a coluna `team`.

Nula aqui de propósito — `0012_fusao_departamento_equipe` a preenche a partir
do departamento e `0013_departamento_sai_de_cena` derruba a coluna antiga.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0010_ticketnumbersequence_scope"),
        ("accounts", "0007_equipe_absorve_departamento"),
    ]

    operations = [
        migrations.AddField(
            model_name="slapolicy",
            name="team",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="sla_policies",
                to="accounts.team",
            ),
        ),
    ]
