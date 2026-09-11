import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaAvisos } from './PaginaAvisos'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['announcement.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: [] }

const AVISO = {
  id: 7, title: 'Manutenção', body: 'Sistema fora do ar sábado.', kind: 'info',
  starts_at: '2026-09-01T00:00:00Z', ends_at: null, is_pinned: false, is_active: true,
  audience_kind: 'all_internal', target_roles: [], target_teams: [], target_companies: [], target_plans: [],
  created_by_name: 'Alice', dismissed: false, created_at: '2026-09-01T00:00:00Z',
}

let me: Record<string, unknown>
let chamadas: { url: string; metodo: string; corpo: unknown; busca: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  chamadas = []
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo, busca: u.search })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/teams/') return Promise.resolve(jsonDe([]))
      if (u.pathname === '/api/v1/settings/companies/') return Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [] }))
      if (u.pathname === '/api/v1/settings/plans/') return Promise.resolve(jsonDe([]))
      if (u.pathname === '/api/v1/announcements/' && metodo === 'GET') {
        return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [AVISO] }))
      }
      if (u.pathname === '/api/v1/announcements/' && metodo === 'POST') return Promise.resolve(jsonDe({ ...AVISO, id: 8, ...corpo }, 201))
      if (u.pathname === '/api/v1/announcements/7/' && metodo === 'PATCH') return Promise.resolve(jsonDe({ ...AVISO, ...corpo }))
      if (u.pathname === '/api/v1/announcements/7/' && metodo === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PaginaAvisos />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('PaginaAvisos', () => {
  it('lista os avisos existentes', async () => {
    montar()
    expect(await screen.findByText('Manutenção')).toBeInTheDocument()
    expect(screen.getByText('No ar')).toBeInTheDocument()
  })

  it('quem tem announcement.manage vê "Novo aviso" e publica um', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Novo aviso' }))
    const modal = await screen.findByRole('dialog')
    fireEvent.change(within(modal).getByLabelText('Título'), { target: { value: 'Aviso novo' } })
    fireEvent.change(within(modal).getByLabelText('Texto'), { target: { value: 'Corpo do aviso' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Publicar aviso' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/announcements/' && c.metodo === 'POST')).toBe(true))
    const post = chamadas.find((c) => c.url === '/api/v1/announcements/' && c.metodo === 'POST')!
    expect(post.corpo).toMatchObject({ title: 'Aviso novo', body: 'Corpo do aviso', audience_kind: 'all_internal' })
  })

  it('editar abre o modal pré-preenchido e salva com PATCH', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const modal = await screen.findByRole('dialog')
    expect(within(modal).getByLabelText('Título')).toHaveValue('Manutenção')

    fireEvent.change(within(modal).getByLabelText('Título'), { target: { value: 'Manutenção adiada' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/announcements/7/' && c.metodo === 'PATCH')).toBe(true))
    expect(chamadas.find((c) => c.metodo === 'PATCH')!.corpo).toMatchObject({ title: 'Manutenção adiada' })
  })

  it('desativar pede confirmação e chama DELETE', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/announcements/7/' && c.metodo === 'DELETE')).toBe(true))
  })

  it('mostrar histórico manda ?history=1', async () => {
    montar()
    await screen.findByText('Manutenção')
    fireEvent.click(screen.getByLabelText('Mostrar avisos desativados e expirados'))
    await waitFor(() =>
      expect(
        chamadas.some((c) => c.url === '/api/v1/announcements/' && c.metodo === 'GET' && c.busca.includes('history=1')),
      ).toBe(true),
    )
  })

  it('quem não tem announcement.manage não vê nem "Novo aviso" nem ações de linha', async () => {
    me = AGENTE
    montar()
    await screen.findByText('Manutenção')
    expect(screen.queryByRole('button', { name: 'Novo aviso' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument()
  })
})
