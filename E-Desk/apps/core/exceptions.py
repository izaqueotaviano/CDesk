"""Tratamento de erro da API — o que chega no `detail` chega no usuário.

O front mostra `detail` direto (`errorMessage`, frontend/src/api/client.ts),
porque as mensagens do DRF já vêm em português por `LANGUAGE_CODE=pt-br`.
Uma exceção furava isso: `Http404`.

`get_object_or_404` levanta `Http404("No Ticket matches the given query.")` —
uma f-string do próprio Django, sem tradução por design (é texto de
depuração, para a página de erro do DEBUG). O handler padrão do DRF repassa
`exc.args` para `NotFound`, e essa frase em inglês, com o nome da classe do
model dentro, ia parar na tela de quem abre um ticket apagado.
"""

from django.http import Http404
from rest_framework import exceptions
from rest_framework.views import exception_handler as drf_exception_handler


def exception_handler(exc, context):
    if isinstance(exc, Http404) and _e_do_django(exc):
        # Sem `*exc.args`, o texto padrão de `NotFound` é traduzido:
        # "Não encontrado.". `Http404` levantado à mão com mensagem própria
        # (existem dois, "Arquivo indisponível.") passa intacto — quem
        # escreveu escolheu aquele texto para ser lido.
        exc = exceptions.NotFound()
    return drf_exception_handler(exc, context)


def _e_do_django(exc: Http404) -> bool:
    """A frase que o `get_object_or_404` monta, e só ela."""
    texto = str(exc)
    return texto.startswith("No ") and texto.endswith("matches the given query.")
