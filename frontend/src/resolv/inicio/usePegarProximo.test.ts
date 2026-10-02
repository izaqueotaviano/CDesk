import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NadaParaPegar, usePegarProximo, useQuantosSemDono } from './usePegarProximo'

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function envolver() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
}

let pedidos: { url: URL; metodo: string }[]
let resposta: () => Response

beforeEach(() => {
  pedidos = []
  resposta = () => jsonDe({ id: 7, reference: 'T-7' })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      pedidos.push({ url: new URL(String(url), 'http://x'), metodo: init?.method ?? 'GET' })
      return Promise.resolve(resposta())
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('usePegarProximo', () => {
  it('escolhe e atribui numa ação só do servidor, e devolve o chamado pego', async () => {
    const { result } = renderHook(() => usePegarProximo(3), { wrapper: envolver() })

    let pego: { id: number } | undefined
    await act(async () => {
      pego = await result.current.mutateAsync()
    })

    expect(pego?.id).toBe(7)
    // um pedido só: a escolha e a atribuição são do backend, travadas juntas
    const escritas = pedidos.filter((p) => p.metodo === 'POST')
    expect(escritas.map((p) => p.url.pathname)).toEqual(['/api/v1/tickets/take-next/'])
    expect(pedidos.some((p) => p.url.pathname.endsWith('/assign/'))).toBe(false)
  })

  it('409 "nada_para_pegar" vira NadaParaPegar, não erro de rede', async () => {
    resposta = () => jsonDe({ code: 'nada_para_pegar', detail: 'Nenhum chamado sem responsável agora.' }, 409)
    const { result } = renderHook(() => usePegarProximo(3), { wrapper: envolver() })

    await act(async () => {
      await result.current.mutateAsync().catch(() => {})
    })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(NadaParaPegar))
  })

  it('sem usuário na sessão, nem chama o servidor', async () => {
    const { result } = renderHook(() => usePegarProximo(undefined), { wrapper: envolver() })

    await act(async () => {
      await result.current.mutateAsync().catch(() => {})
    })

    expect(pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(0)
  })
})

describe('useQuantosSemDono', () => {
  it('conta só sem responsável, novo ou aberto', async () => {
    resposta = () => jsonDe({ count: 4, next: null, previous: null, results: [] })
    const { result } = renderHook(() => useQuantosSemDono(), { wrapper: envolver() })

    await waitFor(() => expect(result.current.data).toBe(4))
    const q = pedidos[0]!.url.searchParams
    expect(q.get('assignee')).toBe('unassigned')
    expect(q.get('status')).toBe('new,open')
  })
})
