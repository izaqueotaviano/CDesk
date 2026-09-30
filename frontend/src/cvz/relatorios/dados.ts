import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, api, type Paginado } from '@/api/client'

/**
 * Contrato de `apps/reports/services/indicators.py::build_indicators` — uma
 * leitura, quinze widgets sobre a mesma consulta (ver docstring de
 * `IndicatorsView`). Os nomes de campo aqui são os mesmos do backend de
 * propósito: não existe uma segunda tradução para manter sincronizada.
 */
export type ChavePeriodo = 'today' | 'week' | 'month'

/** Recorte do painel: um dos atalhos, ou um intervalo livre (`from`/`to`,
 *  AAAA-MM-DD — os mesmos parâmetros do relatório detalhado). */
export type RecorteIndicadores =
  | { period: ChavePeriodo }
  | { period: 'custom'; from: string; to: string }

export interface Periodo {
  /** `custom` quando a chamada levou `from`/`to`. */
  key: ChavePeriodo | 'custom'
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
  /**
   * Valor do enum (status, prioridade, balde de SLA) — é por ela que a barra
   * ganha cor. As distribuições por nome (categoria, empresa, pessoa) não têm.
   */
  key?: string
  label: string
  value: number
}

export interface BaldeSla extends Fatia {
  key: string
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

/** Aceita o atalho solto (`'today'`) — a Início chama assim — ou o recorte
 *  completo, com intervalo livre. */
export function useIndicadores(recorteOuPeriodo: RecorteIndicadores | ChavePeriodo, teamId: number | null) {
  const recorte: RecorteIndicadores =
    typeof recorteOuPeriodo === 'string' ? { period: recorteOuPeriodo } : recorteOuPeriodo
  const q = new URLSearchParams()
  if (recorte.period === 'custom') {
    q.set('from', recorte.from)
    q.set('to', recorte.to)
  } else {
    q.set('period', recorte.period)
  }
  if (teamId) q.set('team', String(teamId))
  // Intervalo pela metade (uma data apagada no campo) não vai ao servidor —
  // a tela segura o último painel em vez de piscar um erro de validação.
  const completo = recorte.period !== 'custom' || (recorte.from !== '' && recorte.to !== '' && recorte.from <= recorte.to)
  return useQuery({
    queryKey: ['relatorios', 'indicadores', q.toString()],
    queryFn: () => api.get<Indicadores>(`/api/v1/reports/indicators/?${q.toString()}`),
    enabled: completo,
    // trocar o recorte mantém o painel anterior na tela (esmaecido) até o
    // novo chegar: sem salto de layout nem esqueleto a cada clique
    placeholderData: keepPreviousData,
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
  /** Mesmo `?team=` de `IndicatorsView` — sem ele a exportação baixava tudo
   *  que o usuário enxerga, mesmo com o painel filtrado por equipe na tela. */
  team?: string
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
  if (filtros.team) q.set('team', filtros.team)
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

// --------------------------------------------------------------------------
// Exportação assíncrona (XLSX/PDF) — ReportExportViewSet, apps/reports/tasks.py
// --------------------------------------------------------------------------

export type FormatoExportacao = 'xlsx' | 'pdf'
export type StatusExportacao = 'pending' | 'running' | 'done' | 'failed'

export interface ExportacaoRelatorio {
  id: number
  report_key: string
  format: FormatoExportacao
  status: StatusExportacao
  params: FiltrosRelatorio
  row_count: number | null
  error: string
  created_at: string
  expires_at: string | null
  /** Caminho relativo, só quando `status === 'done'` — prefixar com API_BASE_URL pra baixar. */
  download_url: string | null
}

const CHAVE_EXPORTACOES = ['relatorios', 'exportacoes']

/** Some exportação em `pending`/`running`? Continua perguntando de perto —
 *  o job roda no Celery, fora do controle desta aba. Some quando resolve. */
function temExportacaoEmAndamento(paginas: Paginado<ExportacaoRelatorio> | undefined): boolean {
  return (paginas?.results ?? []).some((e) => e.status === 'pending' || e.status === 'running')
}

export function useExportacoesRelatorio() {
  return useQuery({
    queryKey: CHAVE_EXPORTACOES,
    queryFn: () => api.get<Paginado<ExportacaoRelatorio>>('/api/v1/reports/exports/?limit=20'),
    staleTime: 5_000,
    refetchInterval: (query) => (temExportacaoEmAndamento(query.state.data) ? 3_000 : false),
  })
}

export function useCriarExportacao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { format: FormatoExportacao; params: FiltrosRelatorio }) =>
      api.post<ExportacaoRelatorio>('/api/v1/reports/exports/', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE_EXPORTACOES }),
  })
}

