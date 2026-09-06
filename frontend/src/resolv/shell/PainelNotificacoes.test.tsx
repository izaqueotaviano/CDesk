import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PainelNotificacoes } from './PainelNotificacoes'

const NOTIFICACOES = [
  { id: 1, kind: 'ticket_assigned', title: 'Ticket atribuído a você: T-0007', body: 'Impressora não liga', url: '/chamados/7', ticket_id: 7, actor_name: 'Ana', read_at: null, created_at: '2026-09-06T00:00:00Z' },
  { id: 2, kind: 'mention', title: 'Samuel mencionou você', body: 'pode olhar?', url: '/chamados/9#mensagem-3', ticket_id: 9, actor_name: 'Samuel', read_at: '2026-09-05T00:00:00Z', created_at: '2026-09-05T00:00:00Z' },
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
      if (u.pathname === '/api/v1/notifications/') {
        return Promise.resolve(jsonDe({ count: 2, next: null, previous: null, results: NOTIFICACOES, unread_count: 1 }))
      }
      if (u.pathname === '/api/v1/notifications/1/read/') return Promise.resolve(jsonDe({ marked_read: 1 }))
      if (u.pathname === '/api/v1/notifications/read-all/') return Promise.resolve(jsonDe({ marked_read: 1 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<PainelNotificacoes />} />
          <Route path="/chamados/:id" element={<p>detalhe do ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PainelNotificacoes', () => {
  it('o sino mostra a contagem real de não lidas', async () => {
    montar()
    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('abrir o painel lista as notificações', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText('Ticket atribuído a você: T-0007')).toBeInTheDocument()
    expect(screen.getByText('Samuel mencionou você')).toBeInTheDocument()
  })

  it('clicar numa não lida marca como lida e navega pra url dela', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByText('Ticket atribuído a você: T-0007'))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/notifications/1/read/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
  })

  it('clicar numa já lida navega mas não marca de novo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByText('Samuel mencionou você'))

    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
    expect(chamadas.some((c) => c.url === '/api/v1/notifications/2/read/')).toBe(false)
  })

  it('"Marcar todas como lidas" chama o endpoint certo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/notifications/read-all/' && c.metodo === 'POST')).toBe(true))
  })
})
