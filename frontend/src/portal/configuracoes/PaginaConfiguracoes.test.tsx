import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { PaginaConfiguracoes } from './PaginaConfiguracoes'

const ME_BASE = {
  id: 4,
  email: 'ana@acme.test',
  full_name: 'Ana Almeida',
  kind: 'client',
  internal_role: '',
  client_role: 'owner',
  company: 1,
  company_name: 'Acme Marketing',
  plan_name: 'Gold',
  is_internal: false,
  is_admin: false,
  teams: [],
  presence: 'offline',
  permissions: ['portal.access', 'portal.ticket_create', 'portal.ticket_reply', 'portal.company_users', 'portal.company_edit'],
  ticket_scope: '',
  custom_role_name: '',
  avatar_url: '',
  job_title: 'Analista',
  phone: '',
  ui_density: '',
  signature: '',
}

const EMPRESA = {
  id: 1,
  name: 'Acme Marketing',
  legal_name: 'Acme Marketing Ltda',
  tax_id: '12.345.678/0001-90',
  plan_name: 'Gold',
  timezone: 'America/Sao_Paulo',
  account_manager_name: 'Gabriela',
  contract_started_at: '2025-03-01',
  members: 3,
  domains: ['acme.test'],
}

const KINDS = ['ticket_created', 'ticket_replied', 'ticket_closed', 'chat_closed', 'chat_converted', 'sla_warning']

