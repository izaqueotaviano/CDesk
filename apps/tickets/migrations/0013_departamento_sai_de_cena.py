"""Passo 8, o último: `Department` deixa de existir.

Roda depois que accounts, chat e kanban já largaram suas FKs para ele — por
isso as dependências apontam para migrações POSTERIORES daqueles apps. Só aqui
as colunas antigas somem; até a migração anterior tudo ainda era reversível
por inspeção.

`Ticket.team` fecha o ciclo assumindo o contrato que era do departamento:
obrigatório e PROTECT. Ticket sem equipe não existe, e apagar uma equipe com
histórico atrás dela nunca pode ser um `DELETE` silencioso.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0012_fusao_departamento_equipe"),
        ("accounts", "0008_agentteam"),
        ("chat", "0005_chatsession_sem_departamento"),
        ("kanban", "0004_board_sem_departamento"),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="ticket", name="tickets_tic_departm_af9754_idx"
        ),
        migrations.RemoveField(model_name="ticket", name="department"),
        migrations.AlterField(
            model_name="ticket",
            name="team",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="tickets",
                to="accounts.team",
            ),
        ),
        migrations.AddIndex(
            model_name="ticket",
            index=models.Index(
                fields=["team", "status"], name="tickets_tic_team_id_3fd380_idx"
            ),
        ),
        migrations.RemoveConstraint(model_name="slapolicy", name="uniq_sla_policy"),
        migrations.RemoveField(model_name="slapolicy", name="department"),
        migrations.AddConstraint(
            model_name="slapolicy",
            constraint=models.UniqueConstraint(
                fields=("plan", "team"), name="uniq_sla_policy", nulls_distinct=False
            ),
        ),
        migrations.DeleteModel(name="Department"),
    ]
