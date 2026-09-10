"""Chat v2, passo 1 de 3: cria os modelos novos que NÃO colidem de nome.

A reconstrução derruba ChatSession/ChatMessage/ChatAttachment e cria tudo de
novo — mas `tickets.Ticket.origin_chat` ainda aponta pro ChatSession antigo,
então a ordem obrigatória é: (1) criar `Chat` novo, (2) tickets reponta a FK
(0017), (3) derrubar os antigos e criar ChatMessage/ChatFile novos (0008).
Escrita à mão: o autodetector não resolve "mesmo nome, tabela nova".
"""

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0006_anexo_com_varredura"),
        ("customers", "0001_initial"),
        ("tickets", "0016_status_de_fabrica"),
        ("accounts", "0009_usuario_telefone_secundario"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Chat",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("status", models.CharField(choices=[("queued", "Na fila"), ("active", "Em atendimento"), ("closed", "Fechado")], db_index=True, default="queued", max_length=10)),
                ("name", models.CharField(blank=True, max_length=200)),
                ("priority", models.CharField(choices=[("low", "Baixa"), ("normal", "Normal"), ("high", "Alta"), ("urgent", "Urgente")], default="normal", max_length=10)),
                ("queued_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("closed_at", models.DateTimeField(blank=True, null=True)),
                ("reopen_count", models.PositiveSmallIntegerField(default=0)),
                ("agent_score", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("timeout_converted", models.BooleanField(default=False)),
                ("agent", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chats_atendidos", to=settings.AUTH_USER_MODEL)),
                ("assignee", models.ForeignKey(blank=True, help_text="Responsável que o ticket recebe na conversão. Vazio = o próprio agente.", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chats_designados", to=settings.AUTH_USER_MODEL)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chats", to="tickets.ticketcategory")),
                ("client", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="chats", to=settings.AUTH_USER_MODEL)),
                ("closed_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="chats_encerrados", to=settings.AUTH_USER_MODEL)),
                ("company", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="chats", to="customers.company")),
                ("tags", models.ManyToManyField(blank=True, related_name="chats", to="tickets.tickettag")),
            ],
            options={
                "verbose_name": "chat",
                "verbose_name_plural": "chats",
            },
        ),
        migrations.AddConstraint(
            model_name="chat",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ["queued", "active"])),
                fields=("client",),
                name="uniq_chat_aberto_por_login",
            ),
        ),
        migrations.CreateModel(
            name="ChatRating",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("service_score", models.PositiveSmallIntegerField(verbose_name="nota de atendimento")),
                ("resolution_score", models.PositiveSmallIntegerField(verbose_name="nota de resolução")),
                ("justification", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("chat", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="rating", to="chat.chat")),
            ],
            options={
                "verbose_name": "avaliação de chat",
                "verbose_name_plural": "avaliações de chat",
            },
        ),
        migrations.CreateModel(
            name="ChatConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("welcome_message", models.TextField(default="Olá {{nome_do_cliente}}, como podemos ajudar?", help_text="Enviada assim que o chat abre, antes de qualquer agente. Variável disponível: {{nome_do_cliente}}.")),
                ("queue_timeout_minutes", models.PositiveSmallIntegerField(default=10, help_text="Ninguém pegou nesse tempo → vira o ticket “Chat não atendido”.")),
                ("max_chats_per_agent", models.PositiveSmallIntegerField(default=3, help_text="No limite, o agente para de receber o aviso de chat novo.")),
                ("score_min", models.PositiveSmallIntegerField(default=0)),
                ("score_max", models.PositiveSmallIntegerField(default=10)),
                ("low_score_threshold", models.PositiveSmallIntegerField(default=5, help_text="Nota ABAIXO disso exige justificativa do cliente.")),
                ("default_team", models.ForeignKey(blank=True, help_text="Equipe que recebe o ticket da conversão automática (timeout).", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="accounts.team")),
            ],
            options={
                "verbose_name": "configuração do chat",
            },
        ),
        migrations.CreateModel(
            name="ChatMacro",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=80, unique=True)),
                ("chat_name", models.CharField(blank=True, max_length=200, verbose_name="nome do chat")),
                ("priority", models.CharField(blank=True, choices=[("low", "Baixa"), ("normal", "Normal"), ("high", "Alta"), ("urgent", "Urgente")], max_length=10)),
                ("is_active", models.BooleanField(default=True)),
                ("order", models.PositiveSmallIntegerField(default=0)),
                ("assignee", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL)),
                ("category", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to="tickets.ticketcategory")),
                ("tags", models.ManyToManyField(blank=True, related_name="+", to="tickets.tickettag")),
            ],
            options={
                "verbose_name": "macro de chat",
                "verbose_name_plural": "macros de chat",
                "ordering": ["order", "name"],
            },
        ),
        migrations.CreateModel(
            name="BannedWord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("word", models.CharField(max_length=60, unique=True)),
            ],
            options={
                "verbose_name": "palavra filtrada",
                "verbose_name_plural": "palavras filtradas",
            },
        ),
    ]
