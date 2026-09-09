import { describe, expect, it } from 'vitest'
import { indiceDeIdentidade } from '@/ui/identidade'
import { tonsDistintos } from './tons'

describe('tonsDistintos — um tom por atendimento aberto, sem repetir', () => {
  it('sem colisão, cada chat fica com a cor da própria pessoa (o mesmo hash do avatar)', () => {
    const chats = [
      { id: 1, client_name: 'Ana Almeida' },
      { id: 2, client_name: 'Val Visitante' },
    ]
    const tons = tonsDistintos(chats)
    expect(tons.get(1)).toBe(indiceDeIdentidade('Ana Almeida'))
    expect(tons.get(2)).toBe(indiceDeIdentidade('Val Visitante'))
    expect(tons.get(1)).not.toBe(tons.get(2))
  })

  it('duas pessoas no mesmo tom: a de id maior anda pro próximo tom livre', () => {
    // "aa" e "bb" caem em tons diferentes; forçamos colisão com o mesmo nome
    const chats = [
      { id: 10, client_name: 'Ana Almeida' },
      { id: 11, client_name: 'Ana Almeida' },
      { id: 12, client_name: 'Ana Almeida' },
    ]
    const tons = tonsDistintos(chats)
    const base = indiceDeIdentidade('Ana Almeida')
    expect(tons.get(10)).toBe(base)
    expect(new Set(tons.values()).size).toBe(3)
    expect(tons.get(11)).toBe((base % 6) + 1)
  })

  it('não depende da ordem em que a lista chega', () => {
    const a = tonsDistintos([{ id: 2, client_name: 'X' }, { id: 1, client_name: 'X' }])
    const b = tonsDistintos([{ id: 1, client_name: 'X' }, { id: 2, client_name: 'X' }])
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort())
  })

  it('mais de seis abertos: volta a repetir (não há sétimo tom), sem travar', () => {
    const chats = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, client_name: 'Mesma Pessoa' }))
    const tons = tonsDistintos(chats)
    expect(tons.size).toBe(8)
    for (const t of tons.values()) expect(t).toBeGreaterThanOrEqual(1)
  })
})
