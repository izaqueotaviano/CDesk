import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { Chat } from '@/api/chat'
import type { TicketResumo } from './tickets'

// ---------------------------------------------------------------------------
// Histórico: o que já terminou — chamados resolvidos ou fechados e conversas
// encerradas — com a avaliação que a pessoa deu (ou ainda deve).
// ---------------------------------------------------------------------------

export type FiltroAvaliacao = '' | 'sim' | 'nao'

export interface ParamsHistoricoTickets {
  avaliacao?: FiltroAvaliacao
  q?: string
  /** Aberto a partir desta data (o servidor filtra por `created_at`). */
  desde?: string
  limit: number
  offset: number
}

function query(obj: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

export const chavesHistorico = {
  tickets: (p: ParamsHistoricoTickets) => ['portal', 'historico', 'tickets', p] as const,
  chats: (limite: number) => ['portal', 'historico', 'chats', limite] as const,
  contagens: ['portal', 'historico', 'contagens'] as const,
}

/** Encerrados (resolvidos + fechados), mais recentes primeiro. `avaliacao=`
 *  é recorte do servidor — o contador e a lista vêm da mesma consulta. */
export function useTicketsEncerrados(p: ParamsHistoricoTickets) {
  return useQuery({
    queryKey: chavesHistorico.tickets(p),
    queryFn: () =>
      api.get<Paginado<TicketResumo>>(
        `/api/v1/tickets/?${query({ status: 'closed', avaliacao: p.avaliacao, q: p.q, desde: p.desde, ordering: '-criado', limit: p.limit, offset: p.offset })}`,
      ),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** Conversas encerradas. O servidor não filtra por avaliação aqui — quem
 *  recorta é a tela, sobre o que já carregou. */
export function useChatsEncerrados(limite: number) {
  return useQuery({
    queryKey: chavesHistorico.chats(limite),
    queryFn: () => api.get<Paginado<Chat>>(`/api/v1/chat/chats/?${query({ status: 'closed', limit: limite })}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** Os três números do topo — pedidos com `limit=1`, só pelo `count`. */
export function useContagemHistorico() {
  const [tickets, avaliados, chats] = useQueries({
    queries: [
      { chave: 'tickets', url: `/api/v1/tickets/?${query({ status: 'closed', limit: 1 })}` },
      { chave: 'avaliados', url: `/api/v1/tickets/?${query({ status: 'closed', avaliacao: 'sim', limit: 1 })}` },
      { chave: 'chats', url: `/api/v1/chat/chats/?${query({ status: 'closed', limit: 1 })}` },
    ].map((c) => ({
      queryKey: [...chavesHistorico.contagens, c.chave],
      queryFn: () => api.get<Paginado<unknown>>(c.url),
      staleTime: 30_000,
      select: (d: Paginado<unknown>) => d.count,
    })),
  })
  return { tickets: tickets.data, ticketsAvaliados: avaliados.data, chats: chats.data }
}
