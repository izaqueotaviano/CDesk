"""Reaproveita o elenco do conftest de tickets: os testes de configuração
precisam de admin, agente e cliente para provar quem lê e quem escreve."""

from apps.tickets.tests.conftest import *  # noqa: F403
