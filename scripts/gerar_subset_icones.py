#!/usr/bin/env python
"""
Gera o subset da fonte de ícones Tabler com os ícones que o produto REALMENTE
usa, e o CSS que os declara.

Por que existe
--------------
As telas novas usam os ícones como FONTE (`<i className="ti ti-clock" />`),
em 245 lugares — inclusive vindos de dado (`stores/tabs.ts`,
`portal/shell/nav.ts` guardam a classe como string), então não dá para trocar
tudo por componente React sem reescrever essas estruturas.

Vinha de CDN (`cdn.jsdelivr.net/...@latest`), o que era três problemas: a CSP
de produção não libera aquele domínio (`font-src 'self' data:` em
deploy/nginx/resolv.conf), então em produção o ícone simplesmente não
aparecia; `@latest` puxa versão nova sem revisão; e é uma dependência externa
em tempo de carregamento.

Hospedar a fonte inteira também não serve: o pacote não publica `.woff2` no
peso padrão, só `.woff` de 794 KB — para 99 ícones. O subset resolve os três
de uma vez.

Como rodar (quando um ícone NOVO for usado numa tela)
-----------------------------------------------------
    .venv/bin/python scripts/gerar_subset_icones.py

O teste `src/ui/icones.test.ts` falha se algum `ti ti-*` usado no código
não estiver no CSS gerado — é ele que avisa que este script precisa rodar,
em vez de o ícone sair invisível em produção.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FRONT = RAIZ / "frontend"
PACOTE = FRONT / "node_modules" / "@tabler" / "icons-webfont" / "dist"
SAIDA = FRONT / "src" / "assets" / "icones"

# Onde procurar `ti ti-*`. O CSS gerado não entra, senão ele se realimenta.
FONTES = [FRONT / "src", FRONT / "index.html"]
# Só conta o que é de fato uma CLASSE — sempre escrita como o par `ti ti-x`,
# seja em JSX ou em dado (`stores/tabs.ts`, `shell/BarraDeAbas.tsx`). Casar
# `ti-x` solto pegaria a menção num comentário e inventaria ícone.
PADRAO_USO = re.compile(r"\bti ti-([a-z0-9-]+)\b")
PADRAO_REGRA = re.compile(r"^\.ti-([a-z0-9-]+):before\s*\{\s*content:\s*\"\\([0-9a-f]+)\";",
                          re.MULTILINE)


def icones_usados() -> set[str]:
    usados: set[str] = set()
    for raiz in FONTES:
        arquivos = [raiz] if raiz.is_file() else [
            p for p in raiz.rglob("*")
            if p.suffix in {".ts", ".tsx", ".html", ".scss", ".css"}
            and SAIDA not in p.parents
        ]
        for arquivo in arquivos:
            texto = arquivo.read_text(encoding="utf-8")
            for m in PADRAO_USO.finditer(texto):
                usados.add(m.group(1))
    return usados


def main() -> int:
    if not PACOTE.exists():
        print(f"não achei {PACOTE} — rode `npm install` no frontend primeiro", file=sys.stderr)
        return 1

    css_completo = (PACOTE / "tabler-icons.css").read_text(encoding="utf-8")
    codigo_por_nome = {m.group(1): m.group(2) for m in PADRAO_REGRA.finditer(css_completo)}

    usados = icones_usados()
    # `ti` sozinho é a classe base, não um ícone
    usados.discard("")
    conhecidos = sorted(n for n in usados if n in codigo_por_nome)
    desconhecidos = sorted(n for n in usados if n not in codigo_por_nome)

    if desconhecidos:
        print("AVISO: classes `ti-*` que não existem na fonte (erro de digitação?):",
              file=sys.stderr)
        for n in desconhecidos:
            print(f"  ti-{n}", file=sys.stderr)

    if not conhecidos:
        print("nenhum ícone encontrado — algo está errado", file=sys.stderr)
        return 1

    SAIDA.mkdir(parents=True, exist_ok=True)
    pontos = ",".join(f"U+{codigo_por_nome[n]}" for n in conhecidos)

    woff2 = SAIDA / "tabler-subset.woff2"
    subprocess.run(  # noqa: S603 — comando e argumentos montados aqui, sem entrada externa
        [sys.executable, "-m", "fontTools.subset", str(PACOTE / "fonts" / "tabler-icons.ttf"),
         f"--unicodes={pontos}", "--flavor=woff2", "--layout-features=",
         "--no-hinting", "--desubroutinize", f"--output-file={woff2}"],
        check=True,
    )

    regras = "\n".join(f'.ti-{n}::before {{ content: "\\{codigo_por_nome[n]}"; }}'
                       for n in conhecidos)
    css = f"""/* GERADO por scripts/gerar_subset_icones.py — não edite à mão.
 *
 * Subset da fonte Tabler Icons ({len(conhecidos)} ícones, os que o produto usa)
 * com o CSS de cada um. Antes isto vinha de CDN, que a CSP de produção não
 * libera — ver o cabeçalho do script.
 *
 * Usou um ícone novo? Rode o script; `src/ui/icones.test.ts` avisa se esquecer.
 */
@font-face {{
  font-family: "tabler-icons";
  font-style: normal;
  font-weight: 400;
  font-display: block;  /* ícone é sinal, não texto: melhor esperar que piscar em fallback */
  src: url("./tabler-subset.woff2") format("woff2");
}}

.ti {{
  font-family: "tabler-icons" !important;
  speak: none;
  font-style: normal;
  font-weight: normal;
  font-variant: normal;
  text-transform: none;
  line-height: 1;
  display: inline-block;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}}

{regras}
"""
    (SAIDA / "tabler-subset.css").write_text(css, encoding="utf-8")

    kb = woff2.stat().st_size / 1024
    print(f"{len(conhecidos)} ícones · {kb:.1f} KB (woff2) · {SAIDA.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
