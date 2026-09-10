/**
 * Tipos da listagem de tickets, recortados do schema `TicketList` do
 * edesk-openapi.yaml (conferidos campo a campo, não de memória). Troque pelos
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
  priority?: Prioridade
  ordering?: string // ex.: '-criado'
  limit: number
  offset: number
}
