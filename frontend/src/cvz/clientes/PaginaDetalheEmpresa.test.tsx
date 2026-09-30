import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaDetalheEmpresa } from './PaginaDetalheEmpresa'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: ['panel.access'] }

const EMPRESA_BASE = {
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
  account_manager: 1,
  account_manager_name: 'Alice Admin',
  created_at: '2025-01-10T12:00:00Z',
  contract_started_at: '2024-03-01',
  contract_ended_at: null,
  notes: '',
  domains: ['acme.test'],
  user_count: 1,
  effective_limit: 30,
  effective_period: 'monthly',
  quota_usage: { used: 5, limit: 30, period_start: '2026-09-01', period_end: '2026-09-30' },
  maintenance_minutes: null,
  effective_maintenance_minutes: 600,
  maintenance_usage: { used_minutes: 90, limit_minutes: 600, period_start: '2026-09-01', period_end: '2026-09-30' },
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

const SLA_NENHUM = { due_at: null, state: 'none', minutes_left: null }

function ticket(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    reference: `TD-${String(id).padStart(5, '0')}`,
    subject: `Assunto ${id}`,
    status: 'open',
    stage_name: 'Aberto',
    stage_color: '#000',
    priority: 'normal',
    source: 'web',
    requester_display: 'Ana Lima',
    company_name: 'Acme Ltda',
    assignee_name: null,
    category_name: null,
    current_status_note: null,
    sla: { first_response: SLA_NENHUM, resolution: SLA_NENHUM },
    first_response_at: null,
    created_at: '2026-09-29T10:00:00Z',
    is_restricted: false,
    ...extra,
  }
}

function conversa(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'active',
    name: '',
    client_id: 10,
    client_name: 'Ana Lima',
    company_name: 'Acme Ltda',
    agent_name: 'Samuel',
    agent_id: 3,
    queued_at: '2026-09-29T10:00:00Z',
    accepted_at: '2026-09-29T10:01:00Z',
    closed_at: null,
    last_message_preview: 'O boleto não chegou',
    ...extra,
  }
}

