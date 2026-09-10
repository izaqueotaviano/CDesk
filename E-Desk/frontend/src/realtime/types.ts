/**
 * Vocabulário de eventos WebSocket — docs/10-frontend-novo.md, que o próprio
 * documento marca como "verificado contra a API rodando, não escrito de
 * memória". Use ESTE arquivo como fonte de verdade dos nomes de evento, não
 * o pseudocódigo de docs/07-arquitetura-frontend.md: aquele documento é
 * anterior (README o chama de "arquitetura do front ANTERIOR") e usa nomes
 * ilustrativos (`chat_message`, `ticket_replied`, `sla_warning`) que não
 * batem 1:1 com os eventos reais listados abaixo — em especial, eventos de
 * TICKET no canal pessoal ainda são uma lacuna do backend (docs/07 §7,
 * item "eventos de ticket no ws/me/ (F9-b)"), não algo já implementado.
 */

// ---------- ws/chat/<id>/ — sala de uma conversa ----------

export type MensagemClienteChat =
  | { type: 'message'; body: string }
  | { type: 'typing'; is_typing: boolean }
  | { type: 'ping' }

export type EventoServidorChat =
  | { type: 'message'; [chave: string]: unknown }
  | { type: 'typing'; [chave: string]: unknown }
  | { type: 'accepted'; [chave: string]: unknown }
  | { type: 'transferred'; [chave: string]: unknown }
  | { type: 'closed'; [chave: string]: unknown }
  | { type: 'converted'; [chave: string]: unknown }
  | { type: 'error'; [chave: string]: unknown }
  | { type: 'pong' }

// ---------- ws/me/ — canal pessoal (widget global, notificações) ----------

export type EventoServidorPessoal =
  | { type: 'notification'; [chave: string]: unknown }
  | { type: 'ticket_event'; ticket_id: number; kind: string }
  | { type: 'chat_queued'; [chave: string]: unknown }
  | { type: 'chat_taken'; [chave: string]: unknown }
  | { type: 'pong' }
