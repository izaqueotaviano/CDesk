#!/usr/bin/env python
"""
Extrai o sprite de ícones DESENHADOS da Convertize de dentro do
`convertize.js` do kit, e gera o subset que o produto usa.

Por que não vem do CDN
----------------------
O kit tem DUAS famílias de ícone, e só uma é dele:

- A "biblioteca" de ~5 mil, em cdn.jsdelivr.net/gh/izaqueotaviano/icons, é
  Tabler repackado — dá para conferir pelo próprio mapa `CDN_NAMES` do kit,
  cujos valores são nomes literais do Tabler (`adjustments-horizontal`,
  `arrow-back-up`, `player-stop`, `building-store`, `credit-card-2`). 82 dos
  85 nomes que ele mapeia existem verbatim no @tabler/icons-webfont que o
  projeto já tem; os outros 3 são apelidos (add→plus, cart→shopping-cart,
  credit-card-2→credit-card). Ou seja: o subset de Tabler que já existe em
  `assets/icones` JÁ É essa biblioteca. Não há o que trocar ali.

- O sprite da sidebar (85 símbolos) é o conjunto AUTORAL da marca, e é o que
  de fato muda a cara do produto: duas camadas, com um detalhe que fica
  laranja no item ativo. Ele não está em CDN nenhum — vem embutido no
  `convertize.js`, que esta skill entrega. É dele que este script tira o
  subset.

Como rodar
----------
    .venv/bin/python scripts/gerar_sprite_marca.py

`src/ui/marca/icones.test.ts` falha se uma tela pedir um símbolo que não
está no subset — é ele que avisa que este script precisa rodar de novo.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FRONT = RAIZ / "frontend"
SAIDA = FRONT / "src" / "ui" / "marca"
KIT = Path(
    "/root/.claude/skills/synced"  # não usado; o caminho real vem do argumento
)

# Duas formas de pedir um símbolo, as duas com o nome LITERAL. Nada de
# `nome={cond ? 'a' : 'b'}` no código: além de o gerador não enxergar, a
# tentativa de ensiná-lo a ler ternário fazia ele capturar o operando da
# comparação e inventar um ícone chamado "escuro".
PADRAO_USO = re.compile(
    r"""\bIconeMarca\s+nome=["']([a-z0-9-]+)["']"""   # <IconeMarca nome="x" />
    r"""|\bmarca:\s*['"]([a-z0-9-]+)['"]"""            # marca: 'x' (a lista NAV)
)


def simbolos_do_kit(js: str) -> dict[str, str]:
    """nome → corpo do <symbol>, lido do SPRITE embutido no convertize.js."""
    bruto = json.loads(re.search(r'var SPRITE = ("(?:[^"\\]|\\.)*");', js, re.S).group(1))
    return {
        m.group(1): m.group(0)
        for m in re.finditer(r'<symbol id="i-([a-z0-9-]+)".*?</symbol>', bruto, re.S)
    }


def nomes_usados() -> set[str]:
    usados: set[str] = set()
    for arquivo in (FRONT / "src").rglob("*"):
        if arquivo.suffix not in {".ts", ".tsx"} or SAIDA in arquivo.parents:
            continue
        for m in PADRAO_USO.finditer(arquivo.read_text(encoding="utf-8")):
            usados.update(g for g in m.groups() if g)
    return usados


def main() -> int:
    if len(sys.argv) < 2:
        print("uso: gerar_sprite_marca.py <caminho/para/convertize.js>", file=sys.stderr)
        return 1
    js = Path(sys.argv[1]).read_text(encoding="utf-8")
    todos = simbolos_do_kit(js)
    usados = nomes_usados()

    desconhecidos = sorted(n for n in usados if n not in todos)
    if desconhecidos:
        print("AVISO: o código pede símbolos que o sprite do kit não tem:", file=sys.stderr)
        for n in desconhecidos:
            print(f"  {n}", file=sys.stderr)

    manter = sorted(n for n in usados if n in todos)
    if not manter:
        print("nenhum símbolo em uso — nada a gerar", file=sys.stderr)
        return 1

    SAIDA.mkdir(parents=True, exist_ok=True)
    corpo = "\n  ".join(todos[n] for n in manter)
    bytes_totais = sum(len(todos[n]) for n in manter)

    (SAIDA / "sprite.ts").write_text(
        f'''// GERADO por scripts/gerar_sprite_marca.py — não edite à mão.
//
// Subset do sprite AUTORAL da Convertize ({len(manter)} de {len(todos)} símbolos,
// {bytes_totais / 1024:.1f} KB de SVG). Cada símbolo tem duas camadas: o corpo, que
// segue a cor do texto, e um detalhe `.a`, que fica a 38% e vira laranja no
// item ativo — é essa segunda camada que distingue o desenho da marca de um
// ícone de biblioteca qualquer.
//
// Pediu um símbolo novo numa tela? Rode o script; `icones.test.ts` avisa se
// esquecer.
export const NOMES_DO_SPRITE = {json.dumps(manter, ensure_ascii=False)} as const

export type NomeDeIcone = (typeof NOMES_DO_SPRITE)[number]

export const SPRITE = `{corpo}`
''',
        encoding="utf-8",
    )
    print(f"{len(manter)} símbolos · {bytes_totais / 1024:.1f} KB · {SAIDA.relative_to(RAIZ)}")
    print("  " + " ".join(manter))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
