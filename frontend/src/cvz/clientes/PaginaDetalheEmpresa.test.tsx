import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaDetalheEmpresa } from './PaginaDetalheEmpresa'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: ['panel.access'] }

const EMPRESA = {
  id: 7,
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
  user_count: 1,
  effective_limit: null,
  effective_period: '',
  quota_usage: { used: 0, limit: null, period_start: '2026-09-01', period_end: '2026-09-30' },
  maintenance_minutes: null,
  effective_maintenance_minutes: null,
  maintenance_usage: { used_minutes: 0, limit_minutes: null, period_start: '2026-09-01', period_end: '2026-09-30' },
}

const USUARIO = {
  id: 10,
  email: 'ana@acme.test',
  full_name: 'Ana Lima',
  client_role: 'member',
  job_title: 'Compras',
  phone: '11999990000',
  phone_secondary: '',
  is_active: true,
  invite_status: 'aceito',
  last_login: null,
  last_seen_at: null,
}

let me: Record<string, unknown>
let escritas: { url: string; metodo: string; corpo: Record<string, unknown> | undefined }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  escritas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      if (metodo !== 'GET') {
        escritas.push({
          url: u.pathname,
          metodo,
          corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
      }
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/settings/plans/') return Promise.resolve(jsonDe([{ id: 1, slug: 'gold', name: 'Gold', is_active: true, rank: 10 }]))
      if (u.pathname === '/api/v1/settings/companies/7/') return Promise.resolve(jsonDe(EMPRESA))
      if (u.pathname === '/api/v1/settings/companies/7/users/') return Promise.resolve(jsonDe([USUARIO]))
      if (u.pathname === '/api/v1/settings/users/10/') return Promise.resolve(jsonDe({ ...USUARIO, ...(typeof init?.body === 'string' ? JSON.parse(init.body) : {}) }))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/clientes/7']}>
        <ToastProvider>
          <Routes>
            <Route path="/clientes/:id" element={<PaginaDetalheEmpresa />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function abrirAbaUsuarios() {
  await screen.findAllByText('Acme Ltda')
  fireEvent.click(screen.getByRole('tab', { name: /Usuários/ }))
  await screen.findByText('Ana Lima')
}

describe('PaginaDetalheEmpresa — ver e editar usuário', () => {
  it('"Ver" abre a ficha do usuário com telefone e cargo', async () => {
    montar()
    await abrirAbaUsuarios()

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    // dentro do modal: o e-mail também aparece na linha da tabela atrás dele
    const ficha = within(await screen.findByRole('dialog'))
    expect(ficha.getByText('ana@acme.test')).toBeInTheDocument()
    expect(ficha.getByText('11999990000')).toBeInTheDocument()
    expect(ficha.getByText('Compras')).toBeInTheDocument()
  })

  it('"Editar" salva o cadastro por PATCH na rota do usuário', async () => {
    montar()
    await abrirAbaUsuarios()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const nome = await screen.findByLabelText('Nome completo')
    expect(nome).toHaveValue('Ana Lima')

    fireEvent.change(nome, { target: { value: 'Ana Lima Souza' } })
    fireEvent.change(screen.getByLabelText('Telefone secundário'), { target: { value: '1133334444' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(escritas).toHaveLength(1))
    expect(escritas[0]).toMatchObject({ url: '/api/v1/settings/users/10/', metodo: 'PATCH' })
    expect(escritas[0].corpo).toMatchObject({
      full_name: 'Ana Lima Souza',
      client_role: 'member',
      phone: '11999990000',
      phone_secondary: '1133334444',
      is_active: true,
    })
  })

  it('apagar os dois telefones é barrado antes da chamada', async () => {
    montar()
    await abrirAbaUsuarios()

    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.change(await screen.findByLabelText('Telefone'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    expect(await screen.findByText('Informe ao menos um telefone.')).toBeInTheDocument()
    expect(escritas).toHaveLength(0)
  })

  it('agente sem settings.manage vê a ficha, mas não edita nada', async () => {
    me = AGENTE
    montar()
    await abrirAbaUsuarios()

    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Convidar usuário' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ver' }))
    const ficha = within(await screen.findByRole('dialog'))
    expect(ficha.getByText('ana@acme.test')).toBeInTheDocument()
    // nem no rodapé da própria ficha: ela é só leitura para quem não administra
    expect(ficha.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
  })

  it('agente não consegue alterar o cadastro da empresa', async () => {
    me = AGENTE
    montar()
    await screen.findAllByText('Acme Ltda')

    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Razão social')).toBeDisabled()
    expect(screen.getByText('Só administradores podem alterar o cadastro da empresa.')).toBeInTheDocument()
  })
})
