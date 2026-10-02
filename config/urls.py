"""Rotas do projeto — este backend é **API pura**, com exceções deliberadas.

Não existe catch-all servindo SPA: o frontend é uma aplicação separada, com
o próprio deploy, que consome `/api/v1/`. Fora disso, o que sai daqui em HTML
é: `/admin/`, a documentação (condicional), `/embed/chat/` — o "mini chat"
que uma empresa cliente embute em OUTRA plataforma (Vtex, Tray Commerce…),
que por definição não pode ser a SPA autenticada por cookie de sessão (ver
`apps.customers.embed_views` e docs/14-seguranca.md §10) — e `/accounts/`
(allauth: o handshake do login por Google é redirect de navegador de
verdade, não cabe num fetch da SPA; ela só entra depois que o allauth
devolve pro `LOGIN_REDIRECT_URL`). Fora dessas rotas, é 404 aqui, e não uma
página HTML disfarçada.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import saude
from apps.customers.embed_views import embed_chat, embed_identificar, embed_widget_js

urlpatterns = [
    # caminho do admin configurável (DJANGO_ADMIN_URL em produção)
    path(getattr(settings, "ADMIN_URL", "admin/"), admin.site.urls),
    # health check do orquestrador/nginx: sem autenticação, sem banco, sem redirect
    path("health/", saude, name="health"),
    # login interno por Google OAuth (allauth) — regras de domínio/allowlist
    # em apps/accounts/adapters.py, config em config/settings/base.py.
    path("accounts/", include("allauth.urls")),
    path("embed/chat/", embed_chat, name="embed-chat"),
    # modo público do embed: o código de instalação (um por empresa) e o
    # POST em que o visitante se identifica dentro da janelinha
    path("embed/widget.js", embed_widget_js, name="embed-widget-js"),
    path("embed/chat/identificar/", embed_identificar, name="embed-identificar"),
    path("api/v1/", include("config.api_urls")),
]

# Schema e Swagger: ligados em DEBUG, e ligáveis fora dele por variável de
# ambiente — quem está ESCREVENDO um frontend novo precisa do contrato num
# ambiente de homologação, não só na máquina de quem roda o Django local.
# Em produção de verdade, deixe `API_DOCS_ENABLED` desligado: o schema
# descreve todos os endpoints e parâmetros, inclusive os administrativos.
if settings.DEBUG or getattr(settings, "API_DOCS_ENABLED", False):
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    ]
