"""A porta de entrada do "mini chat" embutido — a única página do sistema
que aceita ser colocada num `<iframe>`, e só quando a origem bate com uma
que a própria empresa cadastrou (docs/14-seguranca.md §10).

Dois modos de entrar, e a diferença entre eles é só QUEM diz quem é a pessoa:

- **identificado** (`?company=&email=&ts=&sig=`): a página que hospeda o
  widget já tem alguém logado (o console da Vtex/Tray) e assina essa
  identidade com a chave da empresa. É o modo certo dentro de um console —
  a identidade é real, não digitada;
- **público** (`?company=` e mais nada, e só com `public_enabled`): não há
  ninguém logado do outro lado (uma loja, uma landing page). O código é UM
  por empresa, colado uma vez; quem se identifica é o próprio visitante,
  dentro da janelinha, e vira um usuário visitante da empresa
  (`apps.customers.services.embed_visitor`).

Nos dois, o que decide ONDE o widget pode aparecer é a mesma lista de
origens — modo público não é "aberto pra internet", é "sem assinatura por
pessoa".

Fluxo, em ordem:

1. resolve a empresa e confere se a ORIGEM da requisição está na lista dela
   — só DAQUI EM DIANTE a resposta pode relaxar `frame-ancestors`. Origem
   não reconhecida nunca vê nada além de "indisponível", moldura fechada;
2. confere a ASSINATURA da identidade declarada (HMAC com a chave desta
   empresa) e a janela de tempo;
3. resolve o e-mail declarado a um usuário CLIENTE ativo desta empresa;
4. emite um token de acesso curto e renderiza a mini-janela.

Cada passo que falha depois do 1 ainda aparece DENTRO do iframe (a origem já
é confiável, então um erro legível vale mais que uma caixa em branco) — só
não autentica nada.
"""

from __future__ import annotations

import json
import time

from csp.decorators import csp_exempt
from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from apps.accounts.models import User, UserKind
from apps.accounts.sessions import client_ip
from apps.customers.models import Company
from apps.customers.services.embed import (
    issue_access_token,
    issue_visitor_session,
    resolve_trusted_origin,
    verify_signature,
    verify_visitor_session,
)
from apps.customers.services.embed_visitor import resolver_visitante

TEMPLATE = "customers/embed_chat.html"


def _sem_moldura(response: HttpResponse) -> HttpResponse:
    """Origem não reconhecida: nada relaxa. `DENY` explícito por cima do
    exemption do CSP global — não dá pra confiar em nenhum default aqui."""
    response["Content-Security-Policy"] = "frame-ancestors 'none'"
    response["X-Frame-Options"] = "DENY"
    response["Cache-Control"] = "no-store"
    return response


def _com_moldura(response: HttpResponse, origem: str) -> HttpResponse:
    """Origem confiável desta empresa: SÓ ela pode embutir esta resposta —
    nunca um `frame-ancestors *`. Sem `X-Frame-Options` aqui: o valor
    `ALLOW-FROM` que permitiria uma origem específica foi removido dos
    navegadores há anos; quem decide framing nesta rota é só a CSP."""
    response["Content-Security-Policy"] = f"frame-ancestors {origem}"
    response["Cache-Control"] = "no-store"
    return response


def _validar_assinatura(company: Company, email: str, ts_bruto: str, sig: str) -> str | None:
    """`None` = assinatura válida. Qualquer outra coisa é a mensagem de
    erro, pensada pra quem está DO OUTRO LADO da integração (o dev do
    cliente) entender o que corrigir — não pra quem só está usando o chat."""
    if not email or not sig:
        return "Faltam parâmetros na URL do widget."
    try:
        ts = int(ts_bruto)
    except (TypeError, ValueError):
        return "Parâmetro de tempo inválido."
    if abs(time.time() - ts) > 300:
        return (
            "Este link expirou. Ele precisa ser gerado a cada carregamento — "
            "não reutilize um salvo."
        )
    if not verify_signature(
        secret=company.chat_embed.secret,
        company_slug=company.slug,
        email=email,
        ts=ts,
        signature=sig,
    ):
        return "Não foi possível confirmar sua identidade."
    return None


