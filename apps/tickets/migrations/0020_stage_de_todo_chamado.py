"""Nenhum chamado sem `stage` — a invariante escrita em movidesk.py, aplicada.

`status` e `stage` andam juntos: o primeiro é a categoria que o maquinário lê,
o segundo é o status que a pessoa vê na tela e a coluna do quadro. A migração
0016 ligou os chamados que existiam então, e `create_ticket` e o importador
preenchem desde sempre — mas `seed_demo` criava direto pelo ORM e deixava nulo,
e qualquer escrita futura fora do serviço faria o mesmo.

O sintoma era discreto e enganava: o quadro continuava desenhando o chamado
(existe um resgate para chamado órfão), mas Configurações → Status contava zero
em colunas visivelmente cheias — e "0 chamados" é exatamente o que faz um
administrador achar que pode apagar um status.

Idempotente: sem linhas nulas, não faz nada.
"""

from django.db import migrations


def ligar_ao_stage_da_categoria(apps, schema_editor):
    TicketStage = apps.get_model("tickets", "TicketStage")
    Ticket = apps.get_model("tickets", "Ticket")

    for categoria in Ticket.objects.filter(stage__isnull=True).values_list(
        "status", flat=True
    ).distinct():
        # o de fábrica da categoria é o destino certo; se alguém o apagou, o
        # primeiro ativo daquela categoria serve — o que não pode é ficar nulo
        stage = (
            TicketStage.objects.filter(category=categoria, is_system=True).first()
            or TicketStage.objects.filter(category=categoria, is_active=True)
            .order_by("order", "id").first()
        )
        if stage is not None:
            Ticket.objects.filter(status=categoria, stage__isnull=True).update(
                stage=stage
            )


def nada_a_desfazer(apps, schema_editor):
    """Sem reverso: soltar os chamados de volta recriaria o problema."""


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0019_mensagem_editada_apagada"),
    ]

    operations = [
        migrations.RunPython(ligar_ao_stage_da_categoria, nada_a_desfazer),
    ]
