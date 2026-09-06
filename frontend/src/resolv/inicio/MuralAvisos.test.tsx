import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MuralAvisos } from './MuralAvisos'

const AVISOS = [
  { id: 1, title: 'Manutenção sábado', body: 'Sistema fora do ar das 2h às 4h.', kind: 'info', is_pinned: true, created_by_name: 'Admin', dismissed: false, created_at: '2026-09-01T00:00:00Z' },
  { id: 2, title: 'Feriado', body: 'Não há atendimento na segunda.', kind: 'holiday', is_pinned: false, created_by_name: 'Admin', dismissed: false, created_at: '2026-09-02T00:00:00Z' },
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
      if (u.pathname === '/api/v1/announcements/') return Promise.resolve(jsonDe({ count: 2, next: null, previous: null, results: AVISOS }))
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

describe('MuralAvisos (resolv)', () => {
  it('mostra os avisos da própria audiência', async () => {
    montar()
    expect(await screen.findByText('Manutenção sábado')).toBeInTheDocument()
    expect(screen.getByText('Feriado')).toBeInTheDocument()
  })

  it('dispensar chama o endpoint certo', async () => {
    montar()
    await screen.findByText('Manutenção sábado')
    fireEvent.click(screen.getAllByRole('button', { name: 'Dispensar aviso' })[0])
    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/v1/announcements/1/dismiss/' && c.metodo === 'POST')).toBe(true),
    )
  })

  it('sem avisos, não renderiza nada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [] }))),
    )
    const { container } = montar()
    await waitFor(() => expect(container.firstChild).toBeNull())
  })
})
