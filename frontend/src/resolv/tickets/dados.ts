import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Prioridade, ResumoFila } from './tipos'

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
  // Invalida `['tickets']` inteiro, não só `['tickets','lista']`: desde que a
  // barra lateral mostra contagem (`useResumoFila`), atribuir 10 chamados em
  // lote muda a lista E os números das gavetas. Deixar o resumo de fora faria
  // a tela mostrar "Não atribuídos 40" logo depois de esvaziar a gaveta.
  const invalidar = () => qc.invalidateQueries({ queryKey: ['tickets'] })

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

/**
 * Contagem de cada visão salva numa chamada só (`GET /tickets/resumo/`,
 * action `resumo` em apps/tickets/views.py). É o backend que soma: uma query
 * por gaveta a partir do navegador faria os números aparecerem um a um e a
 * lateral dançaria a cada troca de tela — foi por isso que o endpoint nasceu
 * assim, e nenhuma tela o chamava.
 *
 * `staleTime` de 30s igual ao dos KPIs da Início (`useKpis`): número de apoio
 * não precisa ser mais fresco que a lista que ele descreve.
 */
export function useResumoFila() {
  return useQuery({
    queryKey: ['tickets', 'resumo'],
    queryFn: () => api.get<ResumoFila>('/api/v1/tickets/resumo/'),
    staleTime: 30_000,
  })
}
