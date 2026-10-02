"""Autenticação de sessão que devolve 401 de verdade quando não há sessão.

O DRF só consulta a `authenticate_header()` do autenticador de ÍNDICE 0 da
lista (`APIView.get_authenticate_header`) para decidir se um
`NotAuthenticated`/`AuthenticationFailed` vira 401 ou é rebaixado para 403
(`APIView.handle_exception`). A `SessionAuthentication` de fábrica devolve
`None` ali — de propósito, para não abrir um prompt nativo de Basic Auth no
navegador —, e como ela é sempre a primeira da lista
(`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`), isso baixava TODO "sem
sessão" deste backend para 403, mesmo fora do navegador: esta API é uma SPA
via `fetch`, não tem prompt nenhum para evitar.

Efeito prático do bug: o interceptor global de 401 do frontend
(`aoDeslogar`, docs/07-arquitetura-frontend.md) nunca disparava fora do
primeiro carregamento de rota — qualquer chamada no MEIO do uso (responder
um ticket, trocar de aba) que caísse numa sessão expirada virava um 403
igual ao de "sem permissão", sem redirecionar ninguém para o login.

Devolver um cabeçalho aqui não muda nada para quem JÁ está autenticado e
esbarra numa permissão que não tem — esse caminho é `PermissionDenied`, não
`NotAuthenticated`, e o rebaixamento de `handle_exception` só se aplica ao
segundo. Ver também `apps.customers.embed_auth.EmbedTokenAuthentication`
(autenticadora de índice 1): ela ganha, de tabela, o mesmo 401 correto
quando o widget chama sem token nenhum — hoje ela também caía em 403 pelo
mesmo motivo, mesmo definindo o próprio cabeçalho.
"""

from rest_framework.authentication import SessionAuthentication


class SessionAuthenticationComCabecalho(SessionAuthentication):
    def authenticate_header(self, request):
        return "Session"
