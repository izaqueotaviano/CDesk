"""Passo 1 da fusão departamento→equipe: a equipe ganha os campos do departamento.

Aqui só se ABRE espaço — nenhuma coluna velha sai e nenhum dado se move ainda.
A cópia acontece em `tickets.0012_fusao_departamento_equipe`, depois que todas
as tabelas envolvidas tiverem a coluna `team` para receber o repontamento.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_user_totp_secret_user_two_factor_method_accessevent_and_more"),
        ("core", "0001_initial"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="team",
            options={"ordering": ["order", "name"], "verbose_name": "equipe"},
        ),
        migrations.AddField(
            model_name="team",
            name="order",
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="team",
            name="visibility",
            field=models.CharField(
                choices=[
                    ("company_wide", "Toda a empresa cliente"),
                    ("requester_only", "Apenas o solicitante"),
                ],
                default="company_wide",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="team",
            name="mask_subject_for_others",
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name="team",
            name="internal_only",
            field=models.BooleanField(
                default=False,
                help_text="Equipe interna: o cliente não abre nem enxerga estes tickets.",
            ),
        ),
        migrations.AddField(
            model_name="team",
            name="chat_calendar",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="chat_teams",
                to="core.businesscalendar",
            ),
        ),
        migrations.AddField(
            model_name="team",
            name="notification_email",
            field=models.EmailField(blank=True, max_length=254),
        ),
        migrations.AddField(
            model_name="team",
            name="description",
            field=models.TextField(blank=True),
        ),
        # Nulo por enquanto: o vínculo ainda aponta para o departamento. A
        # coluna vira obrigatória em `0008_agentteam`, depois de preenchida.
        migrations.AddField(
            model_name="agentdepartment",
            name="team",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agent_links",
                to="accounts.team",
            ),
        ),
    ]
