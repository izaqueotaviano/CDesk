import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaListaEmpresas } from './PaginaListaEmpresas'

const EMPRESA = {
  id: 1,
  name: 'Acme Ltda',
  legal_name: 'Acme Comércio Ltda',
  tax_id: null,
  slug: 'acme',
  plan: 1,
  plan_name: 'Gold',
  is_active: true,
  ticket_limit: null,
  limit_period: null,
  limit_scope: 'company',
  timezone: 'America/Sao_Paulo',
  business_calendar: null,
  account_manager: null,
  contract_started_at: null,
  contract_ended_at: null,
  notes: '',
  domains: [],
  user_count: 3,
  effective_limit: null,
  effective_period: '',
  quota_usage: { used: 0, limit: null, period_start: '2026-09-01', period_end: '2026-09-30' },
  maintenance_minutes: null,
  effective_maintenance_minutes: null,
  maintenance_usage: { used_minutes: 0, limit_minutes: null, period_start: '2026-09-01', period_end: '2026-09-30' },
}

let chamadas: URL[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push(u)
      if (u.pathname === '/api/v1/settings/companies/') {
        return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [EMPRESA] }))
      }
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
        <ToastProvider>
          <PaginaListaEmpresas />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaListaEmpresas — busca e status vão para o servidor', () => {
  it('digitar na busca manda ?q= depois do debounce, não filtra na tela', async () => {
    montar()
    await screen.findByText('Acme Ltda')

    fireEvent.change(screen.getByPlaceholderText('Buscar por nome, razão social ou domínio…'), {
      target: { value: 'acme' },
    })
    // antes do debounce estourar, nenhuma chamada nova com ?q= ainda
    expect(chamadas.some((u) => u.searchParams.get('q') === 'acme')).toBe(false)

    await waitFor(() => expect(chamadas.some((u) => u.searchParams.get('q') === 'acme')).toBe(true))
  })

  it('trocar o status manda ?is_active= para o servidor', async () => {
    montar()
    await screen.findByText('Acme Ltda')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } })
    await waitFor(() => expect(chamadas.some((u) => u.searchParams.get('is_active') === 'false')).toBe(true))
  })
})
