import { describe, expect, it } from 'vitest'
import { indiceDeChat, TONS_DE_CHAT, tonsDistintos } from './tons'

describe('tonsDistintos — um tom por atendimento aberto, sem repetir', () => {
  it('sem colisão, cada chat fica com a cor da própria pessoa (o mesmo hash do avatar)', () => {
    const chats = [
      { id: 1, client_name: 'Ana Almeida' },
      { id: 2, client_name: 'Bruno Cliente' },
    ]
    const tons = tonsDistintos(chats)
    expect(tons.get(1)).toBe(indiceDeChat('Ana Almeida'))
    expect(tons.get(2)).toBe(indiceDeChat('Bruno Cliente'))
    expect(tons.get(1)).not.toBe(tons.get(2))
  })

  it('duas pessoas no mesmo tom: a de id maior anda pro próximo tom livre', () => {
    // Mesmo nome força a colisão de propósito.
    const chats = [
      { id: 10, client_name: 'Ana Almeida' },
      { id: 11, client_name: 'Ana Almeida' },
      { id: 12, client_name: 'Ana Almeida' },
    ]
    const tons = tonsDistintos(chats)
    const base = indiceDeChat('Ana Almeida')
    expect(tons.get(10)).toBe(base)
    expect(new Set(tons.values()).size).toBe(3)
    expect(tons.get(11)).toBe((base % TONS_DE_CHAT) + 1)
  })

  it('não depende da ordem em que a lista chega', () => {
    const a = tonsDistintos([{ id: 2, client_name: 'X' }, { id: 1, client_name: 'X' }])
    const b = tonsDistintos([{ id: 1, client_name: 'X' }, { id: 2, client_name: 'X' }])
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('mais de quinze abertos: volta a repetir (não há décimo sexto tom), sem travar', () => {
    const chats = Array.from({ length: 17 }, (_, i) => ({ id: i + 1, client_name: 'Mesma Pessoa' }))
    const tons = tonsDistintos(chats)
    expect(tons.size).toBe(17)
    for (const t of tons.values()) {
      expect(t).toBeGreaterThanOrEqual(1)
      expect(t).toBeLessThanOrEqual(TONS_DE_CHAT)
    }
  })

  it('até quinze abertos com nomes diferentes, nenhum repete', () => {
    // Quinze tons: quinze pessoas distintas cabem sem forçar colisão — a
    // vantagem sobre os seis tons antigos, que já colidiam com só três.
    const chats = Array.from({ length: TONS_DE_CHAT }, (_, i) => ({ id: i + 1, client_name: `Pessoa ${i + 1}` }))
    const tons = tonsDistintos(chats)
    expect(new Set(tons.values()).size).toBe(TONS_DE_CHAT)
  })
})
