import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaListaEmpresas } from './PaginaListaEmpresas'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: ['panel.access'] }

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

const PLANO = { id: 1, slug: 'gold', name: 'Gold', is_active: true, rank: 10 }

let me: Record<string, unknown>
let chamadas: URL[]
let escritas: { url: string; metodo: string; corpo: Record<string, unknown> | undefined }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  chamadas = []
  escritas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push(u)
      if (metodo !== 'GET') {
        escritas.push({
          url: u.pathname,
          metodo,
          corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
      }
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/settings/plans/') return Promise.resolve(jsonDe([PLANO]))
      if (u.pathname === '/api/v1/settings/companies/1/') return Promise.resolve(jsonDe(EMPRESA))
      if (u.pathname === '/api/v1/settings/companies/') {
        return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [EMPRESA] }))
      }
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** Espião de rota: a navegação da lista é o comportamento, não a chamada de
 *  `navigate` — então o teste lê o endereço, não o mock do router. */
function RotaAtual() {
  return <span data-testid="rota">{useLocation().pathname}</span>
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <PaginaListaEmpresas />
          <RotaAtual />
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

describe('PaginaListaEmpresas — ações por linha', () => {
  it('a linha inteira leva ao detalhe da empresa — sem botão "Abrir" repetido', async () => {
    montar()
    await screen.findByText('Acme Ltda')

    expect(screen.queryByRole('button', { name: 'Abrir' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('cell', { name: '3' }))
    expect(screen.getByTestId('rota')).toHaveTextContent('/clientes/1')
  })

  it('o nome da empresa é um link de verdade para o detalhe (teclado e nova aba)', async () => {
    montar()
    const link = (await screen.findByText('Acme Ltda')).closest('a')

    expect(link).toHaveAttribute('href', '/clientes/1')
    fireEvent.click(link!)
    expect(screen.getByTestId('rota')).toHaveTextContent('/clientes/1')
  })

  it('"Editar" abre o modal com os dados da empresa e salva por PATCH', async () => {
    montar()
    await screen.findByText('Acme Ltda')

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    // não navegou: o clique no botão não pode escapar para a linha
    expect(screen.getByTestId('rota')).toHaveTextContent('/')
    expect(screen.getByTestId('rota')).not.toHaveTextContent('/clientes/1')

    const nome = await screen.findByLabelText('Nome')
    expect(nome).toHaveValue('Acme Ltda')
    fireEvent.change(nome, { target: { value: 'Acme Brasil' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(escritas).toHaveLength(1))
    expect(escritas[0]).toMatchObject({ url: '/api/v1/settings/companies/1/', metodo: 'PATCH' })
    expect(escritas[0].corpo).toMatchObject({ name: 'Acme Brasil' })
    // o identificador não acompanha o nome numa empresa que já existe — ele
    // está em URLs internas
    expect(escritas[0].corpo).toMatchObject({ slug: 'acme' })
  })

  it('agente sem settings.manage não vê como criar nem editar', async () => {
    me = AGENTE
    montar()
    await screen.findByText('Acme Ltda')

    expect(screen.queryByRole('button', { name: 'Nova empresa' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    // ler continua valendo: o caminho para o detalhe fica
    expect(screen.getByText('Acme Ltda').closest('a')).toHaveAttribute('href', '/clientes/1')
  })
})

describe('PaginaListaEmpresas — lista vazia', () => {
  it('com filtro, oferece limpar os filtros', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = new URL(String(url), 'http://x')
        if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ADMIN))
        if (u.pathname === '/api/v1/settings/companies/') {
          const vazio = u.searchParams.get('is_active') === 'false'
          return Promise.resolve(jsonDe({ count: vazio ? 0 : 1, next: null, previous: null, results: vazio ? [] : [EMPRESA] }))
        }
        return Promise.resolve(jsonDe([]))
      }),
    )
    montar()
    await screen.findByText('Acme Ltda')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'false' } })
    await screen.findByText('Nenhuma empresa com esse filtro')

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    expect(await screen.findByText('Acme Ltda')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toHaveValue('')
  })
})
