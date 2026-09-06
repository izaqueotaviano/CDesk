import type { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conectarCanalPessoal, desconectarCanalPessoal } from './bridge'

/** Mesma dublê de `salaChat.test.ts` — registra instâncias e deixa o teste
 *  abrir/derrubar sem precisar de um servidor de verdade. */
class FakeWebSocket {
  static instancias: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  fechado = false

  constructor(public url: string) {
    FakeWebSocket.instancias.push(this)
  }
  send() {}
  close() {
    this.fechado = true
    this.readyState = 3
    this.onclose?.()
  }
}

const queryClientFalso = { invalidateQueries: vi.fn(), setQueryData: vi.fn() } as unknown as QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instancias = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  desconectarCanalPessoal() // não vaza o singleton de um teste pro outro
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('canal pessoal — sobrevive à troca de usuário na mesma aba', () => {
  it('chamar de novo sem desconectar reaproveita o mesmo socket (comportamento de sempre)', () => {
    conectarCanalPessoal(queryClientFalso)
    conectarCanalPessoal(queryClientFalso)
    expect(FakeWebSocket.instancias).toHaveLength(1)
  })

  it('logout fecha o socket da pessoa que saiu e o próximo connect abre um novo', () => {
    conectarCanalPessoal(queryClientFalso)
    const antigo = FakeWebSocket.instancias[0]
    expect(antigo.fechado).toBe(false)

    desconectarCanalPessoal()
    expect(antigo.fechado).toBe(true)

    // pessoa B loga na mesma aba — sem o fix, isto devolveria o `antigo` morto
    conectarCanalPessoal(queryClientFalso)
    expect(FakeWebSocket.instancias).toHaveLength(2)
    expect(FakeWebSocket.instancias[1]).not.toBe(antigo)
  })

  it('desconectar sem nunca ter conectado não explode', () => {
    expect(() => desconectarCanalPessoal()).not.toThrow()
  })
})