@require_GET
# controle manual do CSP abaixo — a política certa depende da origem, decidida em runtime
@csp_exempt()
# idem para X-Frame-Options: quem decide é a CSP acima, não o default global
@xframe_options_exempt
def embed_chat(request):
    company = (
        Company.objects.filter(slug=request.GET.get("company", ""), is_active=True)
        .select_related("chat_embed")
        .first()
    )
    habilitado = (
        company is not None
        and hasattr(company, "chat_embed")
        and company.chat_embed.enabled
    )
    origem = resolve_trusted_origin(request, company=company) if habilitado else None

    if not habilitado or origem is None:
        # a mesma mensagem tanto pra empresa inexistente quanto pra embed
        # desligado quanto pra origem não cadastrada — não é o lugar de
        # confirmar qual dessas é o caso
        resp = render(
            request, TEMPLATE, {"erro": "Este chat não está disponível aqui."}, status=404
        )
        return _sem_moldura(resp)

    email = (request.GET.get("email") or "").strip()
    ts_bruto = request.GET.get("ts", "")
    sig = request.GET.get("sig", "")

    # Nenhum parâmetro de identidade na URL = está pedindo o modo público.
    # (Um deles sozinho não conta: aí é integração assinada mal montada, e a
    # mensagem certa é a do `_validar_assinatura`, que diz o que falta.)
    if not (email or ts_bruto or sig):
        if not company.chat_embed.public_enabled:
            resp = render(
                request, TEMPLATE,
                {"erro": "Este chat só abre por link assinado. Fale com quem cuida da integração."},
                status=403,
            )
            return _com_moldura(resp, origem)
        # A moldura já foi aprovada — a sessão leva essa aprovação adiante,
        # para o POST de identificação (ver `embed_identificar`).
        resp = render(
            request, TEMPLATE,
            {
                "sessao": issue_visitor_session(company_id=company.id, origin=origem),
                "company_name": company.name,
                "do_loader": request.GET.get("loader") == "1",
            },
            status=200,
        )
        return _com_moldura(resp, origem)

    erro = _validar_assinatura(company, email, ts_bruto, sig)
    if erro:
        resp = render(request, TEMPLATE, {"erro": erro}, status=403)
        return _com_moldura(resp, origem)

    user = User.objects.filter(
        email__iexact=email, company=company, kind=UserKind.CLIENT, is_active=True
    ).first()
    if user is None:
        resp = render(
            request, TEMPLATE,
            {"erro": "Este e-mail não corresponde a um usuário do portal desta empresa."},
            status=403,
        )
        return _com_moldura(resp, origem)

    token = issue_access_token(user.id)
    resp = render(
        request, TEMPLATE,
        {
            "token": token,
            "user_name": user.full_name,
            "company_name": company.name,
            "do_loader": request.GET.get("loader") == "1",
        },
        status=200,
    )
    return _com_moldura(resp, origem)


# ---------------------------------------------------------------------------
# Modo público: identificação do visitante
# ---------------------------------------------------------------------------

# Quantas identificações um mesmo IP pode fazer por empresa por hora. O modo
# público é, por definição, exposto a qualquer visitante do site do cliente —
# e cada identificação nova pode CRIAR um usuário visitante. Sem teto, um
# script na página autorizada encheria a base da empresa. 10 cobre com folga
# gente trocando de e-mail porque errou de primeira.
LIMITE_IDENTIFICACOES = 10
JANELA_IDENTIFICACOES_SEGUNDOS = 60 * 60


def _excedeu_limite(company_id: int, ip: str) -> bool:
    """Contador simples no cache. Best-effort de propósito: se o cache cair,
    a porta continua sendo a lista de origens + a sessão assinada — isto aqui
    é o teto de abuso, não o controle de acesso."""
    chave = f"embed-identificacoes:{company_id}:{ip or 'sem-ip'}"
    # `add` só grava se a chave não existir: é ele que fixa a JANELA a partir
    # da primeira tentativa (um `set` a cada request renovaria o prazo e o
    # limite nunca fecharia).
    cache.add(chave, 0, JANELA_IDENTIFICACOES_SEGUNDOS)
    try:
        usadas = cache.incr(chave)
    except ValueError:  # expirou entre o add e o incr
        return False
    return usadas > LIMITE_IDENTIFICACOES


