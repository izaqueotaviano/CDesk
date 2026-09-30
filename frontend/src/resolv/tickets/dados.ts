import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type {
  Facetas,
  ParamsListagem,
  Prioridade,
  ResumoFila,
  StatusDoQuadro,
  VisaoPessoal,
} from './tipos'

/** Resposta das ações em lote (`bulk-assign`/`bulk-priority`/`bulk-status`/
 *  `bulk-close`, ver `_BulkTicketIdsSerializer` no backend): sucesso é
 *  por-ticket, não tudo-ou-nada — um chamado de outra equipe (ou já fechado)
 *  pode falhar sem travar o resto da seleção. */
export interface ResultadoLote {
  updated: number[]
  failed: { id: number; detail: string }[]
}

/** O mesmo contrato de `POST /tickets/{id}/close/` (TicketCloseSerializer),
 *  aplicado a todos os selecionados. */
export interface DadosEncerrarLote {
  resolution_started_at: string
  resolution_ended_at: string
  note: string
}

/**
 * Ações em lote da barra de seleção múltipla da fila. Todas respondem no
 * mesmo formato (`ResultadoLote`) e passam pela mesma porta no backend
 * (`ticket.bulk_actions` + escopo de visibilidade).
 *
 * "Encerrar" usa `bulk-close`, que pede a MESMA janela de datas de solução do
 * fechamento individual (D4) — por isso abre um diálogo (ModalEncerrarLote),
 * não um select na barra.
 */
export function useAcoesEmLote() {
  const qc = useQueryClient()
  // Invalida `['tickets']` inteiro, não só `['tickets','lista']`: desde que a
  // barra lateral mostra contagem (`useResumoFila`, `useVisoesPessoais`),
  // atribuir 10 chamados em lote muda a lista E os números das gavetas.
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

  const mudarStatus = useMutation({
    mutationFn: (dados: { ticket_ids: number[]; stage_id: number }) =>
      api.post<ResultadoLote>('/api/v1/tickets/bulk-status/', dados),
    onSuccess: invalidar,
  })

  const encerrar = useMutation({
    mutationFn: (dados: { ticket_ids: number[] } & DadosEncerrarLote) =>
      api.post<ResultadoLote>('/api/v1/tickets/bulk-close/', dados),
    onSuccess: invalidar,
  })

  return { atribuir, mudarPrioridade, mudarStatus, encerrar }
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

/** Os parâmetros da listagem que também valem para as facetas — sem página
 *  e sem ordenação, que não mudam contagem nenhuma. Mesma regra de `q` de
 *  `montarQuery` (useTicketsList.ts): só vai com 3+ caracteres. */
export function consultaDasFacetas(p: ParamsListagem): string {
  const q = new URLSearchParams()
  for (const [chave, valor] of Object.entries(p)) {
    if (chave === 'limit' || chave === 'offset' || chave === 'ordering') continue
    if (chave === 'q' && String(valor ?? '').length < 3) continue
    if (valor != null && valor !== '') q.set(chave, String(valor))
  }
  return q.toString()
}

/**
 * Opções e contagens da barra de filtros (`GET /tickets/facets/`). O
 * endpoint existia pronto e nenhuma tela o chamava: cada dimensão vem
 * contada com os OUTROS filtros aplicados (nunca o dela mesma), que é o que
 * faz o número ao lado de "Alta" responder "se eu marcar isto, quantos vêm".
 *
 * `placeholderData` mantém as opções anteriores enquanto a nova contagem
 * chega — sem isso cada clique num filtro esvaziaria o menu aberto.
 */
export function useFacetas(p: ParamsListagem, habilitado = true) {
  const consulta = consultaDasFacetas(p)
  return useQuery({
    queryKey: ['tickets', 'facetas', consulta],
    queryFn: () => api.get<Facetas>(`/api/v1/tickets/facets/?${consulta}`),
    placeholderData: (anterior) => anterior,
    staleTime: 30_000,
    // No celular a barra não existe: só busca quando a folha de filtros abre.
    enabled: habilitado,
  })
}

// ---------------------------------------------------------------------------
// Visualizações pessoais (`/api/v1/ticket-views/`)
// ---------------------------------------------------------------------------

/** Debaixo de `['tickets', …]` de propósito: toda ação em lote e todo evento
 *  de socket que invalida a fila invalida junto a contagem das visões. */
const CHAVE_VISOES = ['tickets', 'visoes-pessoais'] as const

export function useVisoesPessoais() {
  return useQuery({
    queryKey: CHAVE_VISOES,
    queryFn: () => api.get<VisaoPessoal[]>('/api/v1/ticket-views/'),
    staleTime: 30_000,
  })
}

export function useGerenciarVisoes() {
  const qc = useQueryClient()
  const invalidar = () => qc.invalidateQueries({ queryKey: CHAVE_VISOES })

  const criar = useMutation({
    mutationFn: (dados: { name: string; filters: Record<string, string> }) =>
      api.post<VisaoPessoal>('/api/v1/ticket-views/', dados),
    onSuccess: invalidar,
  })

  const atualizar = useMutation({
    mutationFn: ({
      id,
      ...dados
    }: {
      id: number
      name?: string
      filters?: Record<string, string>
    }) => api.patch<VisaoPessoal>(`/api/v1/ticket-views/${id}/`, dados),
    onSuccess: invalidar,
  })

  const excluir = useMutation({
    mutationFn: (id: number) => api.delete(`/api/v1/ticket-views/${id}/`),
    onSuccess: invalidar,
  })

  // Otimista: a lista reordenada aparece na hora (a ordem é só de quem
  // clicou, não tem conflito possível com outra pessoa) e o servidor
  // confirma por trás. A contagem que já estava no cache viaja junto.
  const reordenar = useMutation({
    mutationFn: (ids: number[]) =>
      api.post<VisaoPessoal[]>('/api/v1/ticket-views/reorder/', { ids }),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: CHAVE_VISOES })
      const antes = qc.getQueryData<VisaoPessoal[]>(CHAVE_VISOES)
      if (antes) {
        const porId = new Map(antes.map((v) => [v.id, v]))
        qc.setQueryData(
          CHAVE_VISOES,
          ids.map((id, i) => ({ ...porId.get(id)!, position: i })).filter((v) => v.id != null),
        )
      }
      return { antes }
    },
    onError: (_e, _ids, ctx) => {
      if (ctx?.antes) qc.setQueryData(CHAVE_VISOES, ctx.antes)
    },
    onSettled: invalidar,
  })

  return { criar, atualizar, excluir, reordenar }
}

/** Status do quadro que "Mudar status" em lote oferece: ativos e fora da
 *  categoria de conclusão (fechar é "Encerrar", que pede as datas). Leitura
 *  liberada para qualquer interno (`IsInternalReadAdminWrite`). */
export function useStatusDoQuadro(habilitado: boolean) {
  return useQuery({
    queryKey: ['status-do-quadro'],
    queryFn: () =>
      api.get<Paginado<StatusDoQuadro> | StatusDoQuadro[]>('/api/v1/settings/statuses/?limit=100'),
    select: (d) =>
      (Array.isArray(d) ? d : d.results)
        .filter((s) => s.is_active && s.category !== 'closed')
        .sort((a, b) => a.order - b.order),
    staleTime: 300_000,
    enabled: habilitado,
  })
}