export function urlBaixarExportacao(downloadUrl: string): string {
  return `${API_BASE_URL}${downloadUrl}`
}

// --------------------------------------------------------------------------
// Chats atendidos por agente e ao longo do tempo —
// apps/reports/services/chat_stats.py::build_chat_stats, ChatStatsView
// --------------------------------------------------------------------------

export type Granularidade = 'hour' | 'day' | 'month' | 'year'

/**
 * `_by_agent` devolve duas formas de linha, não uma normalizada: a do
 * agente (`agent_id`+`agent_name`) e a do total (`agent_id: null`,
 * `label`+`is_total`). O union abaixo é o mesmo formato, sem inventar um
 * terceiro shape só para a SPA — `agent_id` já distingue as duas.
 */
export interface LinhaAgenteChat {
  agent_id: number
  agent_name: string
  value: number
  variation: number | null
  is_total?: false
}

export interface LinhaTotalChat {
  agent_id: null
  label: string
  value: number
  variation: number | null
  is_total: true
}

export type LinhaEstatisticaAgente = LinhaAgenteChat | LinhaTotalChat

/** Um balde da série — rótulo já formatado pela granularidade pedida (ver
 *  `_bucket_label`): "2026-09-06T14:00:00", "2026-09-06", "2026-09" ou "2026". */
export interface PontoEstatisticaChat {
  bucket: string
  count: number
}

export interface EstatisticasDeChat {
  period: { key: ChavePeriodo; label: string }
  /** Sempre TODOS os agentes com aceitação no período — `?agent=` não recorta
   *  esta lista, só a `timeline` abaixo (ver docstring de `_by_agent`). */
  by_agent: LinhaEstatisticaAgente[]
  granularity: Granularidade
  timeline: PontoEstatisticaChat[]
}

export interface FiltrosEstatisticasDeChat {
  period: ChavePeriodo
  granularity: Granularidade
  /** `null` = todos os agentes. */
  agentId: number | null
  from?: string
  to?: string
}

export function useEstatisticasDeChat(filtros: FiltrosEstatisticasDeChat) {
  const q = new URLSearchParams({ period: filtros.period, granularity: filtros.granularity })
  if (filtros.agentId) q.set('agent', String(filtros.agentId))
  if (filtros.from) q.set('from', filtros.from)
  if (filtros.to) q.set('to', filtros.to)
  return useQuery({
    queryKey: ['relatorios', 'chats', filtros.period, filtros.granularity, filtros.agentId, filtros.from, filtros.to],
    queryFn: () => api.get<EstatisticasDeChat>(`/api/v1/reports/chats/?${q.toString()}`),
    staleTime: 15_000,
  })
}

// --------------------------------------------------------------------------
// Tempo de espera/atendimento e nota do chat, por empresa|cliente|agente|nota
// — apps/chat/views.py::ChatReportView (`GET /api/v1/chat/reports/?by=`).
//
// NÃO confundir com `useEstatisticasDeChat` acima: aquele é volume (quantos
// chats cada agente atendeu), este é qualidade (quanto tempo levou, que nota
// tirou) — endpoints e apps diferentes (`apps.reports` × `apps.chat`) sobre o
// mesmo dado de chat, cada um com seu recorte.
// --------------------------------------------------------------------------

export type EixoRelatorioChat = 'company' | 'client' | 'agent' | 'score'

/**
 * Uma linha do relatório, em qualquer eixo — espelha `ChatReportRowSerializer`.
 * A maioria dos campos é opcional porque varia por eixo: `score` só tem
 * `quantidade`/`nota_resolucao`; os outros três trazem a contagem completa, e
 * só `agent` tem `nota_do_agente`. Ver docstring do serializer no backend.
 */
export interface LinhaRelatorioChat {
  rotulo: string | number | null
  total?: number
  fechados?: number
  convertidos?: number
  nao_atendidos?: number
  nota_atendimento?: number | null
  nota_resolucao?: number | null
  nota_do_agente?: number | null
  /** Minutos (não segundos) — o backend já converte, ver ChatReportView. */
  espera_media_minutos?: number | null
  atendimento_medio_minutos?: number | null
  /** Só no eixo `score`: quantas conversas receberam aquela nota. */
  quantidade?: number
}

export function useRelatorioChat(eixo: EixoRelatorioChat) {
  return useQuery({
    queryKey: ['relatorios', 'chat-relatorio', eixo],
    queryFn: () => api.get<LinhaRelatorioChat[]>(`/api/v1/chat/reports/?by=${eixo}`),
    staleTime: 15_000,
  })
}
