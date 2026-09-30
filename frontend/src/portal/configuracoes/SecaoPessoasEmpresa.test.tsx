import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoPessoasEmpresa } from './SecaoPessoasEmpresa'

const DONA = ['portal.access', 'portal.ticket_create', 'portal.ticket_reply', 'portal.company_users', 'portal.company_edit']
const MEMBRO = ['portal.access', 'portal.ticket_create', 'portal.ticket_reply']

function pessoa(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    full_name: `Pessoa ${id}`,
    email: `p${id}@acme.test`,
    phone: '',
    job_title: '',
    avatar_url: '',
    client_role: 'member',
    client_role_label: 'Usuário',
    is_active: true,
    invite_status: 'aceito',
    last_access: null,
    is_me: false,
    ...extra,
  }
}

const OLGA = pessoa(1, { full_name: 'Olga Dona', client_role: 'owner', client_role_label: 'Responsável', is_me: true, last_access: '2026-09-29T10:00:00Z' })
const ANA = pessoa(2, { full_name: 'Ana Almeida' })
const NINA = pessoa(3, { full_name: 'Nina Nova', invite_status: 'pendente' })

let permissoes: string[]
let lista: ReturnType<typeof pessoa>[]
let chamadas: { url: string; metodo: string; corpo: Record<string, unknown> }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  permissoes = DONA
  lista = [OLGA, ANA, NINA]
  chamadas = []
  // o menu (Radix) mede o gatilho; o jsdom não tem ResizeObserver
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe({ id: 1, email: 'olga@acme.test', full_name: 'Olga', permissions: permissoes }))
      if (u.pathname === '/api/v1/me/company/users/' && metodo === 'GET') return Promise.resolve(jsonDe(lista))
      if (u.pathname === '/api/v1/me/company/users/' && metodo === 'POST') {
        if (corpo.email === 'ana@acme.test') return Promise.resolve(jsonDe({ email: ['Esta pessoa já está na lista da empresa.'] }, 400))
        return Promise.resolve(jsonDe(pessoa(9, { ...corpo, invite_status: 'pendente' }), 201))
      }
      const m = u.pathname.match(/^\/api\/v1\/me\/company\/users\/(\d+)\/$/)
      if (m && metodo === 'PATCH') {
        const alvo = lista.find((p) => p.id === Number(m[1]))!
        const novo = { ...alvo, ...corpo }
        lista = lista.map((p) => (p.id === novo.id ? novo : p))
        return Promise.resolve(jsonDe(novo))
      }
      if (u.pathname.endsWith('/invite/')) return Promise.resolve(jsonDe({ invited: 'x' }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SecaoPessoasEmpresa />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Radix abre o menu por teclado no jsdom (o clique depende de pointer events). */
function abrirMenuDe(nome: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: `Ações para ${nome}` }), { key: 'Enter' })
  return screen.findByRole('menu')
}

describe('SecaoPessoasEmpresa', () => {
  it('não aparece para quem não é responsável (e nem busca a lista)', async () => {
    permissoes = MEMBRO
    const { container } = montar()
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/')).toBe(true))
    expect(container).toBeEmptyDOMElement()
    expect(chamadas.some((c) => c.url === '/api/v1/me/company/users/')).toBe(false)
  })

  it('lista papel, convite pendente e último acesso', async () => {
    montar()
    expect(await screen.findByText('Ana Almeida')).toBeInTheDocument()
    expect(screen.getByText('(você)')).toBeInTheDocument()
    expect(screen.getByText('Responsável')).toBeInTheDocument()
    expect(screen.getByText('Convite pendente')).toBeInTheDocument()
    expect(screen.getByText('Ainda não criou a senha')).toBeInTheDocument()
    expect(screen.getByText('3 pessoas com acesso')).toBeInTheDocument()
  })

  it('só a própria pessoa: estado vazio com o convite como próximo passo', async () => {
    lista = [OLGA]
    montar()
    expect(await screen.findByText('Só você por enquanto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Convidar pessoa' })).toBeInTheDocument()
  })

  it('convida: valida na tela, mostra o erro do servidor no campo e envia o papel escolhido', async () => {
    montar()
    await screen.findByText('Ana Almeida')
    fireEvent.click(screen.getByRole('button', { name: 'Convidar pessoa' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Convidar pessoa' })

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar convite' }))
    expect(within(dialogo).getByText('Informe o nome da pessoa.')).toBeInTheDocument()
    expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false)

    fireEvent.change(within(dialogo).getByLabelText('Nome completo'), { target: { value: 'Ana de Novo' } })
    fireEvent.change(within(dialogo).getByLabelText('E-mail'), { target: { value: 'ana@acme.test' } })
    fireEvent.change(within(dialogo).getByLabelText('Telefone'), { target: { value: '11 99999-0000' } })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar convite' }))
    expect(await within(dialogo).findByText('Esta pessoa já está na lista da empresa.')).toBeInTheDocument()

    fireEvent.change(within(dialogo).getByLabelText('E-mail'), { target: { value: 'rui@acme.test' } })
    fireEvent.click(within(dialogo).getByRole('radio', { name: /Responsável/ }))
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Enviar convite' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(chamadas.filter((c) => c.metodo === 'POST').at(-1)!.corpo).toEqual({
      full_name: 'Ana de Novo',
      email: 'rui@acme.test',
      phone: '11 99999-0000',
      job_title: '',
      client_role: 'owner',
    })
  })

  it('desativar pede confirmação e só então chama o servidor', async () => {
    montar()
    await screen.findByText('Ana Almeida')
    const menu = await abrirMenuDe('Ana Almeida')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Desativar acesso/ }))

    const confirmacao = await screen.findByRole('dialog', { name: 'Desativar o acesso de Ana Almeida?' })
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false)
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Desativar acesso' }))
    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'PATCH')?.corpo).toEqual({ is_active: false }))
    expect(chamadas.find((c) => c.metodo === 'PATCH')?.url).toBe('/api/v1/me/company/users/2/')
    expect(await screen.findByText('Acesso desativado')).toBeInTheDocument()
  })

  it('a própria conta não tem "desativar", e o único responsável não pode deixar de ser', async () => {
    montar()
    await screen.findByText('Ana Almeida')
    const menu = await abrirMenuDe('Olga Dona')
    expect(within(menu).queryByRole('menuitem', { name: /Desativar/ })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Tornar usuário/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('reenviar convite só aparece para quem ainda não criou a senha', async () => {
    montar()
    await screen.findByText('Nina Nova')
    let menu = await abrirMenuDe('Ana Almeida')
    expect(within(menu).queryByRole('menuitem', { name: /Reenviar convite/ })).not.toBeInTheDocument()
    fireEvent.keyDown(menu, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    menu = await abrirMenuDe('Nina Nova')
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Reenviar convite/ }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/me/company/users/3/invite/')).toBe(true))
  })
})
