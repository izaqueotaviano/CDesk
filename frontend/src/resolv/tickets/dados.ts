import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Prioridade } from './tipos'

/** Resposta das 3 ações em lote (`bulk-assign`/`bulk-priority`/`bulk-close`,
 *  ver `_BulkTicketIdsSerializer` no backend): sucesso é por-ticket, não
 *  tudo-ou-nada — um chamado de outra equipe (ou já fechado) pode falhar sem
 *  travar o resto da seleção. */
export interface ResultadoLote {
  updated: number[]
  failed: { id: number; detail: string }[]
}

/**
 * Ações em lote da barra de seleção múltipla da fila. Os endpoints já
 * existiam prontos no backend (`POST /tickets/bulk-assign/` e
 * `/bulk-priority/`) sem nenhuma tela chamando — só liga. `bulk-close` fica
 * de fora por enquanto: pede a mesma janela de datas de resolução do
 * fechamento individual, que é uma tela própria, não um select na barra.
 */
export function useAcoesEmLote() {
  const qc = useQueryClient()
  const invalidar = () => qc.invalidateQueries({ queryKey: ['tickets', 'lista'] })

  const atribuir = useMutation({
    mutationFn: (dados: { ticket_ids: number[]; assignee_id: number | null }) =>
      api.post<ResultadoLote>('/api/v1/tickets/bulk-assign/', dados),
    onSuccess: invalidar,
  })

  const mudarPrioridade = useMutation({
    mutationFn: (dados: { ticket_ids: number[]; priority: Prioridade }) =>
      api.post<ResultadoLote>('/api/v1/tickets/bulk-priority/', dados),
    onSuccess: invalidar,
  })

  return { atribuir, mudarPrioridade }
}
