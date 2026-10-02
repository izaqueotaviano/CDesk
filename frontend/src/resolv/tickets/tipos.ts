/**
 * Tipos da listagem de tickets, recortados do schema `TicketList` do
 * resolv-openapi.yaml (conferidos campo a campo, não de memória). Troque pelos
 * tipos gerados (`npm run generate:api`) quando o schema.d.ts existir.
 */

export type Prioridade = 'low' | 'normal' | 'high' | 'urgent'
export type StatusTicket = 'new' | 'open' | 'pending_customer' | 'closed'
export type EstadoSla = 'none' | 'met' | 'ok' | 'at_risk' | 'breached'

export interface RelogioSla {
  due_at: string | null
  state: EstadoSla
  minutes_left: number | null
}

export interface TicketLinha {
  id: number
  reference: string
  subject: string
  status: StatusTicket
  stage_name: string
  stage_color: string
  priority: Prioridade
  source: 'web' | 'chat' | 'internal'
  requester_display: string
  company_name: string
  assignee_name: string | null
  category_name: string | null
  /** "Justificativa" no Movidesk: nota interna da última troca de status. */
  current_status_note: string | null
  sla: { first_response: RelogioSla; resolution: RelogioSla }
  first_response_at: string | null
  created_at: string
  is_restricted: boolean
}

/** Chaves de ordenação que o backend aceita (?ordering=), 1:1 com as colunas. */
export type ColunaOrdenavel =
  | 'reference'
  | 'subject'
  | 'criado'
  | 'espera'
  | 'cliente'
  | 'responsavel'
  | 'categoria'
  | 'urgencia'
  | 'status'
  | 'justificativa'
  | 'sla'

export interface ParamsListagem {
  view?: string
  q?: string
  /** Um valor ou LISTA separada por vírgula (`high,urgent`) — o backend
   *  aceita os dois desde a barra de filtros da fila. */
  priority?: Prioridade | string
  /** Mesmo filtro que alimenta os cards de SLA da Início (`useKpis`) —
   *  sozinho já implica "não resolvido" (um ticket fechado não tem relógio
   *  de SLA vivo), por isso não precisa combinar com `view=`. */
  sla?: 'at_risk' | 'breached' | string
  /** Filtros da barra da fila (resolv/tickets/filtros.ts) — mesmas chaves
   *  de `_aplicar_filtros` em apps/tickets/views.py. */
  status?: string
  assignee?: string
  team?: string
  company?: string
  category?: string
  tag?: string
  periodo?: string
  desde?: string
  ate?: string
  /** id do solicitante (`?solicitante=` na URL da fila). */
  requester?: string
  ordering?: string // ex.: '-criado'
  limit: number
  offset: number
}

/** Uma opção de faceta de `GET /tickets/facets/` — `value` é exatamente o
 *  que o filtro correspondente aceita (slug, id ou o valor do enum). */
export interface OpcaoFaceta {
  value: string | number | null
  label: string
  count: number
}

/** Resposta de `GET /tickets/facets/` (apps/tickets/views.py, `facets` +
 *  `_facetas_da_fila`), conferida chave a chave. */
export interface Facetas {
  status: OpcaoFaceta[]
  priority: OpcaoFaceta[]
  company: OpcaoFaceta[]
  assignee: OpcaoFaceta[]
  team: OpcaoFaceta[]
  category: OpcaoFaceta[]
  tag: OpcaoFaceta[]
  sla: OpcaoFaceta[]
  plan: OpcaoFaceta[]
  sem_dominio: number
}

/** `GET /api/v1/ticket-views/` (apps/tickets/visoes_pessoais.py). `count` só
 *  vem na LISTA — criar/renomear devolvem sem ele. */
export interface VisaoPessoal {
  id: number
  name: string
  filters: Record<string, string>
  position: number
  count?: number
}

/** Status do quadro (`GET /settings/statuses/`) — é o que a coluna "Status"
 *  da fila mostra e o que "Mudar status" em lote escolhe. */
export interface StatusDoQuadro {
  id: number
  name: string
  category: StatusTicket
  color: string
  order: number
  is_active: boolean
}

/**
 * Resposta de `GET /api/v1/tickets/resumo/` (apps/tickets/views.py, action
 * `resumo`) — conferida chave a chave no `Response(...)` de lá, não de
 * memória. A fila usa só `visoes` e `nao_atribuidos`; o resto do payload
 * fica declarado porque é o mesmo contrato e quem for ligar a Visão geral
 * não precisa redescobri-lo.
 */
export interface ResumoFila {
  /** Contagem de CADA visão salva, pela chave de `?view=` (SAVED_VIEWS). */
  visoes: Record<string, number>
  abertos: { total: number; hoje: number; variacao_dia: number }
  /** `espera_mais_longa_min` é nulo quando não há ninguém na fila — nulo, e
   *  não zero, que leria como "chegou agora" (test_visao_geral.py). */
  nao_atribuidos: { total: number; espera_mais_longa_min: number | null }
  sla_em_risco: {
    total: number
    estouram_em_1h: number
    por_plano: { plan: string; label: string; count: number }[]
  }
  meus: { total: number; aguardando_voce: number }
  resolvidos_hoje: { total: number; media_resolucao_min: number | null }
}
