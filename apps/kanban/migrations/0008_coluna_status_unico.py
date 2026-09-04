"""Prepara os dados para "um status, uma coluna" virar trava do banco.

Nada travava a mesma pessoa de, pelo editor da coluna, apontar DUAS colunas
para o mesmo status. `by_status` (board_view.py) é um dict — a segunda
ganharia os tickets e a primeira ficaria vazia para sempre, sem erro nenhum
dizendo por quê. Foi exatamente esse buraco que criou a duplicata que esta
migração limpa: `garantir_colunas_de_status` (migração 0005) resolvia colisão
de NOME dando um sufixo à coluna nova — nunca checava se o STATUS de destino
já tinha dono, e podia sair daqui com duas colunas de "closed" no mesmo quadro.

A constraint vem na migração seguinte: mexer nas linhas e alterar a tabela na
mesma transação faz o Postgres recusar (pending trigger events) — o mesmo
motivo de 0005/0006 terem sido separadas.

Conservador: para cada dupla, fica a coluna com nome "normal" (a pessoa deu
esse nome de propósito); a com sufixo " (status)" — a que nasceu sozinha da
garantia — é a que sai. Empate (as duas com ou sem sufixo) decide pela mais
antiga. Nada mais referencia BoardColumn desde a migração 0007 (Card perdeu o
campo `column`), então apagar a perdedora não deixa nada órfão.
"""

from django.db import migrations


def escolher_sobrevivente(colunas):
    """De um grupo de colunas do MESMO board+status, qual fica.

    Lógica pura, sem banco — para caber num teste sem precisar simular a
    migração inteira (o esquema de teste já nasce com a constraint aplicada,
    então não dá para nem CRIAR a duplicata por ali).

    `colunas` é qualquer sequência de objetos com `.name` e `.pk` (aceita a
    row do Django ou um duplo leve de teste), na ordem em que foram criadas.
    """
    return min(colunas, key=lambda c: (c.name.endswith(" (status)"), c.pk))


def unificar_colunas_duplicadas(apps, schema_editor):
    BoardColumn = apps.get_model("kanban", "BoardColumn")

    # (board_id, status) -> [colunas], só os grupos com mais de uma
    grupos = {}
    for coluna in BoardColumn.objects.exclude(maps_to_status=None).order_by("pk"):
        grupos.setdefault((coluna.board_id, coluna.maps_to_status), []).append(coluna)

    for (board_id, status), colunas in grupos.items():
        if len(colunas) < 2:
            continue

        fica = escolher_sobrevivente(colunas)
        for perdedora in colunas:
            if perdedora.pk != fica.pk:
                perdedora.delete()


def sobra_algum_status_duplicado(apps, schema_editor):
    """Rede: se sobrar duplicata, a constraint estoura no meio (migração
    seguinte) com um IntegrityError sem contexto. Melhor parar aqui."""
    BoardColumn = apps.get_model("kanban", "BoardColumn")
    from django.db.models import Count

    restantes = (
        BoardColumn.objects.exclude(maps_to_status=None)
        .values("board_id", "maps_to_status")
        .annotate(n=Count("pk"))
        .filter(n__gt=1)
    )
    if restantes:
        raise RuntimeError(
            f"{len(restantes)} par(es) board/status ainda duplicado(s) — "
            "a unificação não cobriu tudo."
        )


class Migration(migrations.Migration):

    dependencies = [
        ("kanban", "0007_card_sem_coluna"),
    ]

    operations = [
        migrations.RunPython(unificar_colunas_duplicadas, migrations.RunPython.noop),
        migrations.RunPython(sobra_algum_status_duplicado, migrations.RunPython.noop),
    ]
