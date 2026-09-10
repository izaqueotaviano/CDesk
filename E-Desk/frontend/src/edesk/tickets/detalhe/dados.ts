import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { AlvoMencao, Macro, TicketDetalhe } from './tiposDetalhe'
import type { Prioridade, StatusTicket } from '../tipos'

const chaveDetalhe = (id: number) => ['ticket', id] as const

export function useTicketDetalhe(id: number) {
  return useQuery({
    queryKey: chaveDetalhe(id),
    queryFn: () => api.get<TicketDetalhe>(`/api/v1/tickets/${id}/`),
    staleTime: 10_000,
    // Realtime de verdade agora vem por WebSocket: o backend emite
    // `ticket_event` no ws/me/ (broadcast_ticket_event) e a bridge invalida
    // esta query. O refetch periódico fica só como REDE DE SEGURANÇA (socket
    // caído/reconectando) — 60s, folgado, mais o refetch ao voltar o foco.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
}

export interface Categoria {
  id: number
  name: string
  slug: string
}

export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Paginado<Categoria> | Categoria[]>('/api/v1/categories/'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results),
  })
}

/** Agentes/equipes que podem ser atribuídos — lista inteira, filtrada em memória. */
export function useAlvosMencao(id: number) {
  return useQuery({
    queryKey: ['ticket', id, 'mention-targets'],
    queryFn: () => api.get<AlvoMencao[]>(`/api/v1/tickets/${id}/mention-targets/`),
    staleTime: 60_000,
  })
}

export function useMacros() {
  return useQuery({
    queryKey: ['ticket-macros'],
    queryFn: () => api.get<Paginado<Macro> | Macro[]>('/api/v1/settings/ticket-macros/'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results),
  })
}

/**
 * Ações do ticket. Toda ação devolve o TicketDetail atualizado — então o
 * onSuccess grava direto no cache (`setQueryData`), sem um refetch extra, e
 * ainda invalida a listagem (a fila mostra status/responsável que acabaram de
 * mudar). É o padrão "a resposta da ação É a nova verdade".
 */
export function useAcoesTicket(id: number) {
  const qc = useQueryClient()
  const gravar = (t: TicketDetalhe) => {
    qc.setQueryData(chaveDetalhe(id), t)
    qc.invalidateQueries({ queryKey: ['tickets', 'lista'] })
  }

  const responder = useMutation({
    mutationFn: (dados: {
      body: string
      is_public: boolean
      new_status?: StatusTicket
      files?: File[]
    }) => {
      // Com anexos vai por multipart (o endpoint reply aceita `files`); sem,
      // JSON puro. O client detecta FormData e ajusta o Content-Type sozinho.
      if (dados.files && dados.files.length > 0) {
        const fd = new FormData()
        fd.append('body', dados.body)
        fd.append('is_public', String(dados.is_public))
        if (dados.new_status) fd.append('new_status', dados.new_status)
        dados.files.forEach((f) => fd.append('files', f))
        return api.post<TicketDetalhe>(`/api/v1/tickets/${id}/reply/`, fd)
      }
      const { files: _f, ...json } = dados
      return api.post<TicketDetalhe>(`/api/v1/tickets/${id}/reply/`, json)
    },
    onSuccess: gravar,
  })

  const atribuir = useMutation({
    mutationFn: (assignee_id: number | null) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/assign/`, { assignee_id }),
    onSuccess: gravar,
  })

  const definirDono = useMutation({
    mutationFn: (owner_id: number | null) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/set-owner/`, { owner_id }),
    onSuccess: gravar,
  })

  const mudarCategoria = useMutation({
    mutationFn: (category: number | null) =>
      api.patch<TicketDetalhe>(`/api/v1/tickets/${id}/`, { category }),
    onSuccess: gravar,
  })

  const seguir = useMutation({
    mutationFn: () => api.post<TicketDetalhe>(`/api/v1/tickets/${id}/follow/`),
    onSuccess: gravar,
  })
  const deixarDeSeguir = useMutation({
    mutationFn: () => api.post<TicketDetalhe>(`/api/v1/tickets/${id}/unfollow/`),
    onSuccess: gravar,
  })

  const mudarPrioridade = useMutation({
    mutationFn: (priority: Prioridade) =>
      api.patch<TicketDetalhe>(`/api/v1/tickets/${id}/`, { priority }),
    onSuccess: gravar,
  })

  const aplicarMacro = useMutation({
    mutationFn: (macro_id: number) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/apply-macro/`, { macro_id }),
    onSuccess: gravar,
  })

  return {
    responder,
    atribuir,
    definirDono,
    mudarCategoria,
    seguir,
    deixarDeSeguir,
    mudarPrioridade,
    aplicarMacro,
  }
}
