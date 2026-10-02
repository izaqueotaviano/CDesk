import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VencimentosSla } from './VencimentosSla'

function linha(id: number, estado: 'breached' | 'at_risk', assignee_name: string | null = 'Samuel Suporte') {
  return {
    id, reference: `T-000${id}`, subject: `Assunto ${id}`, status: 'open', stage_name: 'Em andamento', stage_color: '#888',
    priority: 'high', source: 'web', requester_display: 'Cliente X', company_name: 'Empresa X', assignee_name,
    category_name: null, current_status_note: null,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: '2026-09-06T18:00:00Z', state: estado, minutes_left: estado === 'breached' ? -30 : 45 } },
    first_response_at: null, created_at: '2026-09-06T10:00:00Z', is_restricted: false,
  }
}

let breached: unknown[]
let emRisco: unknown[]
let chamadas: { url: string; search: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  breached = [linha(1, 'breached')]
  emRisco = [linha(2, 'at_risk', null)]
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/tickets/' && u.searchParams.get('sla') === 'breached') {
        return Promise.resolve(jsonDe({ count: breached.length, next: null, previous: null, results: breached }))
      }
      if (u.pathname === '/api/v1/tickets/' && u.searchParams.get('sla') === 'at_risk') {
        return Promise.resolve(jsonDe({ count: emRisco.length, next: null, previous: null, results: emRisco }))
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
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<VencimentosSla />} />
          <Route path="/tickets/:id" element={<p>detalhe do ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('VencimentosSla', () => {
  it('mostra estourados e em risco, estourado primeiro, com o responsável', async () => {
    montar()
    const itens = await screen.findAllByText(/Assunto/)
    expect(itens.map((i) => i.textContent)).toEqual(['Assunto 1', 'Assunto 2'])
    expect(screen.getByText('Estourado')).toBeInTheDocument()
    expect(screen.getByText(/em risco/)).toBeInTheDocument()
    expect(screen.getByText(/Sem responsável/)).toBeInTheDocument()
  })

  it('o contador soma as duas chamadas', async () => {
    montar()
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('clicar num item leva pro ticket', async () => {
    montar()
    fireEvent.click(await screen.findByText('Assunto 1'))
    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
  })

  it('nada vencendo, mostra o vazio', async () => {
    breached = []
    emRisco = []
    montar()
    expect(await screen.findByText('Nada vencendo agora. Bom trabalho.')).toBeInTheDocument()
  })
})
