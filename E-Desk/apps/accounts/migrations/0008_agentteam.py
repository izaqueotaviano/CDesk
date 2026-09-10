"""Passo 5 da fusão: `AgentDepartment` vira `AgentTeam` e a lotação única morre.

Duas coisas diziam a mesma coisa com respostas diferentes: `User.team` (UMA
equipe) e os vínculos de departamento (N departamentos). Aqui elas viram uma
só — o vínculo N:N agente↔equipe, que é o que governa a visibilidade (D1).

A lotação de `User.team` NÃO é descartada: ela vira mais um vínculo, somado aos
que já vieram dos departamentos. Perder essa linha seria tirar de um agente o
acesso a uma equipe que ele tinha ontem.
"""

import django.db.models.deletion
from django.db import migrations, models


def lotacao_vira_vinculo(apps, schema_editor):
    """`User.team` (singular) → uma linha em AgentTeam, sem tocar nas demais."""
    User = apps.get_model("accounts", "User")
    AgentTeam = apps.get_model("accounts", "AgentTeam")

    for user in User.objects.filter(team__isnull=False).iterator():
        ja_tem_padrao = AgentTeam.objects.filter(
            user_id=user.pk, is_default=True
        ).exists()
        AgentTeam.objects.get_or_create(
            user_id=user.pk,
            team_id=user.team_id,
            # A lotação era A equipe da pessoa: vira a pré-selecionada, a menos
            # que algum vínculo herdado do departamento já ocupe esse posto.
            defaults={"is_default": not ja_tem_padrao},
        )


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_equipe_absorve_departamento"),
        # a coluna `team` do vínculo só está preenchida depois da fusão de dados
        ("tickets", "0012_fusao_departamento_equipe"),
    ]

    operations = [
        # M2M com `through`: sai do estado sem tocar em tabela nenhuma.
        migrations.RemoveField(model_name="user", name="departments"),
        migrations.RemoveConstraint(
            model_name="agentdepartment", name="uniq_agent_department"
        ),
        migrations.RemoveField(model_name="agentdepartment", name="department"),
        migrations.AlterField(
            model_name="agentdepartment",
            name="team",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="agent_links",
                to="accounts.team",
            ),
        ),
        migrations.AlterField(
            model_name="agentdepartment",
            name="user",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="team_links",
                to="accounts.user",
            ),
        ),
        migrations.AlterField(
            model_name="agentdepartment",
            name="is_default",
            field=models.BooleanField(
                default=False,
                help_text="Equipe pré-selecionada nas telas do agente.",
            ),
        ),
        migrations.RenameModel(old_name="AgentDepartment", new_name="AgentTeam"),
        migrations.AlterModelOptions(
            name="agentteam",
            options={
                "verbose_name": "vínculo agente–equipe",
                "verbose_name_plural": "vínculos agente–equipe",
            },
        ),
        migrations.AddConstraint(
            model_name="agentteam",
            constraint=models.UniqueConstraint(
                fields=("user", "team"), name="uniq_agent_team"
            ),
        ),
        migrations.RunPython(lotacao_vira_vinculo, migrations.RunPython.noop),
        migrations.RemoveField(model_name="user", name="team"),
        migrations.AddField(
            model_name="user",
            name="teams",
            field=models.ManyToManyField(
                blank=True,
                related_name="agents",
                through="accounts.AgentTeam",
                to="accounts.team",
            ),
        ),
    ]
