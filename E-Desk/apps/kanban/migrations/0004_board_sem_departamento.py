"""Passo 7 da fusão: o quadro larga o departamento.

O recorte do quadro sempre foi `department`; `team` existia ao lado sem efeito
nenhum. `tickets.0012` já copiou um para o outro — aqui só sai a coluna morta.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0003_soltar_fixacoes_em_coluna_de_status"),
        ("tickets", "0012_fusao_departamento_equipe"),
    ]

    operations = [
        migrations.RemoveField(model_name="board", name="department"),
    ]
