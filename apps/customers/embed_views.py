"""A porta de entrada do "mini chat" embutido — a única página do sistema
que aceita ser colocada num `<iframe>`, e só quando a origem bate com uma
que a própria empresa cadastrou (docs/14-seguranca.md §10).

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

import time

from csp.decorators import csp_exempt
from django.http import HttpResponse
from django.shortcuts import render
from django.views.decorators.clickjacking import xframe_options_exempt
from django.views.decorators.http import require_GET

from apps.accounts.models import User, UserKind
from apps.customers.models import Company
from apps.customers.services.embed import (
    issue_access_token,
    resolve_trusted_origin,
    verify_signature,
)

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
    erro = _validar_assinatura(
        company, email, request.GET.get("ts", ""), request.GET.get("sig", "")
    )
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
        {"token": token, "user_name": user.full_name, "company_name": company.name},
        status=200,
    )
    return _com_moldura(resp, origem)
