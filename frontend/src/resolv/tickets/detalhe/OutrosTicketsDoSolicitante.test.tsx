import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TicketLinha } from '../tipos'
import { OutrosTicketsDoSolicitante } from './OutrosTicketsDoSolicitante'
import type { TicketDetalhe } from './tiposDetalhe'

const get = vi.fn()
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  api: { get: (...a: unknown[]) => get(...a) },
}))

function linha(id: number, extra: Partial<TicketLinha> = {}): TicketLinha {
  return {
    id,
    reference: `T-${id}`,
    subject: `Assunto ${id}`,
    status: 'closed',
    stage_name: 'Fechado',
    stage_color: '#3e6f4e',
    priority: 'normal',
    source: 'web',
    requester_display: 'Beto Barros',
    company_name: 'Acme',
    assignee_name: null,
    category_name: null,
    current_status_note: null,
    sla: {
      first_response: { due_at: null, state: 'none', minutes_left: null },
      resolution: { due_at: null, state: 'none', minutes_left: null },
    },
    first_response_at: null,
    created_at: `2026-08-${String(10 + (id % 10)).padStart(2, '0')}T12:00:00Z`,
    is_restricted: false,
    ...extra,
  }
}

const TICKET = {
  id: 42,
  requester_display: 'Beto Barros',
  requester: { id: 7, name: 'Beto Barros', email: 'b@acme.test', ui_language: 'pt-br', timezone: null },
} as TicketDetalhe

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OutrosTicketsDoSolicitante ticket={TICKET} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  get.mockReset()
})

describe('Outros tickets do solicitante', () => {
  it('pede o recorte pelo solicitante e mostra esqueleto enquanto carrega', () => {
    get.mockReturnValue(new Promise(() => {}))
    montar()
    expect(get).toHaveBeenCalledWith('/api/v1/tickets/?requester=7&ordering=-criado&limit=6')
    expect(screen.getByRole('heading', { name: 'Outros tickets de Beto Barros' })).toBeInTheDocument()
    expect(screen.getByLabelText('Carregando outros tickets')).toHaveAttribute('aria-busy', 'true')
  })

  it('lista até 5, sem o ticket da tela, com link para cada um e para a fila filtrada', async () => {
    get.mockResolvedValue({
      count: 12,
      next: null,
      previous: null,
      results: [linha(42, { status: 'open' }), linha(1), linha(2), linha(3), linha(4), linha(5)],
    })
    montar()

    const itens = await screen.findAllByRole('link', { name: /^T-\d+/ })
    expect(itens).toHaveLength(5)
    expect(screen.queryByText('T-42')).not.toBeInTheDocument()
    expect(itens[0]).toHaveAttribute('href', '/tickets/1')
    expect(within(itens[0]!).getByText('Assunto 1')).toBeInTheDocument()
    expect(within(itens[0]!).getByText('Fechado')).toBeInTheDocument()

    const todos = screen.getByRole('link', { name: 'Ver todos os tickets de Beto Barros' })
    expect(todos).toHaveAttribute('href', '/tickets?solicitante=7')
    expect(todos).toHaveTextContent('Ver todos (11)')
  })

  it('primeiro ticket da pessoa: estado vazio, sem "Ver todos"', async () => {
    get.mockResolvedValue({ count: 1, next: null, previous: null, results: [linha(42)] })
    montar()
    expect(await screen.findByText('Este é o primeiro ticket de Beto Barros.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Ver todos/ })).not.toBeInTheDocument()
  })

  it('erro vira aviso com "Tentar de novo"', async () => {
    get.mockRejectedValue(new Error('rede'))
    montar()
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os outros tickets.')
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})
