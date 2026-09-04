"""Configuração global da suíte.

O `SystemConfig` é lido através de cache (a leitura acontece em todo upload e
em toda varredura de chat — ir ao banco toda vez seria desperdício). O cache
sobrevive ao rollback de transação que isola cada teste: sem limpá-lo, um teste
que ajusta o limite de anexo contamina o próximo, que passa a ver um valor que
o banco não tem mais.
"""

import pytest
from django.core.cache import cache

#: Os status de fábrica, como a migração 0016 os cria.
STATUS_DE_FABRICA = [
    ("new", "Novo", "#6C4E9C", 0),
    ("open", "Aberto", "#5A87B8", 1),
    ("pending_customer", "Aguardando retorno", "#E9A23B", 2),
    ("closed", "Fechado", "#8A8A85", 3),
]


@pytest.fixture(autouse=True)
def _clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _status_de_fabrica(request):
    """Garante os quatro status de fábrica em TODO teste que toca o banco.

    Eles são dado de sistema: nascem numa migração de dados e o produto inteiro
    conta com eles (o chamado guarda um, o quadro desenha um por coluna). Mas
    todo teste marcado `django_db(transaction=True)` dá FLUSH nas tabelas ao
    terminar, e o flush leva junto o que veio de migração de dados — não só o
    que o teste criou.

    O estrago é a distância: quem paga não é o teste transacional, é o próximo
    que precisar de status, num arquivo que ninguém relacionou com ele. Já
    apareceu como dezenas de falhas em `apps/kanban` que passavam sozinhas e
    quebravam na suíte inteira, com a lista de culpados mudando conforme a
    ordem de execução.

    Recriar aqui é barato (uma consulta por teste de banco) e tira a ordem de
    execução da equação.
    """
    # Só pela MARCA, não por `db` estar em `fixturenames`: quem pega o banco
    # por uma fixture local (`def calendar(db)`) aparece lá, mas o banco ainda
    # não está montado quando um autouse do conftest roda — e a consulta aqui
    # estourava "Database access not allowed" num teste que não pediu nada
    # disso. A marca é injetada pelo plugin, que roda antes deste arquivo.
    if request.node.get_closest_marker("django_db") is None:
        yield
        return

    from apps.tickets.models import TicketStage

    if not TicketStage.objects.exists():
        TicketStage.objects.bulk_create(
            TicketStage(
                slug=slug, name=nome, category=slug, color=cor,
                order=ordem, is_system=True, is_active=True,
            )
            for slug, nome, cor, ordem in STATUS_DE_FABRICA
        )
    yield
