/**
 * Tipos do detalhe do ticket, recortados do schema `TicketDetail` do
 * resolv-openapi.yaml (conferidos contra o serializer real). Um único
 * GET /api/v1/tickets/{id}/ já traz mensagens, eventos e seguidores embutidos.
 */
import type { EstadoSla, Prioridade, StatusTicket } from '../tipos'

/** Resultado da varredura antivírus (D19) — `ScanStatus` do backend. */
export type StatusVarredura = 'pending' | 'clean' | 'infected' | 'error' | 'skipped'

export interface Anexo {
  id: number
  filename: string
  content_type?: string
  size_bytes?: number
  /** Caminho relativo à API (`/api/v1/attachments/{id}/`) — prefixar com API_BASE_URL. */
  url?: string
  scan_status?: StatusVarredura
  is_downloadable?: boolean
}

export interface Mencao {
  id: number
  display: string
}

export interface Mensagem {
  id: number
  author_name: string
  /** Caminho relativo à API (`/avatars/...`) ou URL absoluta. */
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

/**
 * Nota do CSAT deste chamado (`get_satisfaction` em apps/tickets/serializers.py).
 * O objeto INTEIRO é nulo enquanto a pesquisa não foi respondida — e isso não é
 * nota zero: a escala do backend é 0–10 (`services/satisfaction.answer`), então
 * 0 é uma nota legítima e quem lê tem que testar o objeto, nunca o número.
 */
export interface Avaliacao {
  score: number
  comment: string
  responded_at: string | null
}

export interface TicketDetalhe {
  id: number
  reference: string
  subject: string
  /** Chave do pedido no ERP, capturada na abertura. Sempre presente; vem ""
   *  quando ninguém informou (CharField(blank=True) em apps/tickets/models.py). */
  order_number: string
  status: StatusTicket
  stage: number | null
  stage_name: string
  stage_color: string
  priority: Prioridade
  source: 'web' | 'chat' | 'internal'
  team: { id: number; name: string; slug: string } | null
  requester_display: string
  assignee_name: string | null
  assignee_avatar?: string | null
  assignee_id: number | null
  owner_name: string | null
  owner_id: number | null
  company_name: string
  plan?: { slug: string; name: string } | null
  category: number | null
  category_name: string | null
  service_name?: string | null
  current_status_note: string | null
  is_restricted: boolean
  content_hidden: boolean
  restriction_reason?: string
  sla: { first_response: RelogioSla; resolution: RelogioSla }
  tags: Etiqueta[]
  satisfaction: Avaliacao | null
  created_at: string
  updated_at?: string
  first_response_at: string | null
  closed_at?: string | null
  auto_closed?: boolean
  reopen_count?: number
  last_reopened_at?: string | null
  resolution_started_at?: string | null
  resolution_ended_at?: string | null
  sla_cycle?: number
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
  group?: 'ticket' | 'equipe' | 'outros' | 'equipes'
}

/** Um item do seletor de Responsável/Dono técnico
 *  (GET /tickets/{id}/assignable-agents/, AssignableAgentSerializer em
 *  apps/tickets/serializers.py). Sem `type`/`group`: diferente de
 *  `AlvoMencao`, esta lista nunca tem equipe — só gente, já filtrada pela
 *  regra de negócio de atribuição (inclui o próprio agente, exclui leve). */
export interface AgenteAtribuivel {
  id: number
  name: string
  email: string
  avatar_url: string
}

/** Contato do solicitante — agora exposto pelo TicketDetail (RequesterSerializer). */
export interface Requester {
  name: string
  email: string
  ui_language: string
  timezone: string | null
}

/** Macro (GET /settings/ticket-macros/). Além do texto pronto, carrega os
 *  campos de triagem que `POST /tickets/{id}/apply-macro/` grava no servidor. */
export interface Macro {
  id: number
  name: string
  body: string
  category?: number | null
  category_name?: string | null
  priority?: Prioridade | '' | null
  assignee?: number | null
  assignee_name?: string | null
  tags?: number[]
  is_active?: boolean
}

/** Dados do fechamento (D4): início/término reais da solução + justificativa. */
export interface DadosFechamento {
  resolution_started_at: string
  resolution_ended_at: string
  note: string
}
