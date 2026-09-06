import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaInicio } from './PaginaInicio'

const ME = { id: 2, full_name: 'Samuel Suporte', email: 'samuel@x.test', is_internal: true, is_admin: false, kind: 'internal', permissions: [] }

function linhaTicket(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, reference: `T-000${id}`, subject: `Assunto ${id}`, status: 'open', stage_name: 'Em andamento', stage_color: '#888',
    priority: 'high', source: 'web', requester_display: 'Cliente X', company_name: 'Empresa X', assignee_name: null,
    category_name: null, current_status_note: null,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: null, state: 'at_risk', minutes_left: 60 } },
    first_response_at: null, created_at: '2026-09-06T10:00:00Z', is_restricted: false, ...extra,
  }
}

let filaAberta: boolean
let queueOpensAt: string | null

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  filaAberta = true
  queueOpensAt = null
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/announcements/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/chat/config/') {
        return Promise.resolve(jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: filaAberta, queue_opens_at: queueOpensAt }))
      }
      if (u.pathname === '/api/v1/reports/indicators/') {
        return Promise.resolve(jsonDe({ kpis: [{ key: 'resolved', label: 'Tickets resolvidos', description: '', unit: 'count', direction: 'up', value: 8, variation: 14 }] }))
      }
      if (u.pathname === '/api/v1/tickets/' && u.searchParams.get('view') === 'meus-nao-resolvidos') {
        return Promise.resolve(jsonDe(pagina([linhaTicket(1)])))
      }
      if (u.pathname === '/api/v1/tickets/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([]))
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
          <Route path="/inicio" element={<PaginaInicio />} />
          <Route path="/chat" element={<p>console de chat</p>} />
          <Route path="/chamados/novo" element={<p>novo ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaInicio', () => {
  it('saúda pelo primeiro nome e mostra a fila aberta', async () => {
    montar()
    expect(await screen.findByText('Olá, Samuel')).toBeInTheDocument()
    expect(screen.getByText('Fila de chat aberta')).toBeInTheDocument()
  })

  it('fila fechada mostra quando volta', async () => {
    filaAberta = false
    queueOpensAt = '2026-09-08T12:00:00Z'
    montar()
    expect(await screen.findByText(/Fila de chat fechada.*volta/)).toBeInTheDocument()
  })

  it('os botões de ação levam pro console de chat e pro novo ticket', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Chat/ }))
    expect(await screen.findByText('console de chat')).toBeInTheDocument()
  })

  it('novo ticket leva pra tela de abertura', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Novo ticket/ }))
    expect(await screen.findByText('novo ticket')).toBeInTheDocument()
  })

  it('mostra a fila de prioridade própria', async () => {
    montar()
    expect(await screen.findByText('Seus próximos')).toBeInTheDocument()
    expect(await screen.findByText('Assunto 1')).toBeInTheDocument()
  })

  it('mostra o resumo "resolvidos hoje" com a variação', async () => {
    montar()
    expect(await screen.findByText('Resolvidos hoje')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/\+14%.*vs ontem/)).toBeInTheDocument()
  })

  it('ainda mostra a faixa de KPI de sempre', async () => {
    montar()
    expect(await screen.findByText('Não resolvidos')).toBeInTheDocument()
    expect(screen.getByText('Meus tickets')).toBeInTheDocument()
  })
})
