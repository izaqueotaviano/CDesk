"""Chat v2, passo 3 de 3: derruba os modelos antigos e cria os que herdam
o nome (ChatMessage) ou o papel (ChatFile no lugar de ChatAttachment).

A ordem de exclusão segue as FKs: anexo → mensagem → sessão. A essa altura
`Ticket.origin_chat` já aponta pro `Chat` novo (tickets.0017), então nada
mais segura o `ChatSession`. `ChatMessage` novo nasce na sequência — mesmo
nome, TABELA nova (o DROP vem antes do CREATE, dentro da mesma transação).
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0007_chat_v2_cria"),
        ("tickets", "0017_origin_chat_v2"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.DeleteModel(name="ChatAttachment"),
        migrations.DeleteModel(name="ChatMessage"),
        migrations.DeleteModel(name="ChatSession"),
        migrations.CreateModel(
            name="ChatMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("body", models.TextField()),
                ("is_system", models.BooleanField(default=False)),
                ("sent_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("read_at", models.DateTimeField(blank=True, null=True)),
                ("author", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chat_messages", to=settings.AUTH_USER_MODEL)),
                ("chat", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="messages", to="chat.chat")),
            ],
            options={
                "verbose_name": "mensagem de chat",
                "verbose_name_plural": "mensagens de chat",
                "ordering": ["id"],
                "indexes": [models.Index(fields=["chat", "sent_at"], name="chat_chatme_chat_id_e7bcb8_idx")],
            },
        ),
        migrations.CreateModel(
            name="ChatFile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(upload_to="chat/%Y/%m/")),
                ("filename", models.CharField(max_length=255)),
                ("content_type", models.CharField(max_length=120)),
                ("size_bytes", models.PositiveIntegerField()),
                ("checksum", models.CharField(blank=True, max_length=64)),
                ("scan_status", models.CharField(choices=[("pending", "Em verificação"), ("clean", "Limpo"), ("infected", "Infectado"), ("error", "Falha na verificação"), ("skipped", "Não verificado")], db_index=True, default="pending", max_length=10)),
                ("scan_signature", models.CharField(blank=True, max_length=200)),
                ("scan_error", models.CharField(blank=True, max_length=250)),
                ("scan_attempts", models.PositiveSmallIntegerField(default=0)),
                ("scanned_at", models.DateTimeField(blank=True, null=True)),
                ("message", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="files", to="chat.chatmessage")),
                ("uploaded_by", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chat_files", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "verbose_name": "anexo de chat",
                "verbose_name_plural": "anexos de chat",
            },
        ),
    ]
