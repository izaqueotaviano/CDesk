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
