"""Fixtures das notas.

Reaproveita o elenco do conftest de tickets — duas empresas, equipes, agentes
e clientes. Nota pessoal só faz sentido em cima de gente que já existe no
sistema, e duplicar o elenco criaria uma segunda verdade sobre quem é quem.
O import é em estrela porque `pytest_plugins` só vale no conftest raiz (mesmo
motivo de `apps/audit/tests/conftest.py`).
"""

import pytest

from apps.tickets.tests.conftest import *  # noqa: F403


@pytest.fixture
def chamado(make_ticket, ana, suporte):  # noqa: F405
    """Um chamado qualquer para pendurar a nota.

    Nome próprio em vez de sobrescrever `make_ticket`: o import em estrela
    traz o original para ESTE mesmo namespace, e uma fixture que se chama
    igual ao que recebe vira dependência recursiva.
    """
    return make_ticket(ana, suporte)
