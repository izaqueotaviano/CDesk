"""A coluna do quadro deixa de ser uma tabela: ela é o status do ticket.

`BoardColumn` era uma segunda lista dizendo o que `Ticket.status` já dizia,
e cada bug do quadro saiu de as duas discordarem: status sem coluna fazia o
chamado sumir da tela (0005), duas colunas do mesmo status deixavam uma
delas vazia para sempre (0008). A coluna agora é `tickets.TicketStage` —
uma fonte só.

Nada aponta para `BoardColumn` desde a 0007 (o Card perdeu o campo
`column`), então a tabela sai sem deixar órfão.
"""

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0009_coluna_status_unico_trava"),
    ]

    operations = [
        migrations.DeleteModel(
            name="BoardColumn",
        ),
    ]
