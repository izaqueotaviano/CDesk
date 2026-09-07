import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PaginaRelatorios } from './PaginaRelatorios'

let chamadas: { url: string; search: string; metodo: string; corpo: unknown }[]
let exportacoes: Record<string, unknown>[]

const CELULA_VAZIA = { value: 0, variation: null }

const INDICADORES = {
  period: {
    key: 'month', label: 'Este mês', start: '2026-09-01T00:00:00Z', end: '2026-09-06T00:00:00Z',
    previous_start: '2026-08-01T00:00:00Z', previous_end: '2026-08-06T00:00:00Z',
  },
  periods: [
    { key: 'today', label: 'Hoje' },
    { key: 'week', label: 'Esta semana' },
    { key: 'month', label: 'Este mês' },
  ],
  summaries: [
    { key: 'opened', label: 'Resumo de tickets abertos', rows: [{ key: 'total', label: 'Total', cells: { today: CELULA_VAZIA, week: CELULA_VAZIA, month: { value: 555, variation: 10 } } }] },
    { key: 'pending', label: 'Resumo de tickets pendentes', rows: [{ key: 'total', label: 'Total', cells: { month: CELULA_VAZIA } }] },
    { key: 'resolved', label: 'Resumo de tickets resolvidos', rows: [{ key: 'total', label: 'Total', cells: { month: CELULA_VAZIA } }] },
  ],
  kpis: [
    { key: 'opened', label: 'Tickets abertos', description: 'Total de tickets abertos no período.', unit: 'count', direction: null, value: 20, variation: 10 },
    { key: 'resolved', label: 'Tickets resolvidos', description: 'Fechados no período.', unit: 'count', direction: 'up', value: 15, variation: 5 },
    { key: 'resolved_on_time', label: 'Tickets resolvidos no prazo', description: 'Antes do vencimento do SLA.', unit: 'count', direction: 'up', value: 12, variation: null },
    { key: 'first_response', label: 'Tempo médio de primeira resposta', description: 'Da abertura à primeira resposta.', unit: 'seconds', direction: 'down', value: 1800, variation: -20 },
    { key: 'resolution', label: 'Tempo médio de resolução', description: 'Da abertura ao fechamento.', unit: 'seconds', direction: 'down', value: 7200, variation: 30 },
    { key: 'csat', label: 'Nota média de satisfação', description: 'Média das respostas (0 a 10).', unit: 'score', direction: 'up', value: 8.6, variation: null },
  ],
  by_requester: [{ label: 'Ana', value: 4 }],
  by_company: [{ label: 'Empresa X', value: 5 }],
  by_category: [{ label: 'Não informada', value: 3 }],
  resolved_by_agent: [{ label: 'Bruno', value: 6 }],
  by_priority: [{ label: 'Normal', value: 10 }],
  by_status: [{ label: 'Fechado', value: 15 }],
  first_response: [{ key: 'on_time', label: 'No prazo', value: 8 }],
  resolution: [{ key: 'on_time', label: 'No prazo', value: 12 }],
  agent_list: [
    { label: 'Bruno', value: 6, variation: 20, teams: [{ name: 'Suporte', value: 6 }], on_time_rate: 0.9, first_response_seconds: 600, score: 9 },
    { label: 'Total', value: 6, variation: 20, is_total: true, teams: [], on_time_rate: 0.9, first_response_seconds: 600, score: 9 },
  ],
  timeline: [
    { date: '2026-09-01', opened: 2, resolved: 1, resolved_on_time: 1, reopened: 0 },
    { date: '2026-09-02', opened: 1, resolved: 2, resolved_on_time: 2, reopened: 1 },
  ],
  satisfaction: {
    resolved: 15, answers: 6, average: 8.6,
    distribution: Array.from({ length: 11 }, (_, score) => ({ score, count: score === 9 ? 6 : 0, percent: score === 9 ? 100 : 0 })),
  },
}

