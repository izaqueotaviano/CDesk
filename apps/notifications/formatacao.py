"""Formatação leve do corpo das mensagens, do lado do servidor (e-mail).

A tela grava a formatação como um SUBCONJUNTO pequeno de Markdown dentro do
próprio texto da mensagem — não existe campo novo nem HTML no banco. A regra
completa (e o porquê de cada limite) está em `frontend/src/ui/textoFormatado.ts`;
este módulo é o gêmeo dela para onde a tela não chega: o e-mail. Mudar um é
mudar o outro, e os testes dos dois lados cobrem os mesmos casos de XSS.

    **negrito**                 → <strong>
    _itálico_ / *itálico*       → <em>
    - item / * item             → <ul>
    1. item / 1) item           → <ol start=…>   (1 a 3 dígitos)
    [rótulo](https://…)         → <a>  (só http, https e mailto)
    https://… solto             → <a>

Duas saídas, porque o e-mail tem duas partes:

- `para_html()`: ESCAPA o texto primeiro e só depois aplica o subconjunto — o
  único HTML do resultado é o que este módulo escreve. Por cima, passa pelo
  nh3 com uma allowlist do tamanho exato do que ele escreve: se um dia uma
  regra daqui errar, o higienizador segura.
- `para_texto()`: o mesmo conteúdo sem os marcadores, para a parte de texto
  puro — `**urgente**` vira `urgente`, link vira `rótulo (endereço)`.
"""

from __future__ import annotations

import re
from html import escape

import nh3

# Mesma ordem de prioridade do front: menção, link com rótulo, link solto,
# negrito, itálico. `\w` do Python já é Unicode (letra acentuada conta).
#   1: menção   2,3: rótulo e endereço   4: link solto
#   5: miolo do negrito   6,7: marcador e miolo do itálico
_INLINE = re.compile(
    r"(@\[(?:user|team):\d+\])"
    r"|\[([^\]\n]+)\]\(([^()\s]+)\)"
    r"|(https?://[^\s<>]+)"
    r"|\*\*(?=\S)([^\n]*?\S)\*\*(?!\*)"
    r"|(?<![\w*])([*_])(?![*_\s])([^\n]*?[^\s*_])\6(?![\w*])"
)
_ITEM_MARCADO = re.compile(r"^ {0,3}[-*] +(\S.*)$")
_ITEM_NUMERADO = re.compile(r"^ {0,3}(\d{1,3})[.)] +(\S.*)$")
_ESQUEMAS = re.compile(r"^(?:https?://|mailto:)", re.IGNORECASE)
_CONTROLE = re.compile(r"[\s\x00-\x1f\x7f]")

# Estilo em linha: cliente de e-mail ignora <style>. A cor do link é a tinta do
# texto (carvão), como na tela — o produto tem uma cor de ação só.
_ESTILO_P = "margin:0 0 12px;"
_ESTILO_LISTA = "margin:0 0 12px;padding-left:22px;"
_ESTILO_LINK = "color:#242424;text-decoration:underline;"

_TAGS = {"p", "br", "strong", "em", "a", "ul", "ol", "li"}
_ATRIBUTOS = {
    "a": {"href", "style", "target"},
    "ol": {"start", "style"},
    "ul": {"style"},
    "p": {"style"},
    "li": {"style"},
}


def href_seguro(url: str) -> str | None:
    """O endereço que pode virar link, ou None (mesma regra de `hrefSeguro`)."""
    limpo = (url or "").strip()
    if not limpo or _CONTROLE.search(limpo) or not _ESQUEMAS.match(limpo):
        return None
    if limpo.lower().startswith("mailto:"):
        return limpo if len(limpo) > 7 else None
    return limpo if re.match(r"^https?://[^/?#]+", limpo, re.IGNORECASE) else None


def _apara_fim_de_link(url: str) -> str:
    """Pontuação da frase não é parte do endereço: "veja https://x.com."."""
    fim = len(url)
    while fim:
        c = url[fim - 1]
        if c in ".,;:!?'\"*_":
            fim -= 1
            continue
        if c == ")" and url[:fim].count(")") > url[:fim].count("("):
            fim -= 1
            continue
        break
    return url[:fim]


# --------------------------------------------------------------------------- #
# Análise: texto → nós. As duas saídas (HTML e texto) andam pela mesma árvore,
# então não têm como discordar sobre o que é formatação.


def _inline(linha: str, dentro_de_link: bool = False) -> list[tuple]:
    nos: list[tuple] = []
    cursor = 0
    pos = 0

    def texto(trecho: str) -> None:
        if not trecho:
            return
        if nos and nos[-1][0] == "texto":
            nos[-1] = ("texto", nos[-1][1] + trecho)
        else:
            nos.append(("texto", trecho))

    while True:
        m = _INLINE.search(linha, pos)
        if m is None:
            break
        inicio = m.start()
        mencao, rotulo, endereco, solto, negrito, _, italico = m.groups()
        pos = m.end()

        if mencao is not None:
            # a menção chega ao e-mail já trocada pelo nome (`mentions.resumir`);
            # marcação que sobrar fica como texto
            continue
        if rotulo is not None:
            href = None if dentro_de_link else href_seguro(endereco)
            if href is None:
                continue
            texto(linha[cursor:inicio])
            nos.append(("link", href, _inline(rotulo, True)))
            cursor = m.end()
            continue
        if solto is not None:
            url = _apara_fim_de_link(solto)
            href = None if dentro_de_link else href_seguro(url)
            if href is None:
                pos = inicio + max(len(url), 1)
                continue
            texto(linha[cursor:inicio])
            nos.append(("link", href, [("texto", url)]))
            cursor = pos = inicio + len(url)
            continue
        if negrito is not None:
            texto(linha[cursor:inicio])
            nos.append(("negrito", _inline(negrito, dentro_de_link)))
            cursor = m.end()
            continue
        if italico is not None:
            texto(linha[cursor:inicio])
            nos.append(("italico", _inline(italico, dentro_de_link)))
            cursor = m.end()
    texto(linha[cursor:])
    return nos


