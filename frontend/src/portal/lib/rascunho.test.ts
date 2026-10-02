import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chaveDeRascunho, gravarRascunho, lerRascunho, useRascunho } from './rascunho'

beforeEach(() => {
  window.localStorage.clear()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

const vazio = (t: string) => !t.trim()

describe('chaveDeRascunho', () => {
  it('sem pessoa não há chave: rascunho nunca é de "ninguém"', () => {
    expect(chaveDeRascunho(undefined, 'ticket', 5)).toBeNull()
    expect(chaveDeRascunho(3, 'ticket', 5)).toBe('resolv:portal:rascunho:3:ticket:5')
  })
})

describe('useRascunho', () => {
  it('grava com respiro e restaura na volta, avisando', () => {
    const chave = chaveDeRascunho(1, 'ticket', 5)!
    let texto = ''
    const restaurar = vi.fn((t: string) => {
      texto = t
    })
    const { rerender, unmount } = renderHook(({ v }) => useRascunho(chave, v, restaurar, vazio), { initialProps: { v: '' } })
    rerender({ v: 'Oi, o problema continua' })
    expect(lerRascunho(chave)).toBeNull() // ainda no respiro
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(lerRascunho(chave)).toBe('Oi, o problema continua')
    unmount()

    const volta = renderHook(() => useRascunho(chave, texto, restaurar, vazio))
    expect(restaurar).toHaveBeenCalledWith('Oi, o problema continua')
    expect(volta.result.current.restaurado).toBe(true)
  })

  it('texto apagado apaga o rascunho em vez de guardar vazio', () => {
    const chave = chaveDeRascunho(1, 'novo-ticket')!
    gravarRascunho(chave, 'algo')
    const { rerender } = renderHook(({ v }) => useRascunho(chave, v, () => {}, vazio), { initialProps: { v: 'algo' } })
    rerender({ v: '   ' })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(window.localStorage.getItem(chave)).toBeNull()
  })

  it('limpar() (enviado) apaga e cancela a gravação que estava pendente', () => {
    const chave = chaveDeRascunho(1, 'ticket', 9)!
    const { result, rerender } = renderHook(({ v }) => useRascunho(chave, v, () => {}, vazio), { initialProps: { v: '' } })
    rerender({ v: 'enviando isto' })
    act(() => result.current.limpar())
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(window.localStorage.getItem(chave)).toBeNull()
    expect(result.current.restaurado).toBe(false)
  })

  it('rascunho de mais de 30 dias é descartado', () => {
    const chave = chaveDeRascunho(1, 'ticket', 2)!
    window.localStorage.setItem(chave, JSON.stringify({ v: 'velho', em: Date.now() - 31 * 24 * 3600 * 1000 }))
    const restaurar = vi.fn()
    renderHook(() => useRascunho(chave, '', restaurar, vazio))
    expect(restaurar).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(chave)).toBeNull()
  })

  it('localStorage bloqueado não derruba nada', () => {
    const chave = chaveDeRascunho(1, 'ticket', 3)!
    const espiao = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    const { rerender } = renderHook(({ v }) => useRascunho(chave, v, () => {}, vazio), { initialProps: { v: '' } })
    rerender({ v: 'texto' })
    expect(() =>
      act(() => {
        vi.advanceTimersByTime(500)
      }),
    ).not.toThrow()
    espiao.mockRestore()
  })

  it('cada chamado tem o seu', () => {
    gravarRascunho(chaveDeRascunho(1, 'ticket', 5)!, 'do cinco')
    const restaurar = vi.fn()
    renderHook(() => useRascunho(chaveDeRascunho(1, 'ticket', 6), '', restaurar, vazio))
    expect(restaurar).not.toHaveBeenCalled()
  })
})
