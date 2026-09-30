import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL, ApiError, api, type Paginado } from '@/api/client'
import type { TicketDetalhe } from '@/resolv/tickets/detalhe/tiposDetalhe'
import type { Prioridade, RelogioSla, StatusTicket } from '@/resolv/tickets/tipos'

// ---------------------------------------------------------------------------
// Tipos — recortes do `TicketListSerializer` (o que a lista do portal usa)
// ---------------------------------------------------------------------------

export interface TicketResumo {
  id: number
  reference: string
  subject: string
  order_number: string
  status: StatusTicket
  stage_name: string
  stage_color: string
  priority: Prioridade
  team: { id: number; name: string; slug: string } | null
  category_name: string | null
  requester_display: string
  created_at: string
  updated_at: string
  closed_at: string | null
  auto_closed: boolean
  first_response_at: string | null
  reopen_count: number
  is_restricted: boolean
  content_hidden: boolean
  sla: { first_response: RelogioSla; resolution: RelogioSla }
  satisfaction: { score: number | null; comment?: string } | null
}

export interface RespostaRapida {
  id: number
  contexto: 'chat' | 'ticket'
  rotulo: string
  texto: string
  order: number
}

export interface AvaliacaoPendenteTicket {
  ticket_id: number
  reference: string
  subject: string
}

export interface EstimativaResposta {
  minutes: number | null
  sample: number
  label: string | null
}

export interface EquipeCliente {
  id: number
  name: string
  slug: string
}
export interface CategoriaCliente {
  id: number
  name: string
  service: number | null
}

// ---------------------------------------------------------------------------
// Abas da lista — cada uma é um recorte NOMEADO no servidor (status em lista
// e `resolucao=`), para o contador e a lista terem a mesma fonte.
// ---------------------------------------------------------------------------

export type AbaTickets = 'aguardando-voce' | 'aguardando-suporte' | 'em-andamento' | 'resolvidos' | 'fechados'

export interface DefinicaoAba {
  id: AbaTickets
  rotulo: string
  params: Record<string, string>
  /** "Aguardando seu retorno" — a única aba onde a bola está com a pessoa. */
  destaque?: boolean
  vazio: { titulo: string; descricao: string }
}

export const ABAS: DefinicaoAba[] = [
  {
    id: 'aguardando-voce',
    rotulo: 'Aguardando seu retorno',
    params: { status: 'pending_customer' },
    destaque: true,
    vazio: { titulo: 'Nada aguardando você', descricao: 'Quando o suporte precisar de uma resposta sua, o ticket aparece aqui.' },
  },
  {
    id: 'aguardando-suporte',
    rotulo: 'Aguardando suporte',
    params: { status: 'new' },
    vazio: { titulo: 'Nenhum ticket na fila', descricao: 'Tickets recém-abertos ficam aqui até a primeira resposta do suporte.' },
  },
  {
    id: 'em-andamento',
    rotulo: 'Em andamento',
    params: { status: 'open' },
    vazio: { titulo: 'Nenhum ticket em andamento', descricao: 'Tickets que o suporte já está tratando aparecem aqui.' },
  },
  {
    id: 'resolvidos',
    rotulo: 'Resolvidos',
    params: { resolucao: 'resolvido' },
    vazio: { titulo: 'Nenhum ticket resolvido ainda', descricao: 'Tickets concluídos pelo suporte ficam aqui, e podem ser reabertos respondendo.' },
  },
  {
    id: 'fechados',
    rotulo: 'Fechados',
    params: { resolucao: 'fechado' },
    vazio: { titulo: 'Nenhum ticket fechado', descricao: 'Tickets encerrados automaticamente por falta de retorno ficam aqui.' },
  },
]

export const ABA_PADRAO: AbaTickets = 'aguardando-voce'

export type OrdemTickets = '-criado' | 'criado' | '-urgencia'
export const ORDENS: { valor: OrdemTickets; rotulo: string }[] = [
  { valor: '-criado', rotulo: 'Mais recentes' },
  { valor: 'criado', rotulo: 'Mais antigos' },
  { valor: '-urgencia', rotulo: 'Maior urgência' },
]

export interface ParamsTickets {
  aba: AbaTickets
  q?: string
  prioridade?: string
  categoria?: string
  desde?: string
  ate?: string
  ordem?: OrdemTickets
  limit: number
  offset: number
}

