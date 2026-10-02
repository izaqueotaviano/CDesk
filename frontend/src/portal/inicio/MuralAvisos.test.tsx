import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MuralAvisos } from './MuralAvisos'

const AVISOS = [
  { id: 1, title: 'Manutenção sábado', body: 'Sistema fora do ar das 2h às 4h.', kind: 'info', is_pinned: true, created_by_name: 'Admin', dismissed: false, created_at: '2026-09-01T00:00:00Z' },
]

let chamadas: { url: string; metodo: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/announcements/') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: AVISOS }))
      if (u.pathname === '/api/v1/announcements/1/dismiss/') return Promise.resolve(jsonDe({ dismissed: true }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MuralAvisos />
    </QueryClientProvider>,
  )
}

describe('MuralAvisos (portal)', () => {
  it('mostra o aviso da empresa/plano do cliente', async () => {
    montar()
    expect(await screen.findByText('Manutenção sábado')).toBeInTheDocument()
    expect(screen.getByText('Sistema fora do ar das 2h às 4h.')).toBeInTheDocument()
  })

  it('dispensar chama o endpoint certo', async () => {
    montar()
    await screen.findByText('Manutenção sábado')
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }))
    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/v1/announcements/1/dismiss/' && c.metodo === 'POST')).toBe(true),
    )
  })
})
