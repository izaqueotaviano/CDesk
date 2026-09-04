"""Busca sem sensibilidade a acento.

Achado de QA (persona de operação): buscar "acentuacao" não encontrava o
chamado "acentuação" — quem digita rápido não acentua, e o resultado vazio
lê como "esse chamado não existe". A extensão `unaccent` do Postgres é o que
permite `subject__unaccent__icontains` em `_busca_q` e na busca global.
"""

from django.contrib.postgres.operations import UnaccentExtension
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("tickets", "0023_alter_ticketmacro_options_ticketmacro_chat_name"),
    ]

    operations = [UnaccentExtension()]
