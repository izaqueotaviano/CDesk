import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type {
  AgenteAtribuivel,
  AlvoMencao,
  DadosFechamento,
  Macro,
  TicketDetalhe,
} from './tiposDetalhe'
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

// `?limit=200` porque o backend pagina em 25 por padrão (PAGE_SIZE,
// config/settings/base.py) — sem isso, empresa com mais de 25
// categorias/macros perde as demais em silêncio (o <select> de categoria em
// PainelPropriedades.tsx não tem paginação, é lista fechada ou nada). Mesmo
// precedente de cvz/tickets/dados.ts (`useAgentes`, `?limit=500`); 200 já
// cobre a escala real de categoria/macro sem carregar o catálogo inteiro à
// toa como 500 faria aqui.
export function useCategorias() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Paginado<Categoria> | Categoria[]>('/api/v1/categories/?limit=200'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results),
  })
}

/** Quem pode ser @mencionado neste ticket — agentes internos ativos e
 *  equipes (MentionTargetSerializer, apps/tickets/views.py `mention_targets`).
 *  NÃO é a lista de quem pode ser Responsável/Dono técnico — ver
 *  `useAgentesAtribuiveis` logo abaixo, que é a pergunta certa para os dois
 *  seletores do painel de propriedades. */
export function useAlvosMencao(id: number) {
  return useQuery({
    queryKey: ['ticket', id, 'mention-targets'],
    queryFn: () => api.get<AlvoMencao[]>(`/api/v1/tickets/${id}/mention-targets/`),
    staleTime: 60_000,
  })
}

/** Quem os seletores de Responsável e Dono técnico podem oferecer
 *  (AssignableAgentSerializer, `GET /tickets/{id}/assignable-agents/`,
 *  apps/tickets/views.py `assignable_agents`). Pergunta DIFERENTE de
 *  `useAlvosMencao`: aqui o próprio agente logado JÁ está incluído (é o
 *  "Assumir" pelo seletor) e agente leve JÁ está excluído (não passa em
 *  `TICKET_BE_ASSIGNED`) — reusar a lista de menção aqui é o que fazia o
 *  seletor oferecer gente que a atribuição real recusa com 400. */
export function useAgentesAtribuiveis(id: number) {
  return useQuery({
    queryKey: ['ticket', id, 'assignable-agents'],
    queryFn: () => api.get<AgenteAtribuivel[]>(`/api/v1/tickets/${id}/assignable-agents/`),
    staleTime: 60_000,
  })
}

export function useMacros() {
  return useQuery({
    queryKey: ['ticket-macros'],
    queryFn: () =>
      api.get<Paginado<Macro> | Macro[]>('/api/v1/settings/ticket-macros/?limit=200'),
    staleTime: 300_000,
    select: (d) => (Array.isArray(d) ? d : d.results).filter((m) => m.is_active !== false),
  })
}

/** Corpo do `POST /tickets/{id}/reply/`. Responder-e-fechar é UMA chamada:
 *  quando `new_status` é `closed`, os campos de resolução (D4) e a
 *  justificativa vão juntos (TicketReplySerializer). */
export interface DadosResposta {
  body: string
  is_public: boolean
  new_status?: StatusTicket
  resolution_started_at?: string
  resolution_ended_at?: string
  close_note?: string
  files?: File[]
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
    // Prefixo `['tickets']`: transferir de equipe ou mexer em etiquetas muda a
    // fila E as contagens da barra lateral (`['tickets', 'resumo']`).
    qc.invalidateQueries({ queryKey: ['tickets'] })
  }

  const responder = useMutation({
    mutationFn: (dados: DadosResposta) => {
      // Com anexos vai por multipart (o endpoint reply aceita `files`); sem,
      // JSON puro. O client detecta FormData e ajusta o Content-Type sozinho.
      const { files, ...json } = dados
      if (files && files.length > 0) {
        const fd = new FormData()
        Object.entries(json).forEach(([k, v]) => {
          if (v !== undefined) fd.append(k, String(v))
        })
        files.forEach((f) => fd.append('files', f))
        return api.post<TicketDetalhe>(`/api/v1/tickets/${id}/reply/`, fd)
      }
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

  /** Transferir de equipe é o MESMO PATCH de triagem de prioridade e categoria
   *  (`partial_update` em apps/tickets/views.py). Quem recusa equipe interna
   *  para chamado de cliente é o serviço, que também escreve "equipe → X" no
   *  histórico — a tela manda e mostra o motivo que voltar. */
  const mudarEquipe = useMutation({
    mutationFn: (team: number) => api.patch<TicketDetalhe>(`/api/v1/tickets/${id}/`, { team }),
    onSuccess: gravar,
  })

  /** A lista SUBSTITUI o conjunto de etiquetas, e lista vazia limpa — contrato
   *  do `TicketReclassifySerializer.tags` (apps/tickets/serializers.py). Por
   *  isso a tela manda sempre o conjunto inteiro, nunca "adicione esta". */
  const mudarEtiquetas = useMutation({
    mutationFn: (tags: number[]) => api.patch<TicketDetalhe>(`/api/v1/tickets/${id}/`, { tags }),
    onSuccess: gravar,
  })

  /** Grava só os campos de triagem da macro (categoria/urgência/responsável/
   *  etiquetas). O texto pronto é responsabilidade do compositor. */
  const aplicarMacro = useMutation({
    mutationFn: (macro_id: number) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/apply-macro/`, { macro_id }),
    onSuccess: gravar,
  })

  /** Fechamento sem resposta ao cliente — mesmo contrato do quadro (D4). */
  const fechar = useMutation({
    mutationFn: (dados: DadosFechamento) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/close/`, dados),
    onSuccess: gravar,
  })

  const editarMensagem = useMutation({
    mutationFn: ({ mensagemId, body }: { mensagemId: number; body: string }) =>
      api.patch<TicketDetalhe>(`/api/v1/tickets/${id}/messages/${mensagemId}/`, { body }),
    onSuccess: gravar,
  })

  const apagarMensagem = useMutation({
    mutationFn: (mensagemId: number) =>
      api.delete<TicketDetalhe>(`/api/v1/tickets/${id}/messages/${mensagemId}/`),
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
    mudarEquipe,
    mudarEtiquetas,
    aplicarMacro,
    fechar,
    editarMensagem,
    apagarMensagem,
  }
}
