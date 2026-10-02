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

const CANDIDATO_PII = {
  model: 'ticket', pk: 55, field: 'subject', reference: 'CVZ-2026-000055', pattern: 'cpf',
}

const ACESSO = {
  id: 1, ticket: 128, ticket_reference: 'CVZ-2026-000128', team: 'Financeiro', user: 9, user_name: 'Bruno',
  was_granted: false, context: 'detail', ip_address: '203.0.113.9', created_at: '2026-09-02T00:00:00Z',
}

const CICLO_SIMULACAO = {
  id: 3, dry_run: true, status: 'done', results: { audit_log: { matched: 12, applied: 0, sample: ['1', '2'] } },
  error: '', finished_at: '2026-09-01T00:05:00Z', triggered_by: 1, triggered_by_name: 'Alice',
  total_matched: 12, total_applied: 0, reviewed_by: null, reviewed_by_name: null, reviewed_at: null,
  review_note: '', is_reviewed: false, created_at: '2026-09-01T00:00:00Z',
}

let me: Record<string, unknown>
let chamadas: { url: string; metodo: string; corpo: unknown }[]
// muda para [] após um redact bem-sucedido — simula o candidato sumindo da
// varredura seguinte porque o texto redigido não bate mais no padrão de PII.
let candidatosPii: (typeof CANDIDATO_PII)[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  chamadas = []
  candidatosPii = [CANDIDATO_PII]
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
      if (u.pathname === '/api/v1/audit/lgpd/7/redaction_candidates/' && metodo === 'GET') return Promise.resolve(jsonDe({ candidates: candidatosPii }))
      if (u.pathname === '/api/v1/audit/lgpd/7/redact/' && metodo === 'POST') {
        candidatosPii = []
        return Promise.resolve(jsonDe({ redacted: true }))
      }
      if (u.pathname === '/api/v1/audit/ticket-access/') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [ACESSO] }))
      if (u.pathname === '/api/v1/audit/retention/' && metodo === 'GET') return Promise.resolve(jsonDe({ count: 1, next: null, previous: null, results: [CICLO_SIMULACAO] }))
      if (u.pathname === '/api/v1/audit/retention/simulate/') return Promise.resolve(jsonDe({ ...CICLO_SIMULACAO, id: 4 }, 201))
      if (u.pathname === '/api/v1/audit/retention/3/review/') return Promise.resolve(jsonDe({ ...CICLO_SIMULACAO, is_reviewed: true, reviewed_by_name: 'Alice' }))
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

  it('executar anonimização passa pela revisão de PII antes de disparar a execução', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Pedidos LGPD' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Executar' }))

    // a revisão busca os candidatos e mostra o que seria redigido — modelo,
    // referência do ticket e o tipo de PII, sem executar nada ainda
    const revisao = await screen.findByRole('dialog', { name: 'Revisar antes de anonimizar' })
    expect(await within(revisao).findByText('CPF')).toBeInTheDocument()
    expect(revisao.textContent).toContain('CVZ-2026-000055')
    expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/execute/')).toBe(false)

    fireEvent.click(within(revisao).getByRole('button', { name: 'Prosseguir para execução' }))
    const confirmacao = await screen.findByRole('dialog', { name: 'Confirmar anonimização' })
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Executar agora' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/execute/' && c.metodo === 'POST')).toBe(true))
  })

  it('redigir um candidato na revisão chama o endpoint de redação com o alvo certo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Pedidos LGPD' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Executar' }))

    const revisao = await screen.findByRole('dialog', { name: 'Revisar antes de anonimizar' })
    fireEvent.click(await within(revisao).findByRole('button', { name: 'Redigir' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/lgpd/7/redact/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/audit/lgpd/7/redact/')!.corpo).toEqual({ model: 'ticket', pk: 55 })

    // o candidato redigido some da varredura seguinte (invalidação da query)
    expect(await within(revisao).findByText('Nenhum candidato encontrado em texto livre.')).toBeInTheDocument()
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

  it('aba "Acessos restritos" lista inclusive tentativa negada', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Acessos restritos' }))
    expect(await screen.findByText('CVZ-2026-000128')).toBeInTheDocument()
    expect(screen.getByText('Negado')).toBeInTheDocument()
  })

  it('aba "Retenção" roda simulação e revisa um ciclo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Retenção' }))
    expect(await screen.findByText('Simulação')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Rodar simulação agora' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/retention/simulate/' && c.metodo === 'POST')).toBe(true))

    fireEvent.click(screen.getByRole('button', { name: 'Revisar' }))
    const modal = await screen.findByRole('dialog')
    fireEvent.click(within(modal).getByRole('button', { name: 'Marcar como revisado' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/audit/retention/3/review/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/audit/retention/3/review/')!.corpo).toEqual({ review_note: '' })
  })
})