@csrf_exempt  # sem cookie por design (ver `apps.customers.embed_auth`): quem
# prova que esta chamada nasceu de uma janelinha legítima é a `sessao`
# assinada, emitida só depois de a origem ter sido aprovada. Um token CSRF
# aqui dependeria de cookie de terceiro — justamente o que o Safari bloqueia
# e o que este fluxo inteiro evita.
@require_POST
def embed_identificar(request):
    """PASSO 2 do modo público: o visitante diz quem é e ganha o token de
    acesso do widget.

    Responde SEMPRE em JSON — quem chama é o `fetch` de dentro da janelinha,
    e um HTML de erro do Django ali viraria "não foi possível" mudo.
    """
    try:
        dados = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"detail": "Requisição inválida."}, status=400)

    sessao = verify_visitor_session(str(dados.get("sessao") or ""))
    if sessao is None:
        return JsonResponse(
            {"detail": "Esta janela expirou. Recarregue a página para continuar."},
            status=403,
        )
    company_id, _origem = sessao

    company = (
        Company.objects.filter(pk=company_id, is_active=True)
        .select_related("chat_embed")
        .first()
    )
    # Reconferido AGORA, não só quando a janelinha abriu: entre uma coisa e
    # outra alguém pode ter desligado o embed (ou o modo público) no painel,
    # e uma aba já aberta não pode continuar valendo por isso.
    if (
        company is None
        or not hasattr(company, "chat_embed")
        or not company.chat_embed.enabled
        or not company.chat_embed.public_enabled
    ):
        return JsonResponse({"detail": "Este chat não está disponível."}, status=403)

    if _excedeu_limite(company_id, client_ip(request)):
        return JsonResponse(
            {"detail": "Muitas tentativas. Tente de novo mais tarde."}, status=429
        )

    visitante, erro = resolver_visitante(
        company, nome=str(dados.get("nome") or ""), email=str(dados.get("email") or "")
    )
    if erro is not None:
        return JsonResponse({"detail": erro}, status=400)

    return JsonResponse(
        {
            "token": issue_access_token(visitante.id),
            "user_name": visitante.full_name,
            # Visitante não entra no portal (nasce sem senha utilizável), então
            # a janelinha esconde dele o "abrir no portal" — link que ele
            # clicaria para cair numa tela de login onde não tem conta.
            "tem_portal": visitante.has_usable_password(),
        }
    )


# ---------------------------------------------------------------------------
# O código de instalação: um por empresa
# ---------------------------------------------------------------------------

# O bastante para o navegador não pedir o arquivo a cada página, e curto o
# bastante para "desliguei o chat no painel" sumir do site do cliente em um
# minuto — o loader some quando o embed é desligado, e isso precisa valer
# rápido.
CACHE_LOADER_SEGUNDOS = 60

_LOADER_DESLIGADO = (
    "/* Resolv: o chat desta empresa está desligado. */\n"
    "console.warn('[Resolv] chat indisponível para esta empresa.');\n"
)

