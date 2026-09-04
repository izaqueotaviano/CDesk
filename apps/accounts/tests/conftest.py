"""Reaproveita o elenco do conftest de tickets — admin, supervisor, agentes e
clientes. Os testes de equipe precisam do mesmo mundo para provar quem lê e quem
escreve; fixtures locais dos módulos continuam tendo precedência sobre estas."""

from apps.tickets.tests.conftest import *  # noqa: F403
