"""Passo 3 da fusão: a sessão de chat ganha a coluna `team`.

Nula aqui; preenchida em `tickets.0012` e obrigatória em `0005`.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0003_chatsession_uniq_sessao_viva_por_cliente"),
        ("accounts", "0007_equipe_absorve_departamento"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatsession",
            name="team",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="chat_sessions",
                to="accounts.team",
            ),
        ),
    ]
