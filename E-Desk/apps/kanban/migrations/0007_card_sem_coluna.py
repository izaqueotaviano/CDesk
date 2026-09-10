"""O card larga a coluna: quem posiciona o chamado é o status dele.

Fixar um ticket numa coluna era a outra metade do quadro que escondia trabalho
— o card ficava parado fora do próprio status. Com toda coluna exigindo status
(0005/0006), a fixação virou código inalcançável; some também do banco, para
que não reste um campo que só pode ser nulo esperando alguém reaproveitar.

O que o card ainda guarda é o que o status não responde: o prazo interno.
"""

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0006_coluna_status_obrigatorio"),
        ("tickets", "0014_ticketmention"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name="card",
            name="kanban_card_board_i_a61ba5_idx",
        ),
        migrations.RemoveField(
            model_name="card",
            name="column",
        ),
        migrations.AddIndex(
            model_name="card",
            index=models.Index(
                fields=["board", "ticket"], name="kanban_card_board_i_67e9f0_idx"
            ),
        ),
    ]
