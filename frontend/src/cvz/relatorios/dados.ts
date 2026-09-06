import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL, api } from '@/api/client'

/**
 * Contrato de `apps/reports/services/indicators.py::build_indicators` — uma
 * leitura, quinze widgets sobre a mesma consulta (ver docstring de
 * `IndicatorsView`). Os nomes de campo aqui são os mesmos do backend de
 * propósito: não existe uma segunda tradução para manter sincronizada.
 */
export type ChavePeriodo = 'today' | 'week' | 'month'

export interface Periodo {
  key: ChavePeriodo
  label: string
  start: string
  end: string
  previous_start: string
  previous_end: string
}

/** Valor do período atual + variação percentual contra a MESMA fatia do
 *  período anterior (não o período anterior inteiro — ver indicators.py). */
export interface Celula {
  value: number | null
  variation: number | null
}

export type ChaveEscopo = 'mine' | 'team' | 'total'

export interface LinhaResumo {
  key: ChaveEscopo
  label: string
  cells: Partial<Record<ChavePeriodo, Celula>>
}

export interface TabelaResumo {
  key: 'opened' | 'pending' | 'resolved'
  label: string
  rows: LinhaResumo[]
}

export type UnidadeKpi = 'count' | 'seconds' | 'score'

export interface Kpi extends Celula {
  key: string
  label: string
  description: string
  unit: UnidadeKpi
  /** Para que lado a variação é boa — `null` é neutro (ex.: volume aberto). */
  direction: 'up' | 'down' | null
}

export interface Fatia {
  label: string
  value: number
}

export interface BaldeSla {
  key: string
  label: string
  value: number
}

export interface LinhaAgente extends Celula {
  label: string
  /** Linha "Total" ao final da lista. */
  is_total?: boolean
  teams: { name: string; value: number }[]
  /** Fração 0–1; `null` quando o agente não tem ticket com SLA definido (não é 0%). */
  on_time_rate: number | null
  first_response_seconds: number | null
  /** Nota média (0–10) das pesquisas dos tickets do agente; `null` sem pesquisa respondida. */
  score: number | null
}

export interface PontoLinhaDoTempo {
  date: string
  opened: number
  resolved: number
  resolved_on_time: number
  reopened: number
}

export interface Satisfacao {
  resolved: number
  answers: number
  average: number | null
  /** Sempre 11 posições, notas 0 a 10 — inclusive as com zero resposta. */
  distribution: { score: number; count: number; percent: number }[]
}

export interface Indicadores {
  period: Periodo
  periods: { key: ChavePeriodo; label: string }[]
  summaries: TabelaResumo[]
  kpis: Kpi[]
  by_requester: Fatia[]
  by_company: Fatia[]
  by_category: Fatia[]
  resolved_by_agent: Fatia[]
  /** Todos os valores do enum, inclusive com contagem zero — ver `_by_choice`. */
  by_priority: Fatia[]
  by_status: Fatia[]
  first_response: BaldeSla[]
  resolution: BaldeSla[]
  agent_list: LinhaAgente[]
  timeline: PontoLinhaDoTempo[]
  satisfaction: Satisfacao
}

export function useIndicadores(period: ChavePeriodo, teamId: number | null) {
  const q = new URLSearchParams({ period })
  if (teamId) q.set('team', String(teamId))
  return useQuery({
    queryKey: ['relatorios', 'indicadores', period, teamId],
    queryFn: () => api.get<Indicadores>(`/api/v1/reports/indicators/?${q.toString()}`),
    staleTime: 30_000,
  })
}

// --------------------------------------------------------------------------
// Relatório detalhado — apps/reports/services/metrics.py::build_report
// --------------------------------------------------------------------------

export interface FiltrosRelatorio {
  from?: string
  to?: string
  agent?: string
  company?: string
}

export interface ResumoRelatorio {
  total: number
  closed: number
  reopened_tickets: number
  reopen_events: number
  avg_first_response_seconds: number | null
  avg_resolution_seconds: number | null
  avg_cycle_seconds: number | null
  avg_waiting_agent_seconds: number | null
  avg_waiting_customer_seconds: number | null
  /** Chave = valor bruto do enum (`email`, `new`…) — sem tradução aqui de propósito, ver PainelDetalhado. */
  by_source: Record<string, number>
  by_status: Record<string, number>
}

export interface RelatorioTickets {
  summary: ResumoRelatorio
  /** Linha por ticket — hoje só usada para contar quantas o CSV vai ter; a
   *  listagem em si é a de tickets (mesma que /chamados), não duplicada aqui. */
  rows: unknown[]
}

function queryStringFiltros(filtros: FiltrosRelatorio): string {
  const q = new URLSearchParams()
  if (filtros.from) q.set('from', filtros.from)
  if (filtros.to) q.set('to', filtros.to)
  if (filtros.agent) q.set('agent', filtros.agent)
  if (filtros.company) q.set('company', filtros.company)
  return q.toString()
}

export function useRelatorioTickets(filtros: FiltrosRelatorio) {
  const qs = queryStringFiltros(filtros)
  return useQuery({
    queryKey: ['relatorios', 'tickets', filtros],
    queryFn: () => api.get<RelatorioTickets>(`/api/v1/reports/tickets/${qs ? `?${qs}` : ''}`),
    staleTime: 15_000,
  })
}

/** `TicketReportExportView` é download direto (CSV síncrono, sem fetch/blob) —
 *  um `<a href>` de verdade, igual ao "Baixar" de exportação LGPD. */
export function urlExportarCsv(filtros: FiltrosRelatorio): string {
  const qs = queryStringFiltros(filtros)
  return `${API_BASE_URL}/api/v1/reports/tickets/export/${qs ? `?${qs}` : ''}`
}
