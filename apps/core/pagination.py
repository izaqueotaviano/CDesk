"""Paginação padrão da API.

`LimitOffsetPagination` sem `max_limit` aceita qualquer inteiro em `?limit=` —
inclusive um que não cabe no bigint do PostgreSQL, que devolve 500 em todo
endpoint paginado do projeto. Achado na auditoria das notas; o teto fecha
isso para todos.

1000 é folga, não meta: a maior página que o frontend pede é 500. Acima do
teto o DRF apara em silêncio (`?limit=5000` vira 1000), que é o comportamento
certo para um número digitado na URL — recusar com 400 derrubaria a listagem
inteira por causa de um parâmetro.
"""

from rest_framework.pagination import LimitOffsetPagination


class LimitOffsetComTeto(LimitOffsetPagination):
    max_limit = 1000
