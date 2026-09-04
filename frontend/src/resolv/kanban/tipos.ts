/**
 * Tipos do quadro, recortados do contrato real de `apps/kanban/` —
 * `GET /kanban/boards/{id}/cards/` (ver `apps/kanban/services/board_view.py`,
 * função `entries()`, que é quem monta exatamente este formato).
 */
import type { EstadoSla, RelogioSla } from '../tickets/tipos'

export type { EstadoSla, RelogioSla }

export interface Board {
  id: number
  name: string
  slug: string
  team: number | null
  team_slug: string | null
  is_active: boolean
}

export type TipoColuna = 'stage' | 'lane' | 'priority' | 'assignee'

export interface Coluna {
  key: string
  name: string
  color: string
  category: string | null
  kind: TipoColuna
  /** id do TicketStage, só quando `kind === 'stage'`. */
  stage: number | null
  /** id da BoardLane, só quando `kind === 'lane'`. */
  lane: number | null
  /** Soltar aqui fecha o chamado — exige o fluxo formal (D4), nunca fecha direto. */
  concludes: boolean
}

export interface Cartao {
  ticket: number
  ticket_reference: string
  ticket_status: 'new' | 'open' | 'pending_customer' | 'closed'
  stage: number | null
  priority: 'low' | 'normal' | 'high' | 'urgent'
  subject: string
  requester_display: string
  company_name: string
  team_name: string
  owner_id: number | null
  owner_name: string | null
  assignee_id: number | null
  assignee_name: string | null
  assignee_avatar: string | null
  sla: { first_response: RelogioSla; resolution: RelogioSla }
  column: string
  message_count: number
  attachment_count: number
  /** Prazo INTERNO do card — não é o SLA. Ver `sla` acima para o prazo contratual. */
  due_at: string | null
  is_overdue: boolean
  created_at: string
}

export interface QuadroMontado {
  columns: Coluna[]
  entries: Cartao[]
}

export type Agrupamento = 'status' | 'priority' | 'assignee'
