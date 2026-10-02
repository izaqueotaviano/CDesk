import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilaDeChat } from './FilaDeChat'

function chatNaFila(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, status: 'queued', name: '', client_id: 4, client_name: 'Ana Almeida', client_email: 'ana@acme.test', client_phone: '',
    client_avatar: null, company_name: 'Acme', agent_name: null, agent_id: null, agent_avatar: null, category: null,
    category_name: null, priority: 'normal', assignee: null, assignee_name: null, tag_ids: [], queued_at: '2026-09-06T10:00:00Z',
    accepted_at: null, closed_at: null, reopen_count: 0, timeout_converted: false, unread_count: 0, last_message_preview: null,
    rating: null, rating_pending: false, ticket_id: null, ticket_reference: null, ws_url: '', ...extra,
  }
}

let fila: unknown[]
let chamadas: { url: string; metodo: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  fila = [chatNaFila(11)]
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('status') === 'queued') return Promise.resolve(jsonDe(pagina(fila)))
      if (u.pathname === '/api/v1/chat/chats/11/take/' && metodo === 'POST') return Promise.resolve(jsonDe(chatNaFila(11, { status: 'active', agent_id: 3 })))
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
          <Route path="/inicio" element={<FilaDeChat />} />
          <Route path="/chat" element={<p>console de chat</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FilaDeChat', () => {
  it('mostra quem está esperando', async () => {
    montar()
    expect(await screen.findByText('Ana Almeida')).toBeInTheDocument()
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('pegar chama o endpoint certo e vai pro console já com o chat selecionado', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Pegar' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/chats/11/take/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('console de chat')).toBeInTheDocument()
  })

  it('"Ver console" leva pro /chat mesmo sem ninguém na fila', async () => {
    fila = []
    montar()
    expect(await screen.findByText('Ninguém esperando agora.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ver console' }))
    expect(await screen.findByText('console de chat')).toBeInTheDocument()
  })
})