function query(obj: Record<string, string | number | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== '') p.set(k, String(v))
  return p.toString()
}

function paramsDaLista(p: ParamsTickets): string {
  const aba = ABAS.find((a) => a.id === p.aba) ?? ABAS[0]
  return query({
    ...aba.params,
    q: p.q,
    priority: p.prioridade,
    category: p.categoria,
    desde: p.desde,
    ate: p.ate,
    ordering: p.ordem ?? '-criado',
    limit: p.limit,
    offset: p.offset,
  })
}

export const chavesPortal = {
  contagens: ['portal', 'tickets', 'contagens'] as const,
  lista: (p: ParamsTickets) => ['portal', 'tickets', 'lista', p] as const,
  recentes: ['portal', 'tickets', 'recentes'] as const,
  ticket: (id: number) => ['portal', 'ticket', id] as const,
  pendentes: ['portal', 'tickets', 'pendentes'] as const,
  respostasRapidas: (ctx: string) => ['quick-replies', ctx] as const,
  estimativa: (slug: string | null) => ['estimativa-resposta', slug] as const,
}

function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Contador de cada aba — cinco pedidos com `limit=1`, só pelo `count`. */
export function useContagemAbas() {
  const resultados = useQueries({
    queries: ABAS.map((aba) => ({
      queryKey: [...chavesPortal.contagens, aba.id],
      queryFn: () => api.get<Paginado<TicketResumo>>(`/api/v1/tickets/?${query({ ...aba.params, limit: 1 })}`),
      staleTime: 30_000,
      select: (d: Paginado<TicketResumo>) => d.count,
    })),
  })
  const contagens = {} as Record<AbaTickets, number | undefined>
  ABAS.forEach((aba, i) => {
    contagens[aba.id] = resultados[i].data
  })
  return contagens
}

