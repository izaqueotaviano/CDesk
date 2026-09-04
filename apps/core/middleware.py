"""Middlewares transversais.

`RequestIdMiddleware`: um identificador por requisição, devolvido no header
`X-Request-ID` e disponível para o logging. Quando um cliente relata "deu
erro às 14:32", é este id que liga a tela ao log — sem ele, o log de
produção é uma lista de linhas sem dono. Aceita o id que o proxy já mandou
(nginx `$request_id`), para o mesmo número aparecer nos dois logs.
"""

import contextvars
import logging
import re
import uuid

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_ID_SEGURO = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def request_id_atual() -> str:
    return _request_id.get()


class RequestIdFilter(logging.Filter):
    """Injeta `%(request_id)s` em todo registro de log."""

    def filter(self, record):
        record.request_id = request_id_atual()
        return True


class RequestIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        vindo = request.META.get("HTTP_X_REQUEST_ID", "")
        rid = vindo if _ID_SEGURO.match(vindo) else uuid.uuid4().hex
        token = _request_id.set(rid)
        try:
            response = self.get_response(request)
        finally:
            _request_id.reset(token)
        response["X-Request-ID"] = rid
        return response
