import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaEquipes } from './AbaEquipes'

/**
 * Cobre o essencial da regressão: a tela "Equipes e agentes" volta a existir
 * e as ações administrativas (que só existiam no /admin/ cru) chegam ao
 * frontend. Cada teste mocka só os endpoints (`apps/accounts/admin_api.py`)
 * que o caminho testado toca — o roteador de `fetch` abaixo espelha um a um.
 */

const ME_ADMIN = {
  id: 1,
  full_name: 'Carla Admin',
  email: 'carla@x.test',
  kind: 'internal',
  is_internal: true,
  is_admin: true,
  permissions: ['settings.manage', 'panel.access'],
}

const CHOICES = {
  internal_roles: [
    { value: 'admin', label: 'Administrador' },
    { value: 'supervisor', label: 'Supervisor' },
    { value: 'agent', label: 'Agente' },
    { value: 'light_agent', label: 'Agente leve' },
  ],
  client_roles: [],
  user_kinds: [],
  permissions: [],
  ticket_scopes: [],
  role_permissions: {},
  role_default_scopes: {},
}

const ANA = {
  id: 10,
  email: 'ana@x.test',
  full_name: 'Ana Souza',
  kind: 'internal',
  internal_role: 'agent',
  client_role: null,
  company: null,
  company_name: null,
  job_title: '',
  phone: '',
  phone_secondary: '',
  is_active: true,
  last_login: null,
  last_seen_at: null,
  anonymized_at: null,
  invite_status: 'aceito',
  team_ids: [1],
  two_factor_method: 'totp',
  avatar_url: '',
  custom_role: null,
  custom_role_name: null,
  ticket_scope: 'teams',
}

const BRUNO = {
  ...ANA,
  id: 20,
  email: 'bruno@x.test',
  full_name: 'Bruno Lima',
  invite_status: 'pendente',
  team_ids: [],
  two_factor_method: '',
}

function rosterBase() {
  return {
    teams: [
      {
        id: 1,
        name: 'Suporte N1',
        slug: 'suporte-n1',
        is_active: true,
        order: 0,
        supervisor: null,
        supervisor_name: null,
        visibility: 'company_wide',
        mask_subject_for_others: true,
        internal_only: false,
        chat_calendar: null,
        notification_email: '',
        description: '',
        agent_count: 1,
        ticket_count: 5,
        agents: [ANA],
      },
    ],
    unassigned: [BRUNO],
  }
}

function historicoBase() {
  return {
    events: [
      {
        kind: 'login',
        kind_label: 'Login',
        ip: '203.0.113.5',
        browser: 'Chrome · Windows',
        created_at: '2026-09-06T12:00:00Z',
        success: true,
      },
    ],
    logins: [],
    sessions: [
      {
        key: 'sess-abc',
        browser: 'Chrome · Windows',
        ip: '203.0.113.5',
        user_agent: 'Mozilla/5.0',
        started_at: '2026-09-06T12:00:00Z',
        expires_at: '2026-09-10T12:00:00Z',
        current: false,
      },
    ],
    session_limit: 3,
  }
}

interface Chamada {
  url: string
  metodo: string
  corpo: unknown
}

let chamadas: Chamada[]
let roster: ReturnType<typeof rosterBase>
let historico: ReturnType<typeof historicoBase>

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  roster = rosterBase()
  historico = historicoBase()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })

      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME_ADMIN))
      if (u.pathname === '/api/v1/settings/teams/roster/') return Promise.resolve(jsonDe(roster))
      if (u.pathname === '/api/v1/settings/choices/') return Promise.resolve(jsonDe(CHOICES))
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([ANA, BRUNO]))
      if (u.pathname === '/api/v1/settings/calendars/') return Promise.resolve(jsonDe([]))
      if (u.pathname === '/api/v1/settings/teams/1/agents/' && metodo === 'POST') {
        const novo = { ...ANA, id: 99, full_name: (corpo as { full_name?: string })?.full_name ?? 'Novo Agente', team_ids: [1] }
        return Promise.resolve(jsonDe(novo, 201))
      }
      if (u.pathname === '/api/v1/settings/users/10/reset-password/' && metodo === 'POST') {
        return Promise.resolve(jsonDe({ password: 'S3nhaTemporaria9!' }))
      }
      if (u.pathname === '/api/v1/settings/users/10/access-history/' && metodo === 'GET') {
        return Promise.resolve(jsonDe(historico))
      }
      return Promise.resolve(jsonDe({ detail: `sem mock para ${metodo} ${u.pathname}` }, 404))
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaEquipes />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const escritas = () => chamadas.filter((c) => c.metodo !== 'GET')

