import { readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * No Linux, `PegarProximo.tsx` e `pegarProximo.ts` são dois arquivos. No macOS
 * e no Windows o sistema de arquivos ignora a caixa, e `import './PegarProximo'`
 * passa a abrir o `.ts` (o Vite tenta `.ts` antes de `.tsx`): o erro vira
 * "does not provide an export named" só na máquina de quem usa Mac, e o CI
 * (Linux) segue verde. Este teste pega o par antes: duas fontes na mesma pasta
 * com o mesmo nome, ignorando a caixa, e extensões que o Vite tenta abrir.
 *
 * `.scss` e `.css` ficam de fora de propósito: nunca são "adivinhados" por
 * import sem extensão, então `Sidebar.tsx` ao lado de `sidebar.scss` é seguro.
 */

const RAIZ = join(__dirname, '..')
// as extensões que o resolvedor do Vite tenta quando o import vem sem extensão
const RESOLVIVEIS = new Set(['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'])

function fontes(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) return nome === 'node_modules' ? [] : fontes(caminho)
    return RESOLVIVEIS.has(extname(nome)) ? [caminho] : []
  })
}

describe('nomes de arquivo', () => {
  it('nenhum par de fontes na mesma pasta difere só pela caixa do nome', () => {
    const porNome = new Map<string, string[]>()
    for (const arquivo of fontes(RAIZ)) {
      const dir = arquivo.slice(0, arquivo.length - arquivo.split('/').pop()!.length)
      const base = arquivo.split('/').pop()!
      const semExtensao = base.slice(0, base.length - extname(base).length)
      const chave = `${dir}${semExtensao.toLowerCase()}`
      porNome.set(chave, [...(porNome.get(chave) ?? []), relative(RAIZ, arquivo)])
    }
    const colisoes = [...porNome.values()].filter(
      (nomes) => new Set(nomes.map((n) => n.split('/').pop()!.replace(/\.[^.]+$/, ''))).size > 1,
    )
    expect(
      colisoes,
      'Renomeie um deles (o de lógica costuma virar use<Nome>.ts ou outro nome): no Mac o import abre o arquivo errado.',
    ).toEqual([])
  })
})
