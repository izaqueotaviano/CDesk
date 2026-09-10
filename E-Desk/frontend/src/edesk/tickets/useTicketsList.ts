import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { ParamsListagem, TicketLinha } from './tipos'

function montarQuery(p: ParamsListagem): string {
  const q = new URLSearchParams()
  if (p.view) q.set('view', p.view)
  if (p.q && p.q.length >= 3) q.set('q', p.q) // backend/print pedem 3+ caracteres
  if (p.priority) q.set('priority', p.priority)
  if (p.ordering) q.set('ordering', p.ordering)
  q.set('limit', String(p.limit))
  q.set('offset', String(p.offset))
  return q.toString()
}

/**
 * Lista de tickets do backend real (`GET /api/v1/tickets/`,
 * LimitOffsetPagination). `keepPreviousData` evita o "pisca-branco" ao trocar
 * de página/ordenação — a tabela antiga fica visível enquanto a nova carrega.
 */
export function useTicketsList(params: ParamsListagem) {
  return useQuery({
    queryKey: ['tickets', 'lista', params],
    queryFn: () => api.get<Paginado<TicketLinha>>(`/api/v1/tickets/?${montarQuery(params)}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}