describe('AbaEquipes — roster', () => {
  it('mostra cada equipe com seus agentes e o grupo Sem equipe', async () => {
    montar()

    expect(await screen.findByText('Suporte N1')).toBeInTheDocument()
    expect(screen.getByText('Ana Souza')).toBeInTheDocument()
    expect(screen.getByText('ana@x.test')).toBeInTheDocument()

    expect(screen.getByText('Sem equipe')).toBeInTheDocument()
    expect(screen.getByText('Bruno Lima')).toBeInTheDocument()
  })

  it('esconde a tela de quem não administra', async () => {
    chamadas = []
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = new URL(String(url), 'http://x')
        if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe({ ...ME_ADMIN, permissions: ['panel.access'] }))
        return Promise.resolve(jsonDe({ detail: 'não deveria chamar' }, 404))
      }),
    )
    montar()
    expect(await screen.findByText('Esta área é restrita a administradores.')).toBeInTheDocument()
  })
})

describe('AbaEquipes — adicionar agente', () => {
  it('cria um agente novo já lotado na equipe', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar agente' }))

    fireEvent.change(await screen.findByLabelText('Nome completo'), { target: { value: 'Dana Nova' } })
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'dana@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }))

    await waitFor(() => expect(escritas().some((c) => c.url === '/api/v1/settings/teams/1/agents/')).toBe(true))
    const chamada = escritas().find((c) => c.url === '/api/v1/settings/teams/1/agents/')!
    expect(chamada.corpo).toEqual({ full_name: 'Dana Nova', email: 'dana@x.test', internal_role: 'agent' })
  })
})

describe('AbaEquipes — ações do agente', () => {
  async function abrirMenu(nome: string) {
    fireEvent.click(await screen.findByRole('button', { name: `Ações para ${nome}` }))
    return screen.getByRole('menu', { name: `Ações para ${nome}` })
  }

  it('resetar senha pede confirmação e mostra a senha nova uma única vez', async () => {
    montar()
    const menu = await abrirMenu('Ana Souza')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Resetar senha' }))

    expect(await screen.findByRole('heading', { name: 'Redefinir a senha de Ana Souza?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Redefinir senha' }))

    await waitFor(() =>
      expect(escritas().some((c) => c.url === '/api/v1/settings/users/10/reset-password/')).toBe(true),
    )
    expect(await screen.findByText('S3nhaTemporaria9!')).toBeInTheDocument()
    expect(screen.getByText(/não vai aparecer de novo/)).toBeInTheDocument()

    // a confirmação já fechou — só o modal da senha continua na tela
    expect(screen.queryByRole('heading', { name: 'Redefinir a senha de Ana Souza?' })).not.toBeInTheDocument()
  })

  it('não oferece reenviar convite nem resetar senha pra quem entra só por Google', async () => {
    // Bruno não tem 2FA (`two_factor_method: ''`) — some do menu; e além
    // disso simula alguém que só entra por Google (`invite_status: ''`).
    roster.unassigned = [{ ...BRUNO, invite_status: '' }]
    montar()
    const menu = await abrirMenu('Bruno Lima')
    expect(within(menu).queryByRole('menuitem', { name: 'Reenviar convite' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Resetar senha' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Resetar verificação em duas etapas' })).not.toBeInTheDocument()
  })

  it('abre o histórico de acesso e mostra sessões vivas e atividade recente', async () => {
    montar()
    const menu = await abrirMenu('Ana Souza')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Ver histórico de acesso' }))

    expect(await screen.findByRole('heading', { name: 'Histórico de acesso — Ana Souza' })).toBeInTheDocument()
    expect(await screen.findByText('Login')).toBeInTheDocument()
    expect(screen.getAllByText('Chrome · Windows').length).toBeGreaterThan(0)
    expect(screen.getByText('Encerrar')).toBeInTheDocument()
  })

  it('desativar pede confirmação antes de chamar a API', async () => {
    montar()
    const menu = await abrirMenu('Ana Souza')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Desativar' }))

    expect(await screen.findByRole('heading', { name: 'Desativar Ana Souza?' })).toBeInTheDocument()
    expect(escritas().some((c) => c.url === '/api/v1/settings/users/10/')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    await waitFor(() =>
      expect(escritas().some((c) => c.url === '/api/v1/settings/users/10/' && c.metodo === 'DELETE')).toBe(true),
    )
  })
})
