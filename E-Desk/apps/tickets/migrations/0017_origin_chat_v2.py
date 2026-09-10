"""Chat v2, passo 2 de 3: `Ticket.origin_chat` passa a apontar pro `Chat` novo.

Este é UM dos dois pontos de integração ticket↔chat (a conversão) — o único
toque permitido no módulo de tickets na reconstrução do chat.

Os vínculos antigos são zerados antes (RunPython): eles apontam para linhas
de `ChatSession`, que deixa de existir no passo 3 — mantê-los violaria a FK
nova. O ticket em si fica intacto (a transcrição já mora numa TicketMessage);
o que se perde é só o apontamento para uma conversa que está sendo removida.
"""

import django.db.models.deletion
from django.db import migrations, models


def zerar_vinculos_antigos(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.exclude(origin_chat=None).update(origin_chat=None)


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0016_status_de_fabrica"),
        ("chat", "0007_chat_v2_cria"),
    ]

    operations = [
        migrations.RunPython(zerar_vinculos_antigos, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="ticket",
            name="origin_chat",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="generated_ticket",
                to="chat.chat",
            ),
        ),
    ]
