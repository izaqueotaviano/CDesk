import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaAuditoria } from './PaginaAuditoria'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: [] }

const LOG = {
  id: 1, actor: 1, actor_name: 'Alice', action: 'update', target_type: 'company', object_id: '3',
  changes: {}, summary: 'Empresa atualizada', ip_address: '203.0.113.1', created_at: '2026-09-01T00:00:00Z',
}

const PEDIDO_ANONIMIZAR = {
  id: 7, kind: 'anonymize', status: 'pending', subject_user: 4, subject_user_name: 'Ana Cliente',
  subject_company: null, subject_company_name: null, requested_by: 1, executed_by: null, executed_by_name: null,
  executed_at: null, verified_by: null, verified_at: null, verification_note: '', due_at: '2026-09-15T00:00:00Z',
  is_overdue: false, days_left: 9, has_export: false, result: {}, error: '', notes: '', rejection_reason: '',
  created_at: '2026-09-01T00:00:00Z',
}

let me: Record<string, unknown>
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/audit/logs/') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [LOG] }))
      if (u.pathname === '/api/v1/audit/lgpd/' && metodo === 'GET') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [PEDIDO_ANONIMIZAR] }))
      if (u.pathname === '/api/v1/audit/lgpd/7/verify/') return Promise.resolve(jsonDe({ ...PEDIDO_ANONIMIZAR, status: 'approved' }))
      if (u.pathname === '/api/v1/audit/lgpd/7/reject/') return Promise.resolve(jsonDe({ ...PEDIDO_ANONIMIZAR, status: 'rejected' }))
      if (u.pathname === '/api/v1/audit/lgpd/7/execute/') return Promise.resolve(jsonDe({ ...PEDIDO_ANONIMIZAR, status: 'running' }))
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
        <PaginaAuditoria />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('PaginaAuditoria', () => {
  it('não-admin vê o aviso de área restrita, não os painéis', async () => {
    me = AGENTE
    montar()
    expect(await screen.findByText('Esta área é restrita a administradores.')).toBeInTheDocument()
    expect(screen.queryByText('Log de auditoria')).not.toBeInTheDocument()
  })

  it('admin vê o log de auditoria por padrão', async () => {
    montar()
    expect(await screen.findByText('Empresa atualizada')).toBeInTheDocument()
  })

  it('aba de pedidos LGPD lista e permite verificar identidade', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Pedidos LGPD' }))
    expect(await screen.findByText('Ana Cliente')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Verificar identidade' }))
    const modal = await screen.findByRole('dialog')
    fireEvent.change(within(modal).getByLabelText('Como a identidade foi confirmada?'), { target: { value: 'Ligação confirmada' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Confirmar e aprovar' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/verify/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/audit/lgpd/7/verify/')!.corpo).toEqual({ verification_note: 'Ligação confirmada' })
  })

  it('rejeitar exige motivo e chama o endpoint certo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Pedidos LGPD' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rejeitar' }))
    const modal = await screen.findByRole('dialog')

    fireEvent.click(within(modal).getByRole('button', { name: 'Rejeitar' }))
    expect(await within(modal).findByText('Campo obrigatório.')).toBeInTheDocument()
    expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/reject/')).toBe(false)

    fireEvent.change(within(modal).getByLabelText('Motivo da negativa (obrigatório pela LGPD)'), { target: { value: 'Identidade não confirmada' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Rejeitar' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/reject/' && c.metodo === 'POST')).toBe(true))
  })
})
