"""Segundo telefone da pessoa — cadastro de cliente exige pelo menos um dos
dois, mas nenhum é obrigatório sozinho (ver `UserAdminSerializer.validate`).
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0008_agentteam"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="phone_secondary",
            field=models.CharField(blank=True, max_length=32),
        ),
    ]