let me: Record<string, unknown>
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = { ...ME_BASE }
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/auth/me/') {
        if (metodo === 'PATCH') {
          me = { ...me, ...corpo }
          return Promise.resolve(jsonDe(me))
        }
        return Promise.resolve(jsonDe(me))
      }
      if (u.pathname === '/api/v1/me/company/') {
        return Promise.resolve(jsonDe(metodo === 'PATCH' ? { ...EMPRESA, ...corpo } : EMPRESA))
      }
      if (u.pathname === '/api/v1/notification-preferences/') {
        const email = Object.fromEntries(KINDS.map((k) => [k, true]))
        return Promise.resolve(
          jsonDe({ in_app: email, email: { ...email, ...(corpo?.email ?? {}) }, kinds: KINDS.map((k) => ({ value: k, label: k })) }),
        )
      }
      if (u.pathname === '/api/v1/me/password/') {
        if (corpo?.current_password === 'errada') return Promise.resolve(jsonDe({ current_password: ['Senha atual incorreta.'] }, 400))
        return Promise.resolve(jsonDe({ detail: 'Senha trocada.' }))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  usePrefs.getState().setTema('sistema')
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/configuracoes']}>
        <PaginaConfiguracoes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const secao = (nome: string) => screen.getByRole('region', { name: nome })

describe('PaginaConfiguracoes', () => {
  it('dados pessoais: e-mail travado, nome editável, salvar só depois de mudar algo', async () => {
    montar()
    const nome = await screen.findByLabelText('Nome completo')
    expect(nome).toHaveValue('Ana Almeida')
    expect(screen.getByLabelText('E-mail')).toBeDisabled()
    const perfil = secao('Dados pessoais')
    const salvar = within(perfil).getByRole('button', { name: 'Salvar alterações' })
    expect(salvar).toBeDisabled()

    fireEvent.change(nome, { target: { value: 'Ana Beatriz Almeida' } })
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '(11) 99999-0000' } })
    expect(salvar).toBeEnabled()
    fireEvent.click(salvar)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/' && c.metodo === 'PATCH')).toBe(true))
    const patch = chamadas.find((c) => c.url === '/api/v1/auth/me/' && c.metodo === 'PATCH')!
    expect(patch.corpo).toEqual({ full_name: 'Ana Beatriz Almeida', job_title: 'Analista', phone: '(11) 99999-0000' })
    await waitFor(() => expect(salvar).toBeDisabled()) // voltou a "tudo salvo"
  })

  it('empresa: a ficha é só leitura e o responsável edita razão social e CNPJ', async () => {
    montar()
    expect(await screen.findByText('Gabriela')).toBeInTheDocument()
    expect(screen.getByText('3 pessoas')).toBeInTheDocument()
    const cnpj = screen.getByLabelText('CNPJ')
    expect(cnpj).toHaveValue('12.345.678/0001-90')
    fireEvent.change(cnpj, { target: { value: '11.222.333/0001-44' } })
    fireEvent.click(within(secao('Empresa')).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/me/company/' && c.metodo === 'PATCH')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/me/company/' && c.metodo === 'PATCH')!.corpo).toEqual({
      legal_name: 'Acme Marketing Ltda',
      tax_id: '11.222.333/0001-44',
    })
  })

  it('empresa: quem não é responsável lê os mesmos dados sem formulário', async () => {
    me = { ...ME_BASE, client_role: 'member', permissions: ['portal.access', 'portal.ticket_create', 'portal.ticket_reply'] }
    montar()
    expect(await screen.findByText('Acme Marketing Ltda')).toBeInTheDocument()
    expect(screen.queryByLabelText('CNPJ')).not.toBeInTheDocument()
    expect(screen.getByText('Só o responsável pela conta altera a razão social e o CNPJ.')).toBeInTheDocument()
  })

  it('notificações: um interruptor por aviso do cliente, salvando na hora só a chave tocada', async () => {
    montar()
    const chatEncerrado = await screen.findByRole('switch', { name: 'Chat encerrado' })
    expect(chatEncerrado).toHaveAttribute('aria-checked', 'true')
    // só os avisos que chegam a um cliente — SLA é coisa de agente
    expect(screen.getAllByRole('switch')).toHaveLength(5)
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument()

    fireEvent.click(chatEncerrado)
    await waitFor(() => expect(chatEncerrado).toHaveAttribute('aria-checked', 'false')) // otimista, antes da resposta
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/notification-preferences/' && c.metodo === 'PUT')).toBe(true))
    expect(chamadas.find((c) => c.metodo === 'PUT')!.corpo).toEqual({ email: { chat_closed: false } })
  })

  it('aparência: escolher "Escuro" aplica o tema na hora', async () => {
    montar()
    const escuro = await screen.findByRole('radio', { name: /Escuro/ })
    fireEvent.click(escuro)
    expect(escuro).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement.getAttribute('data-tema')).toBe('escuro')
    fireEvent.click(screen.getByRole('radio', { name: /Sistema/ }))
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false)
  })

  it('senha: as regras acendem ao digitar, o servidor recusa a atual errada e aceita a certa', async () => {
    montar()
    const atual = await screen.findByLabelText('Senha atual')
    const nova = screen.getByLabelText('Nova senha')
    const confirma = screen.getByLabelText('Confirmar nova senha')
    const botao = screen.getByRole('button', { name: 'Trocar senha' })
    expect(botao).toBeDisabled()

    fireEvent.change(atual, { target: { value: 'errada' } })
    fireEvent.change(nova, { target: { value: 'Frase longa 2026!' } })
    fireEvent.change(confirma, { target: { value: 'Frase longa 2026!' } })
    expect(botao).toBeEnabled()
    fireEvent.click(botao)
    expect(await screen.findByText('Senha atual incorreta.')).toBeInTheDocument()

    fireEvent.change(atual, { target: { value: 'resolv123' } })
    fireEvent.click(botao)
    expect(await screen.findByText('Senha trocada')).toBeInTheDocument()
    expect(screen.getByText(/outras sessões continuam abertas/)).toBeInTheDocument()
    expect(atual).toHaveValue('')
    const post = chamadas.filter((c) => c.url === '/api/v1/me/password/').at(-1)!
    expect(post.corpo).toEqual({ current_password: 'resolv123', new_password: 'Frase longa 2026!' })
  })

  it('senha parecida com o nome não passa na conferência local', async () => {
    montar()
    await screen.findByLabelText('Senha atual')
    fireEvent.change(screen.getByLabelText('Nova senha'), { target: { value: 'Almeida-2026-xx' } })
    const regra = screen.getByText('Não parecida com seu nome ou e-mail').closest('li')!
    expect(regra).toHaveClass('text-tinta-secundaria')
  })
})
