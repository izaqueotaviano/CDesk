"""Assinatura do agente: o bloco que vai no rodapé do que o cliente lê.

Três formas, uma por vez (`User.signature_kind`):

- `texto` — texto puro (`User.signature`, o campo que já existia);
- `html` — HTML enxuto, higienizado no salvamento (ver `limpar_html`);
- `imagem` — um arquivo enviado do computador (`User.signature_image_url`),
  recodificado como PNG aqui, como o avatar (`avatars.py`).

**A assinatura não é colada no corpo da mensagem**, e essa é a decisão que
sustenta o resto: `TicketMessage.body` é texto puro (o portal e o console o
renderizam como texto), então HTML colado ali apareceria cru para o cliente,
e uma imagem não teria como aparecer. O corpo guarda o que a pessoa escreveu;
a assinatura é renderizada ao lado dele, a partir do perfil de quem
respondeu, nas telas e no e-mail. Consequências, as duas de propósito:

1. corrigir a assinatura corrige em todas as mensagens antigas (não há cópia
   velha para caçar);
2. a assinatura nunca conta como "texto da mensagem" — responder só com a
   assinatura continua sendo uma mensagem vazia.

O que decide se ela aparece numa mensagem é `TicketMessage.with_signature`,
gravado no envio: a tela oferece "incluir minha assinatura" e a resposta
guarda a escolha daquele momento. Mensagens anteriores a este recurso ficam
com `False` — várias já têm a assinatura de texto colada no corpo pelo
compositor antigo, e renderizá-la de novo mostraria duas.

Segurança: HTML de assinatura é escrito por gente do suporte, mas é lido pelo
CLIENTE no portal e num cliente de e-mail. Por isso passa pelo `nh3` com uma
allowlist estreita de tags, de atributos e — no `style` — de propriedades
CSS: só o que pinta um rodapé. É a mesma postura do corpo de artigo
(`apps/knowledge/serializers.py`) e da anotação (`apps/notes`).
"""

from __future__ import annotations

import re
import secrets
from pathlib import Path

import nh3
from django.conf import settings
from PIL import Image, UnidentifiedImageError

# ---- formas -----------------------------------------------------------------

NENHUMA = ""
TEXTO = "texto"
HTML = "html"
IMAGEM = "imagem"

FORMAS = [
    (NENHUMA, "Sem assinatura"),
    (TEXTO, "Texto"),
    (HTML, "HTML"),
    (IMAGEM, "Imagem"),
]

# ---- HTML -------------------------------------------------------------------

MAX_HTML = 8000

#: O que uma assinatura precisa e nada mais. Sem `script`, `iframe`, `form`,
#: `object` — e sem a TAG `style` (o ATRIBUTO é permitido, filtrado abaixo):
#: uma folha de estilo de assinatura alcançaria a página inteira do portal.
TAGS_PERMITIDAS = {
    "a", "b", "br", "div", "em", "hr", "i", "img", "p", "small", "span",
    "strong", "sub", "sup", "u", "table", "thead", "tbody", "tr", "td", "th",
}

ATRIBUTOS_PERMITIDOS = {
    "a": {"href", "title", "style"},
    "img": {"src", "alt", "width", "height", "style"},
    "td": {"align", "valign", "width", "style"},
    "th": {"align", "valign", "width", "style"},
    "tr": {"style"},
    "table": {"align", "border", "cellpadding", "cellspacing", "width", "style"},
    "div": {"style"},
    "p": {"style"},
    "span": {"style"},
    "small": {"style"},
    "hr": {"style"},
}

#: `data:` fica de fora: `data:text/html` num href é XSS, e imagem embutida
#: não é necessária (o upload daqui vira uma URL nossa).
ESQUEMAS_PERMITIDOS = {"http", "https", "mailto", "tel"}

#: Allowlist de propriedades CSS (`filter_style_properties` do nh3): o que
#: pinta um rodapé, e nada que posicione, cubra ou busque recurso externo —
#: sem `position`, `z-index`, `content`, `filter`, `background-image`. Uma
#: declaração fora desta lista some; as boas da mesma linha ficam.
CSS_PERMITIDA = {
    "color", "background-color",
    "font-family", "font-size", "font-style", "font-weight",
    "line-height", "letter-spacing", "text-align", "text-decoration",
    "text-transform", "vertical-align", "white-space",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "border", "border-top", "border-right", "border-bottom", "border-left",
    "border-color", "border-style", "border-width", "border-radius",
    "width", "max-width", "height", "max-height", "display",
}


def limpar_html(bruto: str) -> str:
    """O HTML como ele será guardado e mostrado. Nunca levanta exceção.

    A tela mostra a prévia a partir DESTE resultado (não do que foi digitado):
    quem colou uma assinatura do Outlook com `<script>` no meio vê na hora o
    que sobrou, em vez de descobrir pelo cliente que a assinatura sumiu.
    """
    if not bruto or not bruto.strip():
        return ""
    return nh3.clean(
        bruto[:MAX_HTML],
        tags=TAGS_PERMITIDAS,
        attributes=ATRIBUTOS_PERMITIDOS,
        url_schemes=ESQUEMAS_PERMITIDOS,
        filter_style_properties=CSS_PERMITIDA,
        link_rel="noopener noreferrer",
        strip_comments=True,
    ).strip()


