/**
 * Tipos do detalhe do ticket, recortados do schema `TicketDetail` do
 * edesk-openapi.yaml (conferidos contra o serializer real). Um único
 * GET /api/v1/tickets/{id}/ já traz mensagens, eventos e seguidores embutidos.
 */
import type { EstadoSla, Prioridade, StatusTicket } from '../tipos'

export interface Anexo {
  id: number
  filename: string
  url?: string
  scan_status?: string
  is_downloadable?: boolean
}

export interface Mencao {
  id: number
  display: string
}

export interface Mensagem {
  id: number
  author_name: string
  author_avatar: string | null
  author_is_internal: boolean
  body: string
  is_public: boolean
  source: 'web' | 'chat' | 'system'
  is_first_response: boolean
  created_at: string
  attachments: Anexo[]
  mentions: Mencao[]
  edited_at: string | null
  is_deleted: boolean
  can_edit: boolean
}

export interface Evento {
  id: number
  from_status: StatusTicket | '' | null
  to_status: StatusTicket
  actor_name: string | null
  is_reopen: boolean
  is_automatic: boolean
  note: string
  created_at: string
}

export interface Seguidor {
  id: number
  name: string
}

export interface Etiqueta {
  id: number
  name: string
  slug: string
  color?: string
}

export interface RelogioSla {
  due_at: string | null
  state: EstadoSla
  minutes_left: number | null
}

export interface TicketDetalhe {
  id: number
  reference: string
  subject: string
  status: StatusTicket
  stage: number | null
  stage_name: string
  stage_color: string
  priority: Prioridade
  source: 'web' | 'chat' | 'internal'
  team: { id: number; name: string; slug: string } | null
  requester_display: string
  assignee_name: string | null
  assignee_id: number | null
  owner_name: string | null
  owner_id: number | null
  company_name: string
  category: number | null
  category_name: string | null
  current_status_note: string | null
  is_restricted: boolean
  content_hidden: boolean
  sla: { first_response: RelogioSla; resolution: RelogioSla }
  tags: Etiqueta[]
  created_at: string
  first_response_at: string | null
  messages: Mensagem[]
  events: Evento[]
  watchers: Seguidor[]
  /** null quando o conteúdo está mascarado para quem pede. */
  requester: Requester | null
}

/** Alvos de @menção / atribuição (GET /tickets/{id}/mention-targets/).
 *  Shape real conferido no MentionTargetSerializer: type 'user'|'team'. */
export interface AlvoMencao {
  type: 'user' | 'team'
  id: number
  name: string
  email: string
  avatar_url?: string | null
}

/** Contato do solicitante — agora exposto pelo TicketDetail (RequesterSerializer). */
export interface Requester {
  name: string
  email: string
  ui_language: string
  timezone: string | null
}

/** Macro (GET /settings/ticket-macros/). */
export interface Macro {
  id: number
  name: string
  body: string
}