def _blocos(corpo: str) -> list[dict]:
    blocos: list[dict] = []
    for linha in (corpo or "").replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        marcado = _ITEM_MARCADO.match(linha)
        numerado = None if marcado else _ITEM_NUMERADO.match(linha)
        ultimo = blocos[-1] if blocos else None
        if marcado or numerado:
            ordenada = numerado is not None
            conteudo = _inline(marcado.group(1) if marcado else numerado.group(2))
            if ultimo and ultimo["tipo"] == "lista" and ultimo["ordenada"] == ordenada:
                ultimo["itens"].append(conteudo)
            else:
                blocos.append({
                    "tipo": "lista",
                    "ordenada": ordenada,
                    "inicio": int(numerado.group(1)) if numerado else 1,
                    "itens": [conteudo],
                })
            continue
        if ultimo and ultimo["tipo"] == "paragrafo":
            ultimo["linhas"].append(_inline(linha))
        else:
            blocos.append({"tipo": "paragrafo", "linhas": [_inline(linha)]})
    return blocos


# --------------------------------------------------------------------------- #
# Saídas


def _html_dos_nos(nos: list[tuple]) -> str:
    partes = []
    for no in nos:
        if no[0] == "texto":
            partes.append(escape(no[1]))
        elif no[0] == "negrito":
            partes.append(f"<strong>{_html_dos_nos(no[1])}</strong>")
        elif no[0] == "italico":
            partes.append(f"<em>{_html_dos_nos(no[1])}</em>")
        elif no[0] == "link":
            partes.append(
                f'<a href="{escape(no[1], quote=True)}" target="_blank" '
                f'style="{_ESTILO_LINK}">{_html_dos_nos(no[2])}</a>'
            )
    return "".join(partes)


def para_html(corpo: str) -> str:
    """O corpo como HTML de e-mail: parágrafos, listas e a formatação leve.

    Linha em branco separa parágrafos (é o que o e-mail já fazia com texto
    puro); quebra simples vira `<br>`.
    """
    saida: list[str] = []
    for bloco in _blocos(corpo):
        if bloco["tipo"] == "lista":
            tag = "ol" if bloco["ordenada"] else "ul"
            numerada_de_outro = bloco["ordenada"] and bloco["inicio"] != 1
            inicio = f' start="{bloco["inicio"]}"' if numerada_de_outro else ""
            itens = "".join(f"<li>{_html_dos_nos(item)}</li>" for item in bloco["itens"])
            saida.append(f'<{tag}{inicio} style="{_ESTILO_LISTA}">{itens}</{tag}>')
            continue
        # parágrafos de e-mail: um <p> por trecho entre linhas em branco
        atual: list[str] = []
        for linha in bloco["linhas"] + [[]]:
            if linha:
                atual.append(_html_dos_nos(linha))
                continue
            if atual:
                saida.append(f'<p style="{_ESTILO_P}">{"<br>".join(atual)}</p>')
                atual = []
    html = "".join(saida)
    # Defesa em profundidade: a allowlist é exatamente o que o código acima
    # escreve. Se uma regra deixar passar algo, o nh3 derruba.
    return nh3.clean(
        html,
        tags=_TAGS,
        attributes=_ATRIBUTOS,
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
    )


def _texto_dos_nos(nos: list[tuple]) -> str:
    partes = []
    for no in nos:
        if no[0] == "texto":
            partes.append(no[1])
        elif no[0] in ("negrito", "italico"):
            partes.append(_texto_dos_nos(no[1]))
        elif no[0] == "link":
            rotulo = _texto_dos_nos(no[2])
            destino = re.sub(r"^mailto:", "", no[1], flags=re.IGNORECASE)
            partes.append(rotulo if rotulo in (no[1], destino) else f"{rotulo} ({destino})")
    return "".join(partes)


def para_texto(corpo: str) -> str:
    """O corpo sem os marcadores, para a parte de texto puro do e-mail e para
    o sino (onde uma linha crua é tudo que cabe)."""
    linhas: list[str] = []
    for bloco in _blocos(corpo):
        if bloco["tipo"] == "lista":
            for i, item in enumerate(bloco["itens"]):
                marca = f"{bloco['inicio'] + i}." if bloco["ordenada"] else "•"
                linhas.append(f"{marca} {_texto_dos_nos(item)}")
        else:
            linhas.extend(_texto_dos_nos(linha) for linha in bloco["linhas"])
    return "\n".join(linhas)


def recortar(corpo: str, limite: int) -> str:
    """Encurta sem partir palavra (nem marcador ao meio, na maioria das vezes)
    e marca o corte com reticências."""
    corpo = (corpo or "").strip()
    if len(corpo) <= limite:
        return corpo
    corte = corpo[:limite]
    espaco = max(corte.rfind(" "), corte.rfind("\n"))
    if espaco > limite * 0.6:
        corte = corte[:espaco]
    return corte.rstrip() + "…"
