import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { identidadeDe, indiceDeIdentidade, tintaDeIdentidade, TONS_DE_IDENTIDADE } from './identidade'

describe('cor de identidade — hash compartilhado', () => {
  it('é determinístico: o mesmo nome cai sempre no mesmo tom', () => {
    expect(indiceDeIdentidade('Ana Almeida')).toBe(indiceDeIdentidade('Ana Almeida'))
  })

  it('ignora caixa e espaços — dois cadastros da mesma pessoa, uma cor só', () => {
    expect(indiceDeIdentidade('Ana Almeida')).toBe(indiceDeIdentidade('  ana almeida '))
  })

  it('fica sempre dentro de 1..6, inclusive pra chave vazia', () => {
    for (const chave of ['', 'a', 'Val Visitante', 'Cetus Contábil', 'zzzzzzzzzz']) {
      const i = indiceDeIdentidade(chave)
      expect(i).toBeGreaterThanOrEqual(1)
      expect(i).toBeLessThanOrEqual(TONS_DE_IDENTIDADE)
    }
  })

  it('espalha nomes diferentes por mais de um tom (não é constante)', () => {
    const tons = new Set(['Ana Almeida', 'Beto Barros', 'Cetus Contábil', 'Fátima', 'Samuel', 'Val'].map(indiceDeIdentidade))
    expect(tons.size).toBeGreaterThan(1)
  })

  it('identidadeDe devolve o atributo que o CSS lê', () => {
    expect(identidadeDe('Ana Almeida')).toEqual({ 'data-identidade': indiceDeIdentidade('Ana Almeida') })
  })

  it('tintaDeIdentidade leva o índice pro atributo de tinta (selo, não avatar)', () => {
    expect(tintaDeIdentidade(4)).toEqual({ 'data-identidade-tinta': 4 })
  })
})

// --------------------------------------------------------------------------
// A paleta em si — os VALORES moram em três arquivos de token (portal,
// console, cvz) que se mantêm sincronizados à mão. Este bloco é a trava:
// lê os três, confere que dizem a mesma coisa e mede o contraste.
// --------------------------------------------------------------------------

const RAIZ = join(__dirname, '..')
const TOKENS_CSS = readFileSync(join(RAIZ, 'styles/tokens.css'), 'utf8')
const TOKENS_RESOLV = readFileSync(join(RAIZ, 'resolv/styles/tokens.scss'), 'utf8')
const TEMA_CVZ = readFileSync(join(RAIZ, 'cvz/styles/_theme.scss'), 'utf8')

/** Primeiro valor declarado de `--nome` (o do tema claro, que vem antes). */
function valor(fonte: string, nome: string): string {
  const m = fonte.match(new RegExp(`${nome}:\\s*(#[0-9a-fA-F]{6})`))
  if (!m) throw new Error(`token ${nome} não encontrado`)
  return m[1].toLowerCase()
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminancia(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}

/** Matiz (0–360) e saturação (0–1) em HSL. */
function matiz(hex: string): { h: number; s: number } {
  const [r, g, b] = rgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return { h: 0, s: 0 }
  const l = (max + min) / 2
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return { h: h < 0 ? h + 360 : h, s }
}

/** Vermelho, carmim, salmão e laranja (até ~28°): o que num avatar lê como
 *  alerta ou como a marca. Areia/caramelo (~32°) e os marrons dessaturados
 *  ficam de fora — não imitam estado. */
function avermelhado(hex: string): boolean {
  const { h, s } = matiz(hex)
  return s > 0.25 && (h >= 330 || h <= 28)
}

const INDICES = [1, 2, 3, 4, 5, 6]

describe('paleta de identidade — os três arquivos de token', () => {
  const portal = INDICES.map((i) => valor(TOKENS_CSS, `--avatar-c${i}`))
  const console_ = INDICES.map((i) => valor(TOKENS_RESOLV, `--identidade-${i}`))
  const cvz = INDICES.map((i) => valor(TEMA_CVZ, `--cvz-identity-${i}`))

  it('portal, console e cvz têm os mesmos seis tons, na mesma ordem', () => {
    expect(console_).toEqual(portal)
    expect(cvz).toEqual(portal)
  })

  it('nenhum tom é avermelhado (avatar vermelho numa lista lê como alerta)', () => {
    expect(portal.filter(avermelhado)).toEqual([])
  })

  it('iniciais brancas passam AA em todos (4,5:1)', () => {
    for (const cor of portal) expect(contraste('#ffffff', cor)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('paleta do chat (15 tons) — sem vermelho, e cada tom com a sua tinta', () => {
  const tons = Array.from({ length: 15 }, (_, i) => i + 1).map((i) => ({
    i,
    cor: valor(TOKENS_RESOLV, `--chat-tom-${i}`),
    tinta: valor(TOKENS_RESOLV, `--chat-tom-${i}-tinta`),
  }))

  it('nenhum tom é vermelho, carmim, salmão ou laranja', () => {
    expect(tons.filter((t) => avermelhado(t.cor)).map((t) => `${t.i}: ${t.cor}`)).toEqual([])
  })

  it('a tinta de cada tom passa AA sobre ele', () => {
    for (const t of tons) expect(contraste(t.tinta, t.cor), `tom ${t.i}`).toBeGreaterThanOrEqual(4.5)
  })
})

describe('texto silencioso — o degrau mais claro que ainda passa AA', () => {
  const muted = [
    valor(TOKENS_CSS, '--tinta-terciaria'),
    valor(TOKENS_RESOLV, '--text-muted'),
    valor(TEMA_CVZ, '--cvz-text-muted'),
  ]

  it('é o mesmo valor nos três arquivos', () => {
    expect(new Set(muted).size).toBe(1)
  })

  it('passa 4,5:1 no plano, no cartão e na pílula ativa (claro)', () => {
    for (const fundo of ['#f6f5f3', '#ffffff', '#eae9e6']) {
      expect(contraste(muted[0], fundo), fundo).toBeGreaterThanOrEqual(4.5)
    }
  })
})
