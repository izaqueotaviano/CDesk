import type { QueryClient } from '@tanstack/react-query'
import { criarSocket, type Socket } from './socket'
import type { EventoServidorChat, EventoServidorPessoal } from './types'

/**
 * "Eventos de socket são dicas; REST é a verdade" (docs/07-arquitetura-frontend.md).
 * Nenhuma função aqui guarda o payload do evento em lugar nenhum — cada uma
 * só invalida a query correspondente; quem lê os dados de novo é sempre o
 * REST, na próxima vez que a tela precisar deles.
 */

let canalPessoal: Socket | null = null

/** Singleton de verdade — mora fora do React. Chamar de novo (StrictMode
 *  roda efeitos duas vezes em dev; docs/07 registrou isso como bug medido
 *  quando o socket vivia dentro de um useEffect) só reencontra a conexão
 *  já aberta, nunca abre uma segunda. */
export function conectarCanalPessoal(queryClient: QueryClient): Socket {
  if (canalPessoal) return canalPessoal
  canalPessoal = criarSocket<EventoServidorPessoal>({
    path: '/ws/me/',
    onEvento: (evento) => aplicarEventoPessoal(evento, queryClient),
  })
  return canalPessoal
}

function aplicarEventoPessoal(evento: EventoServidorPessoal, queryClient: QueryClient) {
  switch (evento.type) {
    case 'notification':
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      break
    case 'ticket_event': {
      // Realtime de ticket (backend: broadcast_ticket_event). Dica, não
      // verdade: revalida o detalhe do ticket que mudou e a fila. A resposta
      // do cliente por e-mail aparece na conversa sem F5.
      const id = (evento as { ticket_id?: number }).ticket_id
      if (id != null) queryClient.invalidateQueries({ queryKey: ['ticket', id] })
      queryClient.invalidateQueries({ queryKey: ['tickets', 'lista'] })
      break
    }
    case 'chat_queued':
    case 'chat_taken':
      // Fila de chat do agente ainda não tem hook de leitura nesta base;
      // a chave abaixo é o contrato que esse hook deve usar quando existir.
      queryClient.invalidateQueries({ queryKey: ['chat', 'fila'] })
      break
    case 'pong':
      break
  }
}

/**
 * Mapeamento por evento do canal de UMA sala de chat. Note que os nomes
 * abaixo (`message`, `accepted`, `transferred`, `closed`, `converted`) são os
 * VERIFICADOS em docs/10-frontend-novo.md — não os nomes ilustrativos
 * (`chat_message`, `ticket_replied`, `sla_warning`) do exemplo de código em
 * docs/07, que é o documento anterior e usa vocabulário que não bate 1:1 com
 * o que o backend hoje emite. Eventos de TICKET no canal pessoal (que
 * fariam `['ticket', id]`/`['tickets']` serem invalidados por socket) ainda
 * são uma lacuna do backend — docs/07 §7, item "eventos de ticket no ws/me/
 * (F9-b)" — por isso não têm equivalente aqui.
 */
export function aplicarEventoChat(evento: EventoServidorChat, chatId: number, queryClient: QueryClient) {
  switch (evento.type) {
    case 'message':
      queryClient.invalidateQueries({ queryKey: ['chat', chatId, 'messages'] })
      break
    case 'accepted':
    case 'transferred':
      queryClient.invalidateQueries({ queryKey: ['chat', chatId] })
      break
    case 'closed':
      queryClient.invalidateQueries({ queryKey: ['chat', chatId] })
      // Encerrar pode travar chat novo até avaliar (GAPS.md — pending-ratings).
      queryClient.invalidateQueries({ queryKey: ['chat', 'pending-ratings'] })
      break
    case 'converted':
      queryClient.invalidateQueries({ queryKey: ['chat', chatId] })
      queryClient.invalidateQueries({ queryKey: ['tickets'] })
      break
    case 'typing':
    case 'error':
    case 'pong':
      break // efêmero — indicador de digitação e erro não passam pelo cache
  }
}
