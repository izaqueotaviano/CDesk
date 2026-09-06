import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaListaTickets } from './PaginaListaTickets'

const ME = {
  id: 2,
  full_name: 'Samuel Suporte',
  email: 'samuel@x.test',
  is_internal: true,
  is_admin: false,
  kind: 'internal',
  permissions: ['ticket.bulk_actions'],
}

const LINHA = {
  id: 7,
  reference: 'T-0007',
  subject: 'Assunto do ticket',
  status: 'open',
  stage_name: 'Em andamento',
  stage_color: '#888',
  priority: 'normal',
  source: 'web',
  requester_display: 'Cliente X',
  company_name: 'Empresa X',
  assignee_name: null,
  category_name: null,
  current_status_note: null,
  sla: {
    first_response: { due_at: null, state: 'none', minutes_left: null },
    resolution: { due_at: null, state: 'none', minutes_left: null },
  },
  first_response_at: null,
  created_at: new Date().toISOString(),
  is_restricted: false,
}

const AGENTE = { id: 9, full_name: 'Ana Agente', email: 'ana@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'available' }

let chamadas: { url: string; metodo: string; body?: unknown }[]
let respostaDoBulkAssign: () => Response

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
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      chamadas.push({ url: u.pathname, metodo, body })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/tickets/') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [LINHA] }))
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([AGENTE]))
      if (u.pathname === '/api/v1/tickets/bulk-assign/') return Promise.resolve(respostaDoBulkAssign())
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PaginaListaTickets />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaListaTickets — ações em lote', () => {
  it('atribuir com sucesso chama o endpoint e limpa a seleção', async () => {
    respostaDoBulkAssign = () => jsonDe({ updated: [7], failed: [] })
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    expect(await screen.findByText('1', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('Atribuir a…'), { target: { value: '9' } })

    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/v1/tickets/bulk-assign/' && c.metodo === 'POST')).toBe(true),
    )
    const chamada = chamadas.find((c) => c.url === '/api/v1/tickets/bulk-assign/')
    expect(chamada?.body).toEqual({ ticket_ids: [7], assignee_id: 9 })
    // seleção volta a zero: a barra de lote some
    await waitFor(() => expect(screen.queryByText('selecionado(s)', { exact: false })).not.toBeInTheDocument())
  })

  it('falha parcial mantém a seleção e mostra o motivo', async () => {
    respostaDoBulkAssign = () => jsonDe({ updated: [], failed: [{ id: 7, detail: 'Ticket de outra equipe.' }] })
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    fireEvent.change(screen.getByDisplayValue('Atribuir a…'), { target: { value: 'ninguem' } })

    expect(await screen.findByRole('alert')).toHaveTextContent('Ticket de outra equipe.')
    expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument() // seleção continua
  })
})
