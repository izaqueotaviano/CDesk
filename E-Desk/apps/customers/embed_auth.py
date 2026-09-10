"""Autenticação do mini chat embutido — DRF, por token, sem cookie.

Só usada pelas chamadas que a MINI-JANELA faz (`ws/chat/` e `/api/v1/chat/*`
carregados dentro do iframe hospedado no Vtex/Tray, com o token do passo
`apps.customers.embed_views`). O resto do sistema continua 100% em cima de
`SessionAuthentication` — esta classe entra DEPOIS dela na lista
(`REST_FRAMEWORK.DEFAULT_AUTHENTICATION_CLASSES`), e só é tentada quando a
requisição não trouxe sessão nenhuma, então nada muda pro app autenticado
de sempre.
"""

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.models import User, UserKind
from apps.customers.services.embed import verify_access_token

PREFIXO = "Bearer "


def _views_permitidas():
    """As ÚNICAS views que o mini-widget de fato chama — resolvidas sob
    demanda (não no import do módulo) para não criar um ciclo de import
    entre `apps.customers` e `apps.chat`.

    Sem esta lista, o token do widget — pensado como "prova que esta aba É
    o mini chat" — autenticaria em QUALQUER endpoint com o `IsAuthenticated`
    padrão do DRF (tickets, anexos, notificações, kanban…), porque
    `DEFAULT_AUTHENTICATION_CLASSES` é global: o widget ganharia, de fato,
    acesso equivalente à sessão inteira do portal, não só ao chat. O
    isolamento por empresa/kind continua valendo mesmo sem este allowlist —
    isto é profundidade extra, o raio de um token vazado não devia passar
    do que o widget realmente usa (docs/14-seguranca.md §10)."""
    from apps.chat.views import ChatConfigView, ChatViewSet

    return (ChatViewSet, ChatConfigView)


class EmbedTokenAuthentication(BaseAuthentication):
    """`Authorization: Bearer <token>` — token de curta duração emitido só
    depois que a identidade declarada pelo Vtex/Tray foi verificada por HMAC
    (ver `apps.customers.embed_views.embed_chat`).

    Só autentica nas views que o próprio widget chama (`_views_permitidas`)
    — em qualquer outra, `authenticate()` devolve `None` como se o header
    não existisse, e a requisição segue anônima (vira 403 de
    `IsAuthenticated`, não um 401/403 "de autenticação", porque para
    QUALQUER outra view este token nunca prova nada).

    Sem CSRF: `SessionAuthentication` é quem exige CSRF, e só quando ELA é a
    autenticadora que teve sucesso — como esta requisição não carrega cookie
    de sessão nenhum (de propósito: é o que evita o bloqueio de cookie de
    terceiro do Safari), `SessionAuthentication.authenticate()` devolve
    `None` sozinha e o CSRF dela nunca entra em jogo.
    """

    def authenticate(self, request):
        cabecalho = request.META.get("HTTP_AUTHORIZATION", "")
        if not cabecalho.startswith(PREFIXO):
            return None  # deixa a próxima autenticadora tentar

        # `parser_context["view"]` já está montado neste ponto — o DRF
        # constrói o `Request` (com o parser_context) ANTES de chamar
        # `perform_authentication` em `APIView.initial()`.
        view = request.parser_context.get("view") if hasattr(request, "parser_context") else None
        if not isinstance(view, _views_permitidas()):
            return None  # fora do escopo do widget: nem tenta

        token = cabecalho[len(PREFIXO):].strip()
        user_id = verify_access_token(token)
        if user_id is None:
            raise AuthenticationFailed("Sessão do widget expirada. Recarregue a página.")

        try:
            # só CLIENTE ativo: mesmo que o token de alguém sobreviva a uma
            # desativação de conta, a consulta ao banco fecha a porta na hora
            user = User.objects.select_related("company").get(
                pk=user_id, kind=UserKind.CLIENT, is_active=True
            )
        except User.DoesNotExist as exc:
            raise AuthenticationFailed("Conta indisponível.") from exc

        return (user, token)

    def authenticate_header(self, request):
        # O DRF só consulta a autenticadora de ÍNDICE 0 da lista pra decidir
        # entre 401 e 403 em qualquer falha de autenticação — a de sessão,
        # que não define header nenhum. Então tanto sem token quanto com
        # token ruim, a resposta desta API continua sendo 403 (não 401),
        # exatamente como já era pro app inteiro antes deste arquivo
        # existir. Implementado mesmo assim porque é o certo pelo contrato
        # HTTP — e um dia a ordem pode mudar.
        return "Bearer"
