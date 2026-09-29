import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOMES_DO_SPRITE, SPRITE } from './sprite'
import { SIMBOLOS_PROPRIOS } from './sprite-proprio'

/**
 * O sprite da marca é um SUBSET, gerado por scripts/gerar_sprite_marca.py a
 * partir do `convertize.js` do kit. Pedir um símbolo que não foi gerado não
 * quebra nada em tempo de build: o `<use>` simplesmente não resolve e o
 * ícone some. Este teste transforma esse silêncio em falha de CI.
 */
const RAIZ = join(__dirname, '..', '..')
const EXTS = new Set(['.ts', '.tsx'])

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return nome === 'marca' ? [] : arquivos(caminho)
    return EXTS.has(extname(nome)) ? [caminho] : []
  })
}

describe('sprite da marca', () => {
  it('declara todo símbolo que o código pede', () => {
    const pedidos = new Map<string, string>()
    for (const arquivo of arquivos(RAIZ)) {
      const texto = readFileSync(arquivo, 'utf8')
      for (const m of texto.matchAll(/marca:\s*'([a-z0-9-]+)'/g)) {
        if (!pedidos.has(m[1])) pedidos.set(m[1], relative(RAIZ, arquivo))
      }
    }
    expect(pedidos.size).toBeGreaterThan(0)

    // Duas origens: o subset gerado do kit e o que foi desenhado aqui.
    const disponiveis = new Set<string>([...NOMES_DO_SPRITE, ...Object.keys(SIMBOLOS_PROPRIOS)])
    const faltando = [...pedidos].filter(([nome]) => !disponiveis.has(nome))
    expect(
      faltando.map(([nome, onde]) => `${nome} (${onde})`),
      'símbolo fora do sprite — rode `.venv/bin/python scripts/gerar_sprite_marca.py <convertize.js>`',
    ).toEqual([])
  })

  it('cada símbolo gerado tem corpo e id próprio', () => {
    for (const nome of NOMES_DO_SPRITE) {
      expect(SPRITE, `símbolo ${nome}`).toContain(`id="i-${nome}"`)
    }
    // A segunda camada é o que distingue este conjunto de um ícone de
    // biblioteca; se o subset perdesse as classes, o detalhe não acenderia
    // no item ativo e ninguém notaria até alguém olhar a tela.
    expect(SPRITE).toMatch(/class="a"/)
  })

  it('o que foi desenhado aqui segue a gramática do kit', () => {
    for (const [nome, svg] of Object.entries(SIMBOLOS_PROPRIOS)) {
      expect(svg, `${nome}: precisa do id que o <use> procura`).toContain(`id="i-${nome}"`)
      expect(svg, `${nome}: 24×24, como todo símbolo do kit`).toContain('viewBox="0 0 24 24"')
      // Sem a segunda camada o símbolo não acende no item ativo, e fica
      // visivelmente mais "chapado" que os vizinhos — que é exatamente o
      // problema que ele foi desenhado para resolver.
      expect(svg, `${nome}: precisa da camada de detalhe (.a)`).toMatch(/class="[^"]*\ba\b/)
    }
  })
})
