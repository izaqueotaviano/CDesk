import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilaDePrioridade } from './FilaDePrioridade'

function linha(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, reference: `T-000${id}`, subject: `Assunto ${id}`, status: 'open', stage_name: 'Em andamento', stage_color: '#888',
    priority: 'high', source: 'web', requester_display: 'Cliente X', company_name: 'Empresa X', assignee_name: null,
    category_name: null, current_status_note: null,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: '2026-09-06T18:00:00Z', state: 'at_risk', minutes_left: 90 } },
    first_response_at: null, created_at: '2026-09-06T10:00:00Z', is_restricted: false, ...extra,
  }
}

let resultados: unknown[]
let chamadas: { url: string; search: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  resultados = [linha(1)]
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/tickets/') return Promise.resolve(jsonDe({ count: resultados.length, next: null, previous: null, results: resultados }))
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
          <Route path="/inicio" element={<FilaDePrioridade />} />
          <Route path="/chamados/:id" element={<p>detalhe do ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('FilaDePrioridade', () => {
  it('pede meus-nao-resolvidos ordenado por sla', async () => {
    montar()
    await screen.findByText('Assunto 1')
    const chamada = chamadas.find((c) => c.url === '/api/v1/tickets/')!
    expect(chamada.search).toContain('view=meus-nao-resolvidos')
    expect(chamada.search).toContain('ordering=sla')
  })

  it('mostra o estado do SLA e clicar leva pro ticket', async () => {
    montar()
    await screen.findByText('Assunto 1')
    expect(screen.getByText(/em risco/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Assunto 1'))
    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
  })

  it('sem pendências, mostra o vazio', async () => {
    resultados = []
    montar()
    expect(await screen.findByText('Nada pendente com você agora.')).toBeInTheDocument()
  })
})
