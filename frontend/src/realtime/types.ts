import type { MensagemChat } from '@/api/chat'

/**
 * Vocabulário de eventos WebSocket — conferido contra `apps/chat/consumers.py`
 * (o que cada handler `send_json` de fato emite), não contra o pseudocódigo
 * ilustrativo de docs/07-arquitetura-frontend.md, que é anterior e usa nomes
 * (`chat_message`, `ticket_replied`) que não batem 1:1 com o backend.
 */

// ---------- ws/chat/<id>/ — sala de uma conversa ----------

export type MensagemClienteChat =
  | { type: 'message'; body: string; reply_to?: number | null; is_internal_note?: boolean }
  | { type: 'typing'; is_typing: boolean }
  /** O DESTINATÁRIO confirmando que a mensagem chegou no aparelho dele — é
   *  o que sustenta o "entregue" sem o servidor ter de adivinhar. */
  | { type: 'delivered'; ids: number[] }
  | { type: 'ping' }

export type EventoServidorChat =
  // as três carregam a mensagem serializada inteira (ChatMessageSerializer)
  | ({ type: 'message' } & MensagemChat)
  | ({ type: 'message_edited' } & MensagemChat)
  | ({ type: 'message_deleted' } & MensagemChat)
  | { type: 'typing'; user_id: number; user_name: string; is_typing: boolean }
  | { type: 'message_delivered'; ids: number[] }
  | { type: 'message_read'; ids: number[] }
  | { type: 'accepted'; agent_name: string }
  | { type: 'transferred'; agent_name: string }
  | { type: 'closed'; by_internal: boolean }
  | { type: 'converted'; ticket_id: number; ticket_reference: string }
  | { type: 'error'; detail: string }
  | { type: 'pong' }

// ---------- ws/me/ — canal pessoal (fila de chat, notificações) ----------

/** `notification` é o envelope de `notifications.services.notify()` E dos
 *  avisos avulsos do chat (`_badge_counterpart`, transferência) — o `kind`
 *  é quem distingue. */
export interface NotificacaoPessoal {
  type: 'notification'
  kind: string
  notification_id?: number
  title?: string
  body?: string
  url?: string
  ticket_id?: number | null
  // kind = chat_message | chat_transferred
  chat_id?: number
  preview?: string
  author_name?: string
  company?: string
  client_name?: string
}

export type EventoServidorPessoal =
  | NotificacaoPessoal
  | { type: 'ticket_event'; ticket_id: number; kind: string }
  | { type: 'chat_queued'; chat_id: number; client_name: string; company: string; queued_at: string }
  | { type: 'chat_taken'; chat_id: number; agent_id: number }
  | { type: 'agent_presence'; [chave: string]: unknown }
  | { type: 'pong' }