def texto_de_html(html: str) -> str:
    """A versão sem marcação, para a parte de texto puro do e-mail."""
    if not html:
        return ""
    com_quebra = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|table)>", "\n", html)
    limpo = nh3.clean(com_quebra, tags=set())
    linhas = [linha.strip() for linha in limpo.splitlines()]
    return "\n".join(linha for linha in linhas if linha).strip()


# ---- imagem ------------------------------------------------------------------

MAX_BYTES = 1024 * 1024
LARGURA_MAX = 600
ALTURA_MAX = 240
PREFIXO = "/api/v1/assinaturas/"
NOME_VALIDO = re.compile(r"^[0-9a-f]{32}\.png$")


class AssinaturaInvalida(Exception):
    pass


def pasta() -> Path:
    caminho = Path(settings.MEDIA_ROOT) / "assinaturas"
    caminho.mkdir(parents=True, exist_ok=True)
    return caminho


def caminho_de(nome: str) -> Path | None:
    """Nome fora do formato (32 hex + `.png`) simplesmente não existe — não há
    como escrever `../` dentro dele."""
    if not NOME_VALIDO.match(nome or ""):
        return None
    arquivo = pasta() / nome
    return arquivo if arquivo.is_file() else None


def guardar_imagem(user, enviado) -> str:
    """Recodifica e grava; devolve a URL para `signature_image_url`.

    Recodificar é o que mata o arquivo-poliglota (o PNG que também é HTML):
    o que sai daqui é byte gerado pelo Pillow, não o que chegou. Mesmo
    raciocínio do avatar — a diferença é a forma: assinatura é faixa larga,
    então cabe dentro de 600×240 em vez de virar quadrado.
    """
    if enviado.size > MAX_BYTES:
        raise AssinaturaInvalida(
            f"A imagem tem {enviado.size // 1024} KB; o limite é "
            f"{MAX_BYTES // 1024} KB. Reduza e envie de novo."
        )
    try:
        imagem = Image.open(enviado)
        imagem.verify()
        enviado.seek(0)
        imagem = Image.open(enviado)
        imagem.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise AssinaturaInvalida(
            "Não consegui ler esse arquivo como imagem. Use PNG, JPEG ou WebP."
        ) from exc

    if imagem.format not in {"PNG", "JPEG", "WEBP"}:
        raise AssinaturaInvalida(
            f"Formato {imagem.format or 'desconhecido'} não aceito. Use PNG, JPEG ou WebP."
        )

    # RGBA preservado: logotipo com fundo transparente é o caso comum aqui.
    imagem = imagem.convert("RGBA")
    imagem.thumbnail((LARGURA_MAX, ALTURA_MAX), Image.LANCZOS)

    nome = f"{secrets.token_hex(16)}.png"
    imagem.save(pasta() / nome, "PNG", optimize=True)
    apagar_imagem(user)  # trocar a imagem não deixa a anterior ocupando disco
    return f"{PREFIXO}{nome}"


def apagar_imagem(user) -> None:
    atual = getattr(user, "signature_image_url", "") or ""
    if not atual.startswith(PREFIXO):
        return
    arquivo = caminho_de(atual[len(PREFIXO):])
    if arquivo:
        arquivo.unlink(missing_ok=True)


def imagem_aceitavel(valor: str) -> bool:
    """Só o que este módulo gravou. Sem isto, `signature_image_url` seria um
    campo de texto livre apontando para qualquer lugar da internet dentro de
    um `<img>` que o cliente carrega — rastreador de graça."""
    if not valor:
        return True
    if not valor.startswith(PREFIXO):
        return False
    return bool(NOME_VALIDO.match(valor[len(PREFIXO):]))


# ---- renderização ------------------------------------------------------------


def _absoluta(url: str, base: str) -> str:
    return f"{base.rstrip('/')}{url}" if base and url.startswith("/") else url


def render_html(user, *, base_url: str = "") -> str:
    """A assinatura pronta para embutir numa página ou num e-mail.

    `base_url` (normalmente `settings.SITE_URL`) transforma o caminho da
    imagem em endereço absoluto — dentro da caixa de entrada de alguém não
    existe "a mesma origem".
    """
    forma = getattr(user, "signature_kind", "") or ""
    if forma == TEXTO:
        texto = (user.signature or "").strip()
        if not texto:
            return ""
        return nh3.clean(texto, tags=set()).replace("\n", "<br>")
    if forma == HTML:
        html = (user.signature_html or "").strip()
        if not html or not base_url:
            return html
        return re.sub(
            r'(<img[^>]+src=")(/[^"]*)"',
            lambda m: f"{m.group(1)}{_absoluta(m.group(2), base_url)}\"",
            html,
        )
    if forma == IMAGEM:
        url = (user.signature_image_url or "").strip()
        if not imagem_aceitavel(url) or not url:
            return ""
        alt = nh3.clean(user.full_name or "Assinatura", tags=set())
        return (
            f'<img src="{_absoluta(url, base_url)}" alt="{alt}" '
            f'style="max-width:{LARGURA_MAX}px; height:auto;">'
        )
    return ""


def render_texto(user) -> str:
    """A versão em texto puro — parte `text/plain` do e-mail.

    Imagem não tem versão em texto: escrever "[imagem]" no rodapé de um
    e-mail é pior do que não escrever nada.
    """
    forma = getattr(user, "signature_kind", "") or ""
    if forma == TEXTO:
        return (user.signature or "").strip()
    if forma == HTML:
        return texto_de_html(user.signature_html or "")
    return ""


def tem_assinatura(user) -> bool:
    return bool(user is not None and render_html(user))