let me: Record<string, unknown>
let empresa: typeof EMPRESA_BASE
let usuarios: unknown[]
let tickets: unknown[] | 'erro'
let conversas: unknown[]
let escritas: { url: string; metodo: string; corpo: Record<string, unknown> | undefined }[]
let pedidos: string[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const paginado = (linhas: unknown[]) => ({ count: linhas.length, next: null, previous: null, results: linhas })

beforeEach(() => {
  me = ADMIN
  empresa = { ...EMPRESA_BASE }
  usuarios = [USUARIO]
  tickets = []
  conversas = []
  escritas = []
  pedidos = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      pedidos.push(u.pathname + u.search)
      if (metodo !== 'GET') {
        escritas.push({
          url: u.pathname,
          metodo,
          corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        })
      }
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/settings/plans/') return Promise.resolve(jsonDe([{ id: 1, slug: 'gold', name: 'Gold', is_active: true, rank: 10 }]))
      if (u.pathname === '/api/v1/settings/companies/7/') return Promise.resolve(jsonDe(empresa))
      if (u.pathname === '/api/v1/settings/companies/404/') return Promise.resolve(jsonDe({ detail: 'Não encontrado.' }, 404))
      if (u.pathname === '/api/v1/settings/companies/7/users/') return Promise.resolve(jsonDe(usuarios))
      if (u.pathname === '/api/v1/settings/users/10/') return Promise.resolve(jsonDe({ ...USUARIO, ...(typeof init?.body === 'string' ? JSON.parse(init.body) : {}) }))
      if (u.pathname === '/api/v1/tickets/') {
        if (tickets === 'erro') return Promise.resolve(jsonDe({ detail: 'Falhou.' }, 500))
        return Promise.resolve(jsonDe(paginado(tickets)))
      }
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe(paginado(conversas)))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function Endereco() {
  const l = useLocation()
  return <p data-testid="endereco">{l.pathname + l.search}</p>
}

function montar(inicial = '/clientes/7') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[inicial]}>
        <ToastProvider>
          <Routes>
            <Route path="/clientes/:id" element={<PaginaDetalheEmpresa />} />
            <Route path="*" element={<p>outra tela</p>} />
          </Routes>
          <Endereco />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const endereco = () => screen.getByTestId('endereco').textContent

async function abrirAba(nome: RegExp | string) {
  await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
  fireEvent.click(screen.getByRole('tab', { name: nome }))
}

async function abrirAbaUsuarios() {
  await abrirAba(/Usuários/)
  await screen.findAllByText('Ana Lima')
}

describe('PaginaDetalheEmpresa — cabeçalho', () => {
  it('mostra estado, plano e os fatos da conta (usuários no lugar do cartão solto)', async () => {
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })

    expect(screen.getByText('Ativa', { selector: '.tag' })).toBeInTheDocument()
    expect(screen.getByText('Plano Gold')).toBeInTheDocument()
    const fatos = screen.getByText('Usuários', { selector: 'dt' }).closest('dl') as HTMLElement
    expect(within(fatos).getByText('1')).toBeInTheDocument()
    expect(within(fatos).getByText('março de 2024')).toBeInTheDocument()
    expect(within(fatos).getByText('Alice Admin')).toBeInTheDocument()
    expect(within(fatos).getByText('acme.test')).toBeInTheDocument()
  })

  it('sem gerente de conta, o fato não aparece', async () => {
    empresa = { ...EMPRESA_BASE, account_manager: null as unknown as number, account_manager_name: null as unknown as string }
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
    expect(screen.queryByText('Gerente de conta')).not.toBeInTheDocument()
  })

  it('"Novo ticket" abre o formulário com a empresa escolhida', async () => {
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
    fireEvent.click(screen.getByRole('button', { name: 'Novo ticket' }))
    expect(endereco()).toBe('/chamados/novo?empresa=7')
  })

  it('"Editar dados" leva à aba Dados e põe o foco nela', async () => {
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
    fireEvent.click(screen.getByRole('button', { name: 'Editar dados' }))

    const aba = await screen.findByRole('tab', { name: 'Dados' })
    expect(aba).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(aba).toHaveFocus())
    expect(screen.getByLabelText('Razão social')).toBeVisible()
    expect(endereco()).toBe('/clientes/7?aba=dados')
  })

  it('a aba vem da URL', async () => {
    montar('/clientes/7?aba=usuarios')
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
    expect(screen.getByRole('tab', { name: /Usuários/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('empresa que não existe mostra o motivo e o caminho de volta', async () => {
    montar('/clientes/404')
    expect(await screen.findByText('Esta empresa não existe ou saiu do cadastro')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para clientes' }))
    expect(endereco()).toBe('/clientes')
  })
})

describe('PaginaDetalheEmpresa — visão geral', () => {
  it('abre na visão geral, não no formulário', async () => {
    montar()
    await screen.findByRole('heading', { level: 1, name: 'Acme Ltda' })
    expect(screen.getByRole('tab', { name: 'Visão geral' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Razão social')).not.toBeVisible()
  })

  it('lista os tickets abertos da empresa com link, prioridade só quando alta e SLA', async () => {
    tickets = [
      ticket(1, {
        priority: 'urgent',
        assignee_name: 'Samuel',
        sla: { first_response: SLA_NENHUM, resolution: { due_at: null, state: 'breached', minutes_left: -30 } },
      }),
      ticket(2, { priority: 'normal' }),
    ]
    montar()

    const link = await screen.findByRole('link', { name: /Assunto 1/ })
    expect(link).toHaveAttribute('href', '/chamados/1')
    expect(within(link).getByText('TD-00001')).toBeInTheDocument()
    expect(within(link).getByText('Samuel')).toBeInTheDocument()
    expect(within(link).getByText('Urgente')).toBeInTheDocument()
    expect(within(link).getByText('Estourado')).toBeInTheDocument()

    const outro = screen.getByRole('link', { name: /Assunto 2/ })
    expect(within(outro).queryByText('Normal')).not.toBeInTheDocument()
    expect(within(outro).getByText('Sem responsável')).toBeInTheDocument()

    // a consulta é a da empresa, só os em aberto, o prazo mais apertado primeiro
    expect(pedidos.some((p) => p.startsWith('/api/v1/tickets/?company=7&status=new,open,pending_customer&ordering=sla'))).toBe(true)
  })

  it('"Ver todos" leva à lista de tickets filtrada pela empresa', async () => {
    montar()
    const verTodos = await screen.findByRole('link', { name: 'Ver todos os tickets' })
    expect(verTodos).toHaveAttribute('href', '/chamados?empresa=7')
  })

  it('sem ticket aberto, convida a abrir um', async () => {
    montar()
    expect(await screen.findByText('Nenhum ticket aberto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ticket' }))
    expect(endereco()).toBe('/chamados/novo?empresa=7')
  })

  it('falha nos tickets fica no bloco, com tentar de novo', async () => {
    tickets = 'erro'
    montar()
    expect(await screen.findByText('Não foi possível carregar os tickets')).toBeInTheDocument()
    // o resto da página continua de pé
    expect(screen.getByText('5 de 30 tickets este mês')).toBeInTheDocument()

    tickets = [ticket(3)]
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('link', { name: /Assunto 3/ })).toBeInTheDocument()
  })

  it('conversas recentes abrem no console de chat (encerrada, nos finalizados)', async () => {
    conversas = [conversa(21), conversa(22, { status: 'closed', closed_at: '2026-09-28T10:00:00Z' })]
    montar()

    const viva = await screen.findByRole('link', { name: /O boleto não chegou.*Em atendimento/ })
    expect(viva).toHaveAttribute('href', '/chat?chat=21')
    const encerrada = screen.getByRole('link', { name: /Encerrada/ })
    expect(encerrada).toHaveAttribute('href', '/chat?aba=finalizados&chat=22')
    expect(pedidos.some((p) => p.startsWith('/api/v1/chat/chats/?company=7'))).toBe(true)
  })

  it('sem conversa: admin é convidado a configurar o chat embutido', async () => {
    montar()
    expect(await screen.findByText('Nenhuma conversa ainda')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Configurar chat embutido' }))
    expect(screen.getByRole('tab', { name: 'Chat embutido' })).toHaveAttribute('aria-selected', 'true')
  })

  it('consumo com rótulo em texto e barra neutra abaixo de 80%', async () => {
    montar()
    await screen.findByText('5 de 30 tickets este mês')
    expect(screen.getByText('1h 30min de 10h este mês')).toBeInTheDocument()
    const cota = screen.getByRole('meter', { name: 'Tickets' })
    expect(cota.closest('.empresa-uso')).toHaveClass('empresa-uso--neutro')
    expect(screen.queryByText('Perto do limite')).not.toBeInTheDocument()
  })

  it('consumo perto do limite avisa', async () => {
    empresa = { ...EMPRESA_BASE, quota_usage: { ...EMPRESA_BASE.quota_usage, used: 27 } }
    montar()
    expect(await screen.findByText('Perto do limite')).toBeInTheDocument()
  })

  it('contatos: clicar abre a ficha; "Ver todos" vai para a aba Usuários', async () => {
    montar()
    const contato = await screen.findByRole('button', { name: /Ana Lima/ })
    expect(within(contato).getByText('Nunca acessou')).toBeInTheDocument()
    fireEvent.click(contato)
    const ficha = within(await screen.findByRole('dialog'))
    expect(ficha.getByText('ana@acme.test')).toBeInTheDocument()
    fireEvent.click(ficha.getAllByRole('button', { name: /Fechar|Cancelar/ })[0])

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os usuários' }))
    expect(screen.getByRole('tab', { name: /Usuários/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('sem usuário, admin é convidado a convidar', async () => {
    usuarios = []
    montar()
    expect(await screen.findByText('Nenhum usuário ainda')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Convidar usuário' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})

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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar alterações' }))

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
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Salvar alterações' }))

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
})

describe('PaginaDetalheEmpresa — aba Dados', () => {
  it('admin salva o cadastro por PATCH na empresa', async () => {
    montar()
    await abrirAba('Dados')

    fireEvent.change(screen.getByLabelText('Razão social'), { target: { value: 'Acme Serviços Ltda' } })
    fireEvent.change(screen.getByLabelText('Novo domínio'), { target: { value: 'Acme.com.br' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar domínio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(escritas).toHaveLength(1))
    expect(escritas[0]).toMatchObject({ url: '/api/v1/settings/companies/7/', metodo: 'PATCH' })
    expect(escritas[0].corpo).toMatchObject({
      legal_name: 'Acme Serviços Ltda',
      domains: ['acme.test', 'acme.com.br'],
      tax_id: null,
      limit_period: null,
    })
  })

  it('agente não consegue alterar o cadastro da empresa', async () => {
    me = AGENTE
    montar()
    await abrirAba('Dados')

    expect(screen.queryByRole('button', { name: 'Editar dados' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Razão social')).toBeDisabled()
    expect(screen.getByText('Só administradores podem alterar o cadastro da empresa.')).toBeInTheDocument()
  })
})