# Vanilla, sem dependência e sem tocar em nada fora do próprio container: este
# arquivo roda DENTRO da página do cliente, então cada seletor, cada estilo e
# cada listener aqui é convidado na casa dos outros. Tudo com estilo inline e
# prefixo `resolv-` por isso.
_LOADER = """(function () {
  'use strict';
  if (window.__resolvChat) return;          // o script colado duas vezes não monta dois balões
  window.__resolvChat = true;

  var URL_CHAT = %(url_chat)s;
  var TITULO = %(titulo)s;
  var LADO = %(lado)s;                      // 'right' | 'left'
  var Z = 2147483000;                       // abaixo do teto do int32: sobra espaço pro site

  var aberto = false;
  var quadro = null;

  var painel = document.createElement('div');
  painel.style.cssText = [
    'position:fixed', 'bottom:88px', LADO + ':20px', 'width:380px',
    'height:min(560px, calc(100vh - 120px))',
    'max-width:calc(100vw - 40px)', 'border-radius:14px', 'overflow:hidden', 'background:#fff',
    'box-shadow:0 12px 40px rgba(0,0,0,.18)', 'z-index:' + Z, 'display:none'
  ].join(';');

  var botao = document.createElement('button');
  botao.type = 'button';
  botao.setAttribute('aria-label', TITULO);
  botao.setAttribute('aria-expanded', 'false');
  botao.style.cssText = [
    'position:fixed', 'bottom:20px', LADO + ':20px', 'width:56px', 'height:56px', 'border:0',
    'border-radius:50%%', 'background:#1b1917', 'color:#fff', 'cursor:pointer', 'font-size:24px',
    'line-height:1', 'box-shadow:0 6px 20px rgba(0,0,0,.22)', 'z-index:' + (Z + 1)
  ].join(';');
  // SVG e não emoji: emoji depende de fonte do sistema e sai de tamanho
  // (e de cor) diferente em cada plataforma.
  botao.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none"'
    + ' stroke="currentColor" stroke-width="2" stroke-linecap="round"'
    + ' stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-4.2-.9L3 21l1.9-4.3'
    + 'A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/>'
    + '</svg>';
  botao.style.display = 'grid';
  botao.style.placeItems = 'center';

  function abrir() {
    if (!quadro) {
      // Só cria o iframe no primeiro clique: quem passa pelo site e não fala
      // com ninguém não paga por uma conexão de chat.
      quadro = document.createElement('iframe');
      quadro.src = URL_CHAT;
      quadro.title = TITULO;
      quadro.style.cssText = 'width:100%%;height:100%%;border:0;display:block';
      painel.appendChild(quadro);
    }
    painel.style.display = 'block';
    botao.setAttribute('aria-expanded', 'true');
    aberto = true;
  }

  function fechar() {
    painel.style.display = 'none';
    botao.setAttribute('aria-expanded', 'false');
    aberto = false;
    botao.focus();
  }

  botao.addEventListener('click', function () { aberto ? fechar() : abrir(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aberto) fechar();
  });

  // Esc digitado DENTRO da janelinha (e o "×" dela) não chega aqui: evento de
  // iframe não sobe pro documento de fora. A janelinha avisa por postMessage —
  // e a origem é conferida, senão qualquer outro iframe da página poderia
  // mandar a mesma mensagem.
  var ORIGEM_CHAT = URL_CHAT.split('/').slice(0, 3).join('/');
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGEM_CHAT) return;
    if (e.data && e.data.resolv === 'fechar' && aberto) fechar();
  });

  function montar() {
    document.body.appendChild(painel);
    document.body.appendChild(botao);
  }
  // `defer`/`async` pode chegar antes do body existir.
  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar);
})();
"""


@require_GET
def embed_widget_js(request):
    """O código de instalação — UM por empresa (`?company=<slug>`).

    É este arquivo que faz "um código por empresa" ser verdade: o cliente cola
    uma linha no site dele e ganha o balão + a janelinha. Nada aqui é segredo
    (o slug já aparece na URL do iframe), e nada aqui autoriza coisa alguma:
    quem decide se a janela abre continua sendo `embed_chat` — origem
    autorizada, embed ligado, modo público ligado.
    """
    company = (
        Company.objects.filter(slug=request.GET.get("company", ""), is_active=True)
        .select_related("chat_embed")
        .first()
    )
    ligado = (
        company is not None
        and hasattr(company, "chat_embed")
        and company.chat_embed.enabled
        and company.chat_embed.public_enabled
    )
    if not ligado:
        corpo = _LOADER_DESLIGADO
    else:
        # `loader=1`: só quem foi aberto POR AQUI ganha o "×" no cabeçalho —
        # num iframe montado à mão pelo cliente, esse botão não teria com quem
        # falar e seria um botão morto.
        url_chat = request.build_absolute_uri(f"/embed/chat/?company={company.slug}&loader=1")
        lado = "left" if request.GET.get("lado") == "esquerda" else "right"
        corpo = _LOADER % {
            "url_chat": json.dumps(url_chat),
            "titulo": json.dumps(f"Falar com {company.name}"),
            "lado": json.dumps(lado),
        }
    resp = HttpResponse(corpo, content_type="application/javascript; charset=utf-8")
    resp["Cache-Control"] = f"public, max-age={CACHE_LOADER_SEGUNDOS}"
    return resp
