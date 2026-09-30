import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { ParamsListagem, TicketLinha } from './tipos'

/** Filtros da barra da fila que viajam como estão (mesmo nome, mesmo valor)
 *  — ver resolv/tickets/filtros.ts. */
const FILTROS_DIRETOS = [
  'priority',
  'sla',
  'status',
  'assignee',
  'team',
  'company',
  'category',
  'tag',
  'periodo',
  'desde',
  'ate',
  'requester',
] as const

function montarQuery(p: ParamsListagem): string {
  const q = new URLSearchParams()
  if (p.view) q.set('view', p.view)
  if (p.q && p.q.length >= 3) q.set('q', p.q) // backend/print pedem 3+ caracteres
  for (const chave of FILTROS_DIRETOS) {
    const valor = p[chave]
    if (valor) q.set(chave, valor)
  }
  if (p.ordering) q.set('ordering', p.ordering)
  q.set('limit', String(p.limit))
  q.set('offset', String(p.offset))
  return q.toString()
}

/**
 * Lista de tickets do backend real (`GET /api/v1/tickets/`,
 * LimitOffsetPagination). `keepPreviousData` evita o "pisca-branco" ao trocar
 * de página/ordenação — a tabela antiga fica visível enquanto a nova carrega.
 *
 * `refetchInterval`: o caminho normal já é a invalidação por socket (a bridge
 * cobre `ticket_created`/`ticket_replied`/etc. invalidando o prefixo
 * `['tickets']`, ver realtime/bridge.ts) — isto aqui é só REDE DE SEGURANÇA
 * para quando o socket cai ou está reconectando, mesmo raciocínio de
 * `useTicketDetalhe` (detalhe/dados.ts, 60s) e da fila de chat (api/chat.ts,
 * `useFilaChat`/`useMeusChats`, 30s). 30s e não 60s: esta tela também usa o
 * próprio horário do fetch (`dataUpdatedAt`) pra render "tempo de espera em
 * fila" e o relógio de SLA de cada linha (format.ts::esperaEmFila) — sem
 * refetch, os dois congelam mesmo sem NENHUM ticket ter mudado, e é aqui que
 * se decide "o que atender agora" (ver comentário sobre "Tickets
 * Prioritário" em PaginaListaTickets.tsx). `refetchOnWindowFocus` cobre quem
 * deixou a aba aberta em segundo plano e volta — mesmo padrão do detalhe.
 */
export function useTicketsList(params: ParamsListagem) {
  return useQuery({
    queryKey: ['tickets', 'lista', params],
    queryFn: () => api.get<Paginado<TicketLinha>>(`/api/v1/tickets/?${montarQuery(params)}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}
