import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * A fonte de ícones não é mais a família inteira vinda de CDN: é um SUBSET
 * gerado por `scripts/gerar_subset_icones.py` com os ícones que o produto
 * usa (98 hoje, 11 KB contra os 794 KB da fonte cheia — e o CDN ainda era
 * bloqueado pela CSP de produção, então em produção o ícone nem aparecia).
 *
 * O preço do subset é que usar um ícone NOVO numa tela não basta: o script
 * precisa rodar de novo. Sem este teste, o sintoma seria um espaço em branco
 * no lugar do ícone, provavelmente só notado em produção. Com ele, o CI
 * aponta o nome que falta e o que fazer.
 */

const RAIZ = join(__dirname, '..')
const CSS_SUBSET = join(RAIZ, 'assets/icones/tabler-subset.css')
const EXTENSOES = new Set(['.ts', '.tsx', '.scss', '.css'])

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) {
      return nome === 'icones' ? [] : arquivos(caminho)
    }
    return EXTENSOES.has(extname(nome)) ? [caminho] : []
  })
}

describe('subset da fonte de ícones', () => {
  const css = readFileSync(CSS_SUBSET, 'utf8')
  const declarados = new Set([...css.matchAll(/^\.ti-([a-z0-9-]+)::before/gm)].map((m) => m[1]))

  it('declara todo `ti ti-*` que o código usa', () => {
    // O MESMO padrão do script (o par `ti ti-x`): casar `ti-x` solto pegaria
    // menção em comentário e cobraria um ícone que ninguém renderiza.
    const usados = new Map<string, string>()
    for (const arquivo of arquivos(RAIZ)) {
      const texto = readFileSync(arquivo, 'utf8')
      for (const m of texto.matchAll(/\bti ti-([a-z0-9-]+)\b/g)) {
        if (!usados.has(m[1])) usados.set(m[1], relative(RAIZ, arquivo))
      }
    }
    expect(usados.size).toBeGreaterThan(50)

    const faltando = [...usados].filter(([nome]) => !declarados.has(nome))
    expect(
      faltando.map(([nome, onde]) => `ti-${nome} (${onde})`),
      'ícone fora do subset — rode `.venv/bin/python scripts/gerar_subset_icones.py`',
    ).toEqual([])
  })

  it('não carrega mais a família inteira de CDN', () => {
    const html = readFileSync(join(RAIZ, '..', 'index.html'), 'utf8')
    expect(html).not.toMatch(/cdn\.|jsdelivr|unpkg/)
    expect(css).toContain('@font-face')
    expect(css).toContain('tabler-subset.woff2')
  })
})
