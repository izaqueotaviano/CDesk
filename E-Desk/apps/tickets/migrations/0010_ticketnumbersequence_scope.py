"""A numeração do ticket deixa de reiniciar por ano (D12).

`year` vira `scope` em vez de ser descartado: o Postgres converte o valor
existente em texto ("2026"), então as linhas dos anos antigos sobrevivem como
histórico de quanto cada ano consumiu, ao lado da nova linha "global".

Nada é renumerado e a linha global NÃO é semeada aqui de propósito: ela nasce
zerada no primeiro `next_reference()`, de modo que o primeiro chamado novo é
`TD-00001` mesmo com `CVZ-`/`MD-` já no banco — que é o pedido literal do dono
do produto. As referências antigas continuam válidas porque são únicas e o
prefixo novo não colide com nenhuma delas.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0009_ticket_auto_close_warned_at_ticket_auto_closed"),
    ]

    operations = [
        migrations.RenameField(
            model_name="ticketnumbersequence",
            old_name="year",
            new_name="scope",
        ),
        migrations.AlterField(
            model_name="ticketnumbersequence",
            name="scope",
            field=models.CharField(max_length=20, unique=True),
        ),
    ]
