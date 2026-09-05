import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recuperarMensagensPerdidas } from '@/api/chat'
import { useSalaChat } from './useSalaChat'

vi.mock('@/api/chat', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/chat')>()
  return { ...original, recuperarMensagensPerdidas: vi.fn(async () => undefined) }
})

class FakeWebSocket {
  static instancias: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  enviados: string[] = []
  constructor(public url: string) {
    FakeWebSocket.instancias.push(this)
  }
  send(d: string) {
    this.enviados.push(d)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instancias = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
  vi.mocked(recuperarMensagensPerdidas).mockClear()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSalaChat — reconexão busca por REST o que o socket perdeu', () => {
  it('na PRIMEIRA conexão não recupera nada (o fetch inicial cobre); na reconexão, recupera', () => {
    const { result } = renderHook(() => useSalaChat(7), { wrapper })
    expect(result.current.status).toBe('conectando')

    act(() => {
      FakeWebSocket.instancias[0].readyState = 1
      FakeWebSocket.instancias[0].onopen?.()
    })
    expect(result.current.status).toBe('aberto')
    expect(recuperarMensagensPerdidas).not.toHaveBeenCalled()

    // caiu: o compositor precisa saber (trava o texto) …
    act(() => {
      FakeWebSocket.instancias[0].readyState = 3
      FakeWebSocket.instancias[0].onclose?.()
    })
    expect(result.current.status).toBe('fechado')

    // … e ao voltar, o ?after= entra em cena — uma vez, para este chat
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(FakeWebSocket.instancias).toHaveLength(2)
    act(() => {
      FakeWebSocket.instancias[1].readyState = 1
      FakeWebSocket.instancias[1].onopen?.()
    })
    expect(result.current.status).toBe('aberto')
    expect(recuperarMensagensPerdidas).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recuperarMensagensPerdidas).mock.calls[0][1]).toBe(7)
  })

  it('"digitando" aparece e some sozinho; mensagem só sai com a conexão aberta', () => {
    const { result } = renderHook(() => useSalaChat(8), { wrapper })

    // sem conexão: enviar não manda nada (e não explode)
    act(() => result.current.enviarMensagem('oi'))
    expect(FakeWebSocket.instancias[0].enviados).toEqual([])

    act(() => {
      FakeWebSocket.instancias[0].readyState = 1
      FakeWebSocket.instancias[0].onopen?.()
    })
    act(() => result.current.enviarMensagem('oi'))
    expect(FakeWebSocket.instancias[0].enviados).toEqual([JSON.stringify({ type: 'message', body: 'oi' })])

    act(() => {
      FakeWebSocket.instancias[0].onmessage?.({
        data: JSON.stringify({ type: 'typing', user_id: 42, user_name: 'Beto', is_typing: true }),
      })
    })
    expect(result.current.digitando).toEqual({ user_id: 42, user_name: 'Beto' })
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(result.current.digitando).toBeNull()
  })
})