const RELATORIO_TICKETS = {
  summary: {
    total: 20, closed: 15, reopened_tickets: 1, reopen_events: 1,
    avg_first_response_seconds: 1800, avg_resolution_seconds: 7200, avg_cycle_seconds: 9000,
    avg_waiting_agent_seconds: 300, avg_waiting_customer_seconds: 600,
    by_source: {}, by_status: {},
  },
  rows: [{}, {}],
}

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  exportacoes = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, search: u.search, metodo, corpo })
      if (u.pathname === '/api/v1/reports/indicators/') return Promise.resolve(jsonDe(INDICADORES))
      if (u.pathname === '/api/v1/reports/tickets/') return Promise.resolve(jsonDe(RELATORIO_TICKETS))
      if (u.pathname === '/api/v1/teams/') return Promise.resolve(jsonDe([{ id: 1, name: 'Suporte', slug: 'suporte', visibility: 'public', order: 0 }]))
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([{ id: 9, full_name: 'Bruno', email: 'b@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'online' }]))
      if (u.pathname === '/api/v1/companies/') return Promise.resolve(jsonDe([{ id: 3, name: 'Empresa X', slug: 'empresa-x', plan_name: 'Pro', is_active: true }]))
      if (u.pathname === '/api/v1/chat/reports/') return Promise.resolve(jsonDe([{ rotulo: 'Acme', total: 3 }]))
      if (u.pathname === '/api/v1/reports/exports/' && metodo === 'GET') return Promise.resolve(jsonDe({ count: exportacoes.length, next: null, previous: null, results: exportacoes }))
      if (u.pathname === '/api/v1/reports/exports/' && metodo === 'POST') {
        const nova = { id: exportacoes.length + 1, report_key: 'tickets', format: corpo.format, status: 'pending', params: corpo.params, row_count: null, error: '', created_at: '2026-09-06T00:00:00Z', expires_at: null, download_url: null }
        exportacoes = [nova, ...exportacoes]
        return Promise.resolve(jsonDe(nova, 201))
      }
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
        <PaginaRelatorios />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('PaginaRelatorios', () => {
  it('mostra os KPIs do período (mês, padrão)', async () => {
    montar()
    const cardAbertos = await screen.findByTitle('Total de tickets abertos no período.')
    expect(within(cardAbertos).getByText('Tickets abertos')).toBeInTheDocument()
    expect(within(cardAbertos).getByText('20')).toBeInTheDocument()
    expect(within(cardAbertos).getByText('+10%')).toBeInTheDocument()
  })

  it('trocar o período refaz a chamada com o novo period=', async () => {
    montar()
    await screen.findByTitle('Total de tickets abertos no período.')
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/indicators/' && c.search.includes('period=today'))).toBe(true))
  })

  it('trocar a equipe manda team= na chamada de indicadores', async () => {
    montar()
    await screen.findByTitle('Total de tickets abertos no período.')
    // "Relatório detalhado" também tem um Select "Equipe" — mesmo caso do
    // "Agente" mais abaixo: escopar pelo tabpanel ativo evita a ambiguidade.
    const painelAtivo = screen.getByRole('tabpanel')
    fireEvent.change(within(painelAtivo).getByLabelText('Equipe'), { target: { value: '1' } })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/indicators/' && c.search.includes('team=1'))).toBe(true))
  })

  it('aba "Relatório detalhado" mostra o resumo do recorte e o link de CSV', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Relatório detalhado' }))
    expect(await screen.findByText('Tickets no recorte')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Baixar CSV/ })
    expect(link.getAttribute('href')).toContain('/api/v1/reports/tickets/export/')
  })

  it('filtrar por agente no relatório detalhado manda agent= na chamada', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Relatório detalhado' }))
    await screen.findByText('Tickets no recorte')
    // a aba "Chats" também tem um Select "Agente" — só fica fora da consulta
    // porque o painel dela está `hidden` (não é a aba ativa), então
    // `getByRole` já filtra por padrão; `getByLabelText` não filtra hidden,
    // por isso o escopo em `within(tabpanel ativo)` aqui.
    const painelAtivo = screen.getByRole('tabpanel')
    fireEvent.change(within(painelAtivo).getByLabelText('Agente'), { target: { value: '9' } })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/tickets/' && c.search.includes('agent=9'))).toBe(true))

    const link = await screen.findByRole('link', { name: /Baixar CSV/ })
    expect(link.getAttribute('href')).toContain('agent=9')
  })

  it('filtrar por equipe no relatório detalhado manda team= na chamada e no link de CSV', async () => {
    // achado original: a exportação ignorava o filtro de equipe do painel e
    // baixava tudo que o usuário enxerga — este teste cobre o filtro
    // aplicado direto na tela de exportação (mesmo objeto de filtros).
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Relatório detalhado' }))
    await screen.findByText('Tickets no recorte')
    const painelAtivo = screen.getByRole('tabpanel')
    fireEvent.change(within(painelAtivo).getByLabelText('Equipe'), { target: { value: '1' } })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/tickets/' && c.search.includes('team=1'))).toBe(true))

    const link = await screen.findByRole('link', { name: /Baixar CSV/ })
    expect(link.getAttribute('href')).toContain('team=1')
  })

  it('aba "Desempenho do chat" existe e consome ChatReportView', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Desempenho do chat' }))
    expect(await screen.findByRole('cell', { name: 'Acme' })).toBeInTheDocument()
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/reports/' && c.search.includes('by=company'))).toBe(true))
  })

  it('gerar exportação em XLSX manda o POST certo e aparece "Na fila" na lista', async () => {
    montar()
    fireEvent.click(await screen.findByRole('tab', { name: 'Relatório detalhado' }))
    await screen.findByText('Tickets no recorte')

    fireEvent.click(screen.getByRole('button', { name: 'Gerar Excel (XLSX)' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/exports/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.url === '/api/v1/reports/exports/' && c.metodo === 'POST')!.corpo).toEqual({ format: 'xlsx', params: {} })

    expect(await screen.findByText('Na fila')).toBeInTheDocument()
  })
})
