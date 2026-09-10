"""Passo 6 da fusão: a sessão de chat larga o departamento e fica com a equipe."""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0004_chatsession_team"),
        ("tickets", "0012_fusao_departamento_equipe"),
    ]

    operations = [
        migrations.RemoveField(model_name="chatsession", name="department"),
        migrations.AlterField(
            model_name="chatsession",
            name="team",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="chat_sessions",
                to="accounts.team",
            ),
        ),
    ]
