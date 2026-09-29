import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoMeusDados } from './SecaoMeusDados'

let chamadas: { url: string; metodo: string; corpo: unknown }[]
let respostaLista: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  respostaLista = () => jsonDe([])
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/me/data-requests/' && metodo === 'GET') return Promise.resolve(respostaLista())
      if (u.pathname === '/api/v1/me/data-requests/' && metodo === 'POST') {
        return Promise.resolve(jsonDe({ id: 9, kind: 'export', status: 'running', has_export: false, error: '', rejection_reason: '', created_at: '2026-09-06T00:00:00Z' }, 201))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecaoMeusDados />
    </QueryClientProvider>,
  )
}

describe('SecaoMeusDados', () => {
  it('pedir exportação chama o endpoint certo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir exportação dos meus dados' }))
    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/v1/me/data-requests/' && c.metodo === 'POST')).toBe(true),
    )
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).toEqual({ kind: 'export' })
  })

  it('pedido pronto mostra o botão de baixar', async () => {
    respostaLista = () =>
      jsonDe([{ id: 5, kind: 'export', status: 'done', has_export: true, error: '', rejection_reason: '', created_at: '2026-09-01T00:00:00Z' }])
    montar()
    const link = await screen.findByRole('link', { name: /Baixar/ })
    expect(link).toHaveAttribute('href', '/api/v1/audit/lgpd/5/download/')
  })

  it('pedido em andamento desabilita o botão de pedir de novo', async () => {
    respostaLista = () =>
      jsonDe([{ id: 5, kind: 'export', status: 'running', has_export: false, error: '', rejection_reason: '', created_at: '2026-09-01T00:00:00Z' }])
    montar()
    expect(await screen.findByRole('button', { name: 'Exportação em andamento…' })).toBeDisabled()
  })
})
