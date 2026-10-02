import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTicketsList } from './useTicketsList'

/**
 * Item (rodada 3): antes deste item a fila só atualizava em ação própria ou
 * invalidação por socket — sem NENHUMA rede de segurança se o socket caísse.
 * Mesmo espírito de `useTicketDetalhe` (detalhe/dados.ts, 60s) e da fila de
 * chat (api/chat.ts::useFilaChat, 30s): o teste confere o comportamento
 * (refetch de verdade decorrido o intervalo), não só o número passado pro
 * React Query.
 */

function jsonDe(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const PAGINA_VAZIA = { count: 0, next: null, previous: null, results: [] }

let chamadasDeLista: number

beforeEach(() => {
  chamadasDeLista = 0
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/tickets/') chamadasDeLista++
      return Promise.resolve(jsonDe(PAGINA_VAZIA))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

describe('useTicketsList — refetch periódico é rede de segurança, não o caminho normal', () => {
  it('refaz a busca sozinho depois de 30s parado, sem nenhuma ação da pessoa', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useTicketsList({ ordering: '-criado', limit: 25, offset: 0 }), {
      wrapper: wrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(chamadasDeLista).toBe(1)

    await vi.advanceTimersByTimeAsync(30_000)

    await waitFor(() => expect(chamadasDeLista).toBe(2))
  })

  it('antes dos 30s passarem, não refaz a busca sozinho', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { result } = renderHook(() => useTicketsList({ ordering: '-criado', limit: 25, offset: 0 }), {
      wrapper: wrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(chamadasDeLista).toBe(1)

    await vi.advanceTimersByTimeAsync(29_000)

    expect(chamadasDeLista).toBe(1)
  })
})
