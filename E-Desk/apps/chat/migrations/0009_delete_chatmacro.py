"""Unifica os dois cadastros de macro num só.

`ChatMacro` e `TicketMacro` eram quase iguais — diferiam em `chat_name` (só
no chat) e `body` (só no chamado). Manter os dois obrigava a escrever a
mesma resposta pronta duas vezes, e na prática o do chat ficou sem tela
nenhuma: o seletor "Aplicar macro" do chat nascia sempre vazio. `chat_name`
mudou-se para `TicketMacro` (migração 0023 de tickets) e o que existia aqui
é copiado para lá ANTES do modelo sair — apagar primeiro perderia macro que
alguém cadastrou pelo admin do Django.
"""

from django.db import migrations


def leva_macros_para_tickets(apps, schema_editor):
    ChatMacro = apps.get_model("chat", "ChatMacro")
    TicketMacro = apps.get_model("tickets", "TicketMacro")

    for antiga in ChatMacro.objects.all():
        # `name` é único nos dois. Colisão significa que a mesma macro foi
        # cadastrada dos dois lados: nesse caso a de chamado manda (ela tem
        # `body`, que a de chat nem tinha) e só o `chat_name` é herdado, em
        # vez de duplicar a linha com um nome inventado.
        existente = TicketMacro.objects.filter(name=antiga.name).first()
        if existente is not None:
            if antiga.chat_name and not existente.chat_name:
                existente.chat_name = antiga.chat_name
                existente.save(update_fields=["chat_name"])
            continue

        nova = TicketMacro.objects.create(
            name=antiga.name,
            body="",  # ChatMacro não tinha texto pronto
            chat_name=antiga.chat_name,
            category_id=antiga.category_id,
            priority=antiga.priority,
            assignee_id=antiga.assignee_id,
            is_active=antiga.is_active,
            order=antiga.order,
        )
        nova.tags.set(antiga.tags.all())


def volta(apps, schema_editor):
    """Sem volta automática: recriar `ChatMacro` a partir do cadastro unido
    exigiria adivinhar QUAIS macros vieram do chat, e a migração não guarda
    essa origem. Reverter é restaurar o backup, não rodar isto ao contrário."""
    raise RuntimeError(
        "Reversão não suportada: a unificação de macros perde a origem de "
        "cada linha. Restaure o backup anterior à migração."
    )


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0008_chat_v2_derruba_o_antigo"),
        # o `chat_name` precisa existir no destino antes da cópia
        ("tickets", "0023_alter_ticketmacro_options_ticketmacro_chat_name"),
    ]

    operations = [
        migrations.RunPython(leva_macros_para_tickets, volta),
        migrations.DeleteModel(name="ChatMacro"),
    ]
