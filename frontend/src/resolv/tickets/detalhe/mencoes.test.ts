import { describe, expect, it } from 'vitest'
import { alternarLista, aplicarNoTexto, continuarLista, envolver, inserirLink } from '@/ui/edicaoFormatada'
import { consultaDeMencao, filtrarAlvos, inserirMencao, paraMarcacao } from './mencoes'
import type { AlvoMencao } from './tiposDetalhe'

const ALVOS: AlvoMencao[] = [
  { type: 'user', id: 1, name: 'Ana', email: 'ana@x.test', group: 'ticket' },
  { type: 'user', id: 2, name: 'Ana Paula Reis', email: 'apr@x.test', group: 'outros' },
  { type: 'user', id: 3, name: 'João Souza', email: 'joao@x.test', group: 'equipe' },
  { type: 'team', id: 3, name: 'Design', email: '', group: 'equipes' },
]

describe('@menção — regras puras', () => {
  it('só abre com @ no começo de palavra', () => {
    expect(consultaDeMencao('oi @an', 6)).toEqual({ inicio: 3, consulta: 'an' })
    expect(consultaDeMencao('@', 1)).toEqual({ inicio: 0, consulta: '' })
    expect(consultaDeMencao('ana@acme', 8)).toBeNull()
    expect(consultaDeMencao('oi @an\nx', 8)).toBeNull()
  })

  it('filtra sem acento e sobe quem começa com o termo, sem desfazer a ordem do servidor', () => {
    expect(filtrarAlvos(ALVOS, 'joao').map((a) => a.id)).toEqual([3])
    expect(filtrarAlvos(ALVOS, 'paula').map((a) => a.name)).toEqual(['Ana Paula Reis'])
    expect(filtrarAlvos(ALVOS, 'an').map((a) => a.name)).toEqual(['Ana', 'Ana Paula Reis'])
  })

  it('insere o nome com espaço depois', () => {
    const e = inserirMencao('oi @an', { inicio: 3, consulta: 'an' }, 6, { name: 'Ana' })
    expect(aplicarNoTexto('oi @an', e)).toBe('oi @Ana ')
    expect(e.selecao).toEqual([8, 8])
  })

  it('troca o nome pela marcação, nome mais longo primeiro, e distingue pessoa de equipe', () => {
    expect(paraMarcacao('@Ana Paula Reis e @Ana, e @Design.', ALVOS)).toBe(
      '@[user:2] e @[user:1], e @[team:3].',
    )
    // e-mail e nome colado em outra palavra não viram menção
    expect(paraMarcacao('ana@Ana e x@Design', ALVOS)).toBe('ana@Ana e x@Design')
    // quem foi escolhido na lista ganha do homônimo
    expect(paraMarcacao('@Ana', ALVOS, new Map([['Ana', 'user:99']]))).toBe('@[user:99]')
  })
})

describe('botões de formatação — regras puras', () => {
  it('negrito sem seleção põe o par e o cursor no meio', () => {
    const e = envolver('ab', 1, 1, '**')
    expect(aplicarNoTexto('ab', e)).toBe('a****b')
    expect(e.selecao).toEqual([3, 3])
  })

  it('negrito deixa o espaço das pontas de fora', () => {
    expect(aplicarNoTexto('x  ab  y', envolver('x  ab  y', 1, 7, '**'))).toBe('x  **ab**  y')
  })

  it('lista alterna, e troca de tipo sem empilhar prefixo', () => {
    const numerada = aplicarNoTexto('a\nb', alternarLista('a\nb', 0, 3, 'numerada'))
    expect(numerada).toBe('1. a\n2. b')
    expect(aplicarNoTexto(numerada, alternarLista(numerada, 0, numerada.length, 'marcada'))).toBe(
      '- a\n- b',
    )
    expect(aplicarNoTexto('- a', alternarLista('- a', 0, 3, 'marcada'))).toBe('a')
  })

  it('link com texto selecionado deixa o endereço selecionado para colar', () => {
    const e = inserirLink('ver site', 4, 8)
    expect(aplicarNoTexto('ver site', e)).toBe('ver [site](https://)')
    expect('ver [site](https://)'.slice(...e.selecao)).toBe('https://')
  })

  it('Enter em item vazio encerra a lista', () => {
    const e = continuarLista('- a\n- ', 6, 6)!
    expect(aplicarNoTexto('- a\n- ', e)).toBe('- a\n')
    expect(continuarLista('texto', 5, 5)).toBeNull()
  })
})
