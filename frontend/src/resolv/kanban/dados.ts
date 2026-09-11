import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { Agrupamento, Board, QuadroMontado } from './tipos'

function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

export function useQuadros() {
  return useQuery({
    queryKey: ['kanban', 'quadros'],
    queryFn: () => api.get<Paginado<Board> | Board[]>('/api/v1/kanban/boards/'),
    select: lista,
    staleTime: 60_000,
  })
}

/** O quadro montado — colunas e cartões num request só (mesma resposta,
 *  mesmo instante: ver o docstring de `entries()` no backend sobre por que
 *  as duas coisas precisam vir juntas). */
export function useQuadroMontado(boardId: number | null, agrupar: Agrupamento) {
  return useQuery({
    queryKey: ['kanban', 'cards', boardId, agrupar],
    queryFn: () =>
      api.get<QuadroMontado>(`/api/v1/kanban/boards/${boardId}/cards/?agrupar=${agrupar}`),
    enabled: boardId != null,
    staleTime: 10_000,
  })
}

interface PlaceInput {
  boardId: number
  ticket_id: number
  stage_id?: number
  lane_id?: number
}

/** Mover um cartão de coluna. A resposta já é o quadro inteiro atualizado —
 *  escreve direto no cache em vez de invalidar e esperar outro round-trip,
 *  pro drag terminar sem o card "voltar e depois ir" na tela. */
export function usePlace(agrupar: Agrupamento) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ boardId, ...body }: PlaceInput) =>
      api.post<QuadroMontado>(`/api/v1/kanban/boards/${boardId}/place/`, body),
    onSuccess: (quadro, { boardId }) => {
      qc.setQueryData(['kanban', 'cards', boardId, agrupar], quadro)
    },
  })
}

interface EntryInput {
  boardId: number
  ticketId: number
  due_at?: string | null
}

export function useDefinirPrazo(agrupar: Agrupamento) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ boardId, ticketId, ...body }: EntryInput) =>
      api.patch<QuadroMontado>(`/api/v1/kanban/boards/${boardId}/entry/${ticketId}/`, body),
    onSuccess: (quadro, { boardId }) => {
      qc.setQueryData(['kanban', 'cards', boardId, agrupar], quadro)
    },
  })
}

export interface Lane {
  id: number
  board: number
  name: string
  order: number
}

export function useCriarLane(boardId: number | null, agrupar: Agrupamento) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api.post<Lane>('/api/v1/kanban/lanes/', { board: boardId, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'cards', boardId, agrupar] }),
  })
}

export function useApagarLane(boardId: number | null, agrupar: Agrupamento) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (laneId: number) => api.delete(`/api/v1/kanban/lanes/${laneId}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'cards', boardId, agrupar] }),
  })
}

export interface FechamentoInput {
  ticketId: number
  resolution_started_at: string
  resolution_ended_at: string
  note?: string
}

/** Mesmo endpoint que a tela do chamado usa pra fechar (`/close/`) — o
 *  quadro não tem um fluxo de fechamento próprio, só intercepta o arraste
 *  e abre este formulário antes de deixar o ticket sair da fila. */
export function useFecharTicket(boardId: number | null, agrupar: Agrupamento) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ticketId, ...body }: FechamentoInput) =>
      api.post(`/api/v1/tickets/${ticketId}/close/`, body),
    // o ticket fechado sai da fila de não-resolvidos — o quadro precisa
    // buscar de novo pra ele sumir da coluna
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kanban', 'cards', boardId, agrupar] }),
  })
}
