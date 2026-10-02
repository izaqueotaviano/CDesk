import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaTickets } from './PaginaTickets'

function ticket(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    reference: `TD-${String(id).padStart(5, '0')}`,
    subject: `Assunto ${id}`,
    order_number: '',
    status: 'pending_customer',
    stage_name: 'Aguardando',
    stage_color: '#e0a000',
    priority: 'normal',
    team: { id: 1, name: 'Suporte', slug: 'suporte' },
    category_name: null,
    requester_display: 'Ana',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-02T10:00:00Z',
    closed_at: null,
    auto_closed: false,
    first_response_at: null,
    reopen_count: 0,
    is_restricted: false,
    content_hidden: false,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: null, state: 'none', minutes_left: null } },
    satisfaction: null,
    ...extra,
  }
}

let urls: string[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** Contagem por recorte: 2 aguardando você, 1 aguardando suporte, 0 no resto. */
function responder(url: string): Response {
  const u = new URL(url, 'http://x')
  if (u.pathname === '/api/v1/categories/') return jsonDe([{ id: 7, name: 'Fiscal', service: null }])
  if (u.pathname !== '/api/v1/tickets/') return jsonDe([])
  const status = u.searchParams.get('status')
  if (status === 'pending_customer') {
    return jsonDe({ count: 2, next: null, previous: null, results: [ticket(1, { subject: 'Boleto errado' }), ticket(2, { subject: 'Nota fiscal atrasada' })] })
  }
  if (status === 'new') return jsonDe({ count: 1, next: null, previous: null, results: [ticket(3, { status: 'new', subject: 'Dúvida de integração' })] })
  return jsonDe({ count: 0, next: null, previous: null, results: [] })
}

beforeEach(() => {
  urls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url))
      return Promise.resolve(responder(String(url)))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/portal/tickets') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/portal/tickets" element={<PaginaTickets />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaTickets', () => {
  it('abre em "Aguardando seu retorno" com o contador de cada aba e a lista da aba', async () => {
    montar()
    expect(await screen.findByText('Boleto errado')).toBeInTheDocument()
    expect(screen.getByText('Nota fiscal atrasada')).toBeInTheDocument()
    const abaVoce = screen.getByRole('tab', { name: /Aguardando seu retorno/ })
    expect(abaVoce).toHaveAttribute('data-state', 'active')
    expect(abaVoce).toHaveTextContent('2')
    expect(screen.getByRole('tab', { name: /Aguardando suporte/ })).toHaveTextContent('1')
    expect(screen.getByRole('tab', { name: /^Resolvidos/ })).toHaveTextContent('0')
  })

  it('trocar de aba pede o recorte certo ao servidor e mostra o vazio com nome', async () => {
    montar()
    await screen.findByText('Boleto errado')
    fireEvent.mouseDown(screen.getByRole('tab', { name: /Aguardando suporte/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Aguardando suporte/ }))
    expect(await screen.findByText('Dúvida de integração')).toBeInTheDocument()
    expect(urls.some((u) => u.includes('status=new') && u.includes('limit=10'))).toBe(true)

    fireEvent.mouseDown(screen.getByRole('tab', { name: /^Fechados/ }))
    fireEvent.click(screen.getByRole('tab', { name: /^Fechados/ }))
    expect(await screen.findByText('Nenhum ticket fechado')).toBeInTheDocument()
    expect(urls.some((u) => u.includes('resolucao=fechado'))).toBe(true)
  })

  it('a busca vai para a URL e para a consulta (com folga de digitação)', async () => {
    montar()
    await screen.findByText('Boleto errado')
    fireEvent.change(screen.getByLabelText('Buscar tickets'), { target: { value: 'boleto' } })
    await waitFor(() => expect(urls.some((u) => u.includes('q=boleto'))).toBe(true))
    expect(await screen.findByText(/para/)).toHaveTextContent('“boleto”')
  })

  it('filtro de prioridade e ordenação entram na consulta', async () => {
    montar()
    await screen.findByText('Boleto errado')
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'urgent' } })
    await waitFor(() => expect(urls.some((u) => u.includes('priority=urgent'))).toBe(true))
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: '-urgencia' } })
    await waitFor(() => expect(urls.some((u) => u.includes('ordering=-urgencia'))).toBe(true))
  })
})