export function useTicketsCliente(p: ParamsTickets) {
  return useQuery({
    queryKey: chavesPortal.lista(p),
    queryFn: () => api.get<Paginado<TicketResumo>>(`/api/v1/tickets/?${paramsDaLista(p)}`),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/** Os últimos chamados abertos, para o Início. */
export function useTicketsRecentes(limite = 5) {
  return useQuery({
    queryKey: [...chavesPortal.recentes, limite],
    queryFn: () => api.get<Paginado<TicketResumo>>(`/api/v1/tickets/?${query({ ordering: '-criado', limit: limite })}`),
    staleTime: 15_000,
    select: (d) => d.results,
  })
}

export function useTicketCliente(id: number) {
  return useQuery({
    queryKey: chavesPortal.ticket(id),
    queryFn: () => api.get<TicketDetalhe>(`/api/v1/tickets/${id}/`),
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 10_000,
  })
}

export function useAvaliacoesPendentesTicket() {
  return useQuery({
    queryKey: chavesPortal.pendentes,
    queryFn: () => api.get<AvaliacaoPendenteTicket[]>('/api/v1/tickets/pending-ratings/'),
    staleTime: 30_000,
  })
}

export function useRespostasRapidas(contexto: 'ticket' | 'chat') {
  return useQuery({
    queryKey: chavesPortal.respostasRapidas(contexto),
    queryFn: () =>
      api.get<Paginado<RespostaRapida> | RespostaRapida[]>(`/api/v1/chat/quick-replies/?contexto=${contexto}&limit=50`),
    staleTime: 300_000,
    select: lista,
  })
}

export function useEstimativaEquipe(slug: string | null | undefined) {
  return useQuery({
    queryKey: chavesPortal.estimativa(slug ?? null),
    queryFn: () => api.get<EstimativaResposta>(`/api/v1/tickets/response-estimate/?team=${slug}`),
    enabled: !!slug,
    staleTime: 300_000,
  })
}

export function useEquipesCliente() {
  return useQuery({
    queryKey: ['equipes'],
    queryFn: () => api.get<Paginado<EquipeCliente> | EquipeCliente[]>('/api/v1/teams/'),
    staleTime: 300_000,
    select: lista,
  })
}

export function useCategoriasCliente() {
  return useQuery({
    queryKey: ['categorias'],
    queryFn: () => api.get<Paginado<CategoriaCliente> | CategoriaCliente[]>('/api/v1/categories/'),
    staleTime: 300_000,
    select: lista,
  })
}

// ---------------------------------------------------------------------------
// Escrita — toda ação devolve o TicketDetail atualizado: grava no cache e
// invalida o que muda de lugar (listas, contadores, avaliações pendentes).
// ---------------------------------------------------------------------------

function useGravarTicket() {
  const qc = useQueryClient()
  return (t: TicketDetalhe) => {
    qc.setQueryData(chavesPortal.ticket(t.id), t)
    qc.invalidateQueries({ queryKey: ['portal', 'tickets'] })
  }
}

export function useResponderTicket(id: number) {
  const gravar = useGravarTicket()
  return useMutation({
    mutationFn: ({ body, files }: { body: string; files?: File[] }) => {
      if (files && files.length > 0) {
        const fd = new FormData()
        fd.append('body', body)
        fd.append('is_public', 'true')
        files.forEach((f) => fd.append('files', f))
        return api.post<TicketDetalhe>(`/api/v1/tickets/${id}/reply/`, fd)
      }
      return api.post<TicketDetalhe>(`/api/v1/tickets/${id}/reply/`, { body, is_public: true })
    },
    onSuccess: gravar,
  })
}

export function useAvaliarTicket(id: number) {
  const gravar = useGravarTicket()
  return useMutation({
    mutationFn: (dados: { score: number; comment?: string }) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/rate/`, dados),
    onSuccess: gravar,
  })
}

/** Mesma rota `/close/` do agente — sem `resolution_started_at`/`ended_at`
 *  (D4): o backend reconhece pelo `is_internal` de quem chama e pede só
 *  o resumo do trabalho técnico de quem atende, nunca do cliente. */
export function useEncerrarTicket(id: number) {
  const gravar = useGravarTicket()
  return useMutation({
    mutationFn: (dados: { note?: string } = {}) =>
      api.post<TicketDetalhe>(`/api/v1/tickets/${id}/close/`, dados),
    onSuccess: gravar,
  })
}

/** Editar/excluir a PRÓPRIA mensagem — o backend só deixa o autor (`can_edit`). */
export function useMensagemTicket(ticketId: number) {
  const qc = useQueryClient()
  const recarregar = () => qc.invalidateQueries({ queryKey: chavesPortal.ticket(ticketId) })
  const editar = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      api.patch<unknown>(`/api/v1/tickets/${ticketId}/messages/${id}/`, { body }),
    onSuccess: recarregar,
  })
  const excluir = useMutation({
    mutationFn: (id: number) => api.delete<unknown>(`/api/v1/tickets/${ticketId}/messages/${id}/`),
    onSuccess: recarregar,
  })
  return { editar, excluir }
}

export interface NovoTicketCliente {
  team_id: number
  subject: string
  body: string
  category_id?: number | null
  order_number?: string
  arquivos?: File[]
}

/** Abertura pelo cliente — consome cota (o 422 traz a mensagem pronta). */
export function useAbrirTicketCliente() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ arquivos, ...dados }: NovoTicketCliente) => {
      if (arquivos?.length) {
        const fd = new FormData()
        fd.append('team_id', String(dados.team_id))
        fd.append('subject', dados.subject)
        fd.append('body', dados.body)
        if (dados.category_id != null) fd.append('category_id', String(dados.category_id))
        if (dados.order_number) fd.append('order_number', dados.order_number)
        arquivos.forEach((f) => fd.append('files', f))
        return api.post<TicketDetalhe>('/api/v1/tickets/', fd)
      }
      return api.post<TicketDetalhe>('/api/v1/tickets/', dados)
    },
    onSuccess: (t) => {
      qc.setQueryData(chavesPortal.ticket(t.id), t)
      qc.invalidateQueries({ queryKey: ['portal', 'tickets'] })
    },
  })
}

/**
 * Transcrição em PDF (`GET /tickets/{id}/export/`). Vai por `fetch` com
 * cookie, não por link: assim um 501 (servidor sem o gerador de PDF) ou 403
 * vira mensagem na tela em vez de uma aba em branco.
 */
export async function baixarPdfDoTicket(id: number, referencia: string): Promise<void> {
  const resp = await fetch(`${API_BASE_URL}/api/v1/tickets/${id}/export/`, { credentials: 'include' })
  if (!resp.ok) {
    let corpo: unknown = null
    try {
      corpo = await resp.json()
    } catch {
      /* sem corpo */
    }
    throw new ApiError(resp.status, corpo ?? { detail: 'Não foi possível gerar o PDF.' })
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${referencia}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
