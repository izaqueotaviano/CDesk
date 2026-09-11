import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaTicket } from './PaginaTicket'

function detalhe(extra: Record<string, unknown> = {}) {
  return {
    id: 5,
    reference: 'TD-00005',
    subject: 'Logo errada no rodapé',
    status: 'open',
    stage: 2,
    stage_name: 'Aberto',
    stage_color: '#0275de',
    priority: 'normal',
    source: 'web',
    team: { id: 1, name: 'Suporte', slug: 'suporte' },
    requester_display: 'Ana Almeida',
    assignee_name: 'Samuel Suporte',
    assignee_id: 3,
    owner_name: null,
    owner_id: null,
    company_name: 'Acme',
    category: null,
    category_name: 'Site',
    current_status_note: null,
    is_restricted: false,
    content_hidden: false,
    sla: {
      first_response: { due_at: '2026-09-08T14:00:00Z', state: 'ok', minutes_left: 120 },
      resolution: { due_at: null, state: 'none', minutes_left: null },
    },
    tags: [],
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    first_response_at: null,
    closed_at: null,
    auto_closed: false,
    reopen_count: 0,
    messages: [
      {
        id: 10,
        author_name: 'Ana Almeida',
        author_avatar: null,
        author_is_internal: false,
        body: 'O logo do rodapé está com a versão antiga.',
        is_public: true,
        source: 'web',
        is_first_response: false,
        created_at: '2026-09-01T10:00:00Z',
        attachments: [],
        mentions: [],
        edited_at: null,
        is_deleted: false,
        can_edit: true,
      },
    ],
    events: [],
    watchers: [],
    requester: { name: 'Ana Almeida', email: 'ana@acme.test', ui_language: 'pt-br', timezone: null },
    ...extra,
  }
}

let ticketAtual: Record<string, unknown>
let pendentes: { ticket_id: number; reference: string; subject: string }[]
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  ticketAtual = detalhe()
  pendentes = []
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname + u.search, metodo, corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body })
      if (u.pathname === '/api/v1/tickets/5/') return Promise.resolve(jsonDe(ticketAtual))
      if (u.pathname === '/api/v1/tickets/5/reply/') {
        return Promise.resolve(jsonDe({ ...ticketAtual, status: 'open', messages: [...(ticketAtual.messages as unknown[]), { id: 11, author_name: 'Ana', author_avatar: null, author_is_internal: false, body: 'oi', is_public: true, source: 'web', is_first_response: false, created_at: '2026-09-03T10:00:00Z', attachments: [], mentions: [], edited_at: null, is_deleted: false, can_edit: true }] }))
      }
      if (u.pathname === '/api/v1/tickets/pending-ratings/') return Promise.resolve(jsonDe(pendentes))
      if (u.pathname === '/api/v1/tickets/5/rate/') return Promise.resolve(jsonDe({ ...ticketAtual, satisfaction: { score: 9 } }))
      if (u.pathname === '/api/v1/chat/quick-replies/') return Promise.resolve(jsonDe([{ id: 1, contexto: 'ticket', rotulo: 'Ainda não resolveu', texto: 'Oi! O problema continua acontecendo.', order: 1 }]))
      if (u.pathname === '/api/v1/tickets/response-estimate/') return Promise.resolve(jsonDe({ minutes: 120, sample: 10, label: '2 h' }))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/tickets/5']}>
        <Routes>
          <Route path="/portal/tickets/:id" element={<PaginaTicket />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaTicket (cliente)', () => {
  it('em andamento: mostra previsão de resposta, a conversa e envia a resposta com uma resposta rápida', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Logo errada no rodapé' })).toBeInTheDocument()
    expect(screen.getByText(/Resposta prevista até/)).toBeInTheDocument()
    expect(screen.getByText('O logo do rodapé está com a versão antiga.')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: 'Ainda não resolveu' }))
    const area = screen.getByLabelText('Responder')
    expect(area).toHaveValue('Oi! O problema continua acontecendo.')
    fireEvent.click(screen.getByRole('button', { name: /^Enviar$/ }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/tickets/5/reply/' && c.metodo === 'POST')).toBe(true))
    const envio = chamadas.find((c) => c.url === '/api/v1/tickets/5/reply/')!
    expect(envio.corpo).toEqual({ body: 'Oi! O problema continua acontecendo.', is_public: true })
  })

  it('resolvido: sem compositor até clicar em "Reabrir chamado", que explica o efeito', async () => {
    ticketAtual = detalhe({ status: 'closed', closed_at: '2026-09-02T12:00:00Z', first_response_at: '2026-09-01T12:00:00Z' })
    montar()
    await screen.findByRole('heading', { name: 'Logo errada no rodapé' })
    expect(screen.queryByLabelText('Responder')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Reabrir chamado/ }))
    expect(await screen.findByText(/reabre o chamado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Reabrir com uma mensagem')).toHaveFocus()
  })

  it('fechado automaticamente: não reabre — aponta para um novo ticket', async () => {
    ticketAtual = detalhe({ status: 'closed', auto_closed: true, closed_at: '2026-09-02T12:00:00Z' })
    montar()
    await screen.findByRole('heading', { name: 'Logo errada no rodapé' })
    expect(screen.queryByRole('button', { name: /Reabrir chamado/ })).not.toBeInTheDocument()
    expect(screen.getByText(/encerrado automaticamente/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir novo ticket/ })).toHaveAttribute('href', '/portal/tickets/novo')
  })

  it('resolvido e sem nota: pede a avaliação e envia', async () => {
    ticketAtual = detalhe({ status: 'closed', closed_at: '2026-09-02T12:00:00Z' })
    pendentes = [{ ticket_id: 5, reference: 'TD-00005', subject: 'Logo errada no rodapé' }]
    montar()
    expect(await screen.findByText('Como foi o atendimento?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '9' }))
    fireEvent.click(screen.getByRole('button', { name: /Enviar avaliação/ }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/tickets/5/rate/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/tickets/5/rate/')!.corpo).toEqual({ score: 9, comment: '' })
  })
})
