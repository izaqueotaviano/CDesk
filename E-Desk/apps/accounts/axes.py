"""Bloqueio por força bruta (django-axes) — o que acontece quando a trava fecha.

O axes conta as falhas de `authenticate()` por (e-mail, IP) e, no limite,
faz o backend recusar ANTES de conferir a senha. Esta função é a resposta
que a pessoa recebe nesse estado: JSON, 429 e um texto que diz quando
tentar de novo — a SPA já sabe mostrar `detail`.

Não confirma se o e-mail existe: a mensagem é a mesma para conta real e
inventada, como no login.
"""

from django.conf import settings
from django.http import JsonResponse


def bloqueado(request, credentials=None, *args, **kwargs):
    minutos = int(settings.AXES_COOLOFF_TIME.total_seconds() // 60)
    return JsonResponse(
        {
            "detail": (
                "Muitas tentativas de entrar com este e-mail. "
                f"Aguarde {minutos} minutos e tente de novo."
            ),
            "code": "login_bloqueado",
        },
        status=429,
        headers={"Retry-After": str(minutos * 60)},
    )
