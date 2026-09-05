import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, type Paginado } from '@/api/client'

/**
 * Dados do chat v2 — compartilhado pelo console do agente (resolv/chat) e
 * pelo lado do cliente (features/chat). Tipos recortados do contrato real
 * (`apps/chat/serializers.py`), não de memória.
 *
 * As CHAVES de cache são contrato com realtime/bridge.ts: é por elas que
 * um evento de socket invalida ou atualiza o que a tela está mostrando.
 */

export type StatusChat = 'queued' | 'active' | 'closed'

export interface ArquivoChat {
  id: number
  filename: string
  content_type: string
  size_bytes: number
  scan_status: 'pending' | 'clean' | 'infected' | 'error' | 'skipped'
  url: string
  is_downloadable: boolean
}

export interface MensagemChat {
  id: number
  author_name: string
  author_is_internal: boolean
  /** Já censurada pelo backend — os dois lados veem a mesma coisa. */
  body: string
  is_system: boolean
  sent_at: string
  read_at: string | null
  files: ArquivoChat[]
  edited_at: string | null
  is_deleted: boolean
  can_edit: boolean
}

export interface AvaliacaoChat {
  service_score: number
  resolution_score: number
  justification: string
  created_at: string
}

export interface Chat {
  id: number
  status: StatusChat
  /** Nome interno — o cliente recebe sempre "" (mascarado no serializer). */
  name: string
  client_id: number
  client_name: string
  client_email: string
  client_phone: string
  client_avatar: string | null
  company_name: string
  agent_name: string | null
  agent_id: number | null
  agent_avatar: string | null
  category: number | null
  category_name: string | null
  priority: string
  assignee: number | null
  assignee_name: string | null
  tag_ids: number[]
  queued_at: string
  accepted_at: string | null
  closed_at: string | null
  reopen_count: number
  /** Nota interna do agente sobre o atendimento — só chega para interno. */
  agent_score?: number | null
  timeout_converted: boolean
  unread_count: number
  last_message_preview: string | null
  rating: AvaliacaoChat | null
  rating_pending: boolean
  ticket_id: number | null
  ticket_reference: string | null
  ws_url: string
}

export interface ConfigChat {
  welcome_message: string
  score_min: number
  score_max: number
  low_score_threshold: number
  queue_open: boolean
  queue_opens_at: string | null
  // só para interno
  queue_timeout_minutes?: number
  max_chats_per_agent?: number
  default_team?: number | null
  default_team_name?: string | null
}

export interface Agente {
  id: number
  full_name: string
  email: string
  kind: 'internal' | 'client'
  internal_role: string
  company: number | null
  presence: 'available' | 'away' | 'offline'
}

export interface Equipe {
  id: number
  name: string
  slug: string
  visibility: string
  order: number
}

export const chaves = {
  fila: ['chat', 'fila'] as const,
  meus: ['chat', 'meus'] as const,
  meuVivo: ['chat', 'meu-vivo'] as const,
  pendentes: ['chat', 'pending-ratings'] as const,
  config: ['chat', 'config'] as const,
  chat: (id: number) => ['chat', id] as const,
  mensagens: (id: number) => ['chat', id, 'messages'] as const,
}

const lista = <T,>(d: Paginado<T> | T[]): T[] => (Array.isArray(d) ? d : d.results)

/** Quantas mensagens abrir de uma vez — o resto vem por `before`. */
export const LIMITE_MENSAGENS = 100

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** A fila (chats esperando) — o mesmo recorte que o backend manda pelo
 *  socket, só que completa. `refetchInterval` é rede de segurança para
 *  socket caído; o caminho normal é a invalidação pela bridge. */
export function useFilaChat(habilitado = true) {
  return useQuery({
    queryKey: chaves.fila,
    queryFn: () => api.get<Paginado<Chat> | Chat[]>('/api/v1/chat/chats/?status=queued&limit=100'),
    select: lista,
    enabled: habilitado,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useMeusChats(habilitado = true) {
  return useQuery({
    queryKey: chaves.meus,
    queryFn: () => api.get<Paginado<Chat> | Chat[]>('/api/v1/chat/chats/?status=active&mine=1&limit=100'),
    select: lista,
    enabled: habilitado,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

/** O chat vivo (fila ou em atendimento) do CLIENTE logado — ou null. Para
 *  o cliente a listagem já é só a dele, então basta procurar o não fechado. */
export function useMeuChatVivo() {
  return useQuery({
    queryKey: chaves.meuVivo,
    queryFn: () => api.get<Paginado<Chat> | Chat[]>('/api/v1/chat/chats/?limit=10'),
    select: (d) => lista(d).find((c) => c.status !== 'closed') ?? null,
    staleTime: 10_000,
  })
}

export function useChat(id: number | null) {
  return useQuery({
    queryKey: chaves.chat(id ?? 0),
    queryFn: () => api.get<Chat>(`/api/v1/chat/chats/${id}/`),
    enabled: id != null,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  })
}

export function useMensagensChat(id: number | null) {
  return useQuery({
    queryKey: chaves.mensagens(id ?? 0),
    queryFn: () =>
      api.get<MensagemChat[]>(`/api/v1/chat/chats/${id}/messages/?limit=${LIMITE_MENSAGENS}`),
    enabled: id != null,
    // o socket mantém isto vivo; o refetch ao focar é a rede de segurança
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })
}

export function usePendingRatings(habilitado = true) {
  return useQuery({
    queryKey: chaves.pendentes,
    queryFn: () => api.get<Chat[]>('/api/v1/chat/chats/pending-ratings/'),
    enabled: habilitado,
    staleTime: 10_000,
  })
}

export function useConfigChat() {
  return useQuery({
    queryKey: chaves.config,
    queryFn: () => api.get<ConfigChat>('/api/v1/chat/config/'),
    staleTime: 60_000,
  })
}

export function useAgentes() {
  return useQuery({
    queryKey: ['users', 'internos'],
    queryFn: () => api.get<Paginado<Agente> | Agente[]>('/api/v1/users/?limit=200'),
    select: lista,
    staleTime: 60_000,
  })
}

export function useEquipes() {
  return useQuery({
    queryKey: ['equipes'],
    queryFn: () => api.get<Paginado<Equipe> | Equipe[]>('/api/v1/teams/?limit=100'),
    select: lista,
    staleTime: 300_000,
  })
}

// ---------------------------------------------------------------------------
// Cache de mensagens — usado pelo REST (anexo) e pela bridge (socket)
// ---------------------------------------------------------------------------

/** Põe (ou substitui, pelo id) uma mensagem no cache da conversa. Sem cache
 *  ainda carregado não faz nada: o fetch inicial trará tudo. */
export function anexarMensagemNoCache(qc: QueryClient, chatId: number, msg: MensagemChat) {
  qc.setQueryData<MensagemChat[]>(chaves.mensagens(chatId), (atual) => {
    if (!atual) return atual
    if (atual.some((m) => m.id === msg.id)) return atual.map((m) => (m.id === msg.id ? msg : m))
    return [...atual, msg].sort((a, b) => a.id - b.id)
  })
}

/**
 * Reconexão: busca por REST o que o socket pode ter deixado passar
 * (`?after=<último id visto>`) e reconfere o estado do chat — enquanto a
 * conexão esteve fora ele pode ter sido pego, encerrado ou convertido.
 * Nunca confia que o socket entregou tudo.
 */
export async function recuperarMensagensPerdidas(qc: QueryClient, chatId: number) {
  const atual = qc.getQueryData<MensagemChat[]>(chaves.mensagens(chatId))
  if (!atual || atual.length === 0) {
    await qc.invalidateQueries({ queryKey: chaves.mensagens(chatId) })
  } else {
    const ultimo = atual[atual.length - 1].id
    const novas = await api.get<MensagemChat[]>(
      `/api/v1/chat/chats/${chatId}/messages/?after=${ultimo}`,
    )
    for (const m of novas) anexarMensagemNoCache(qc, chatId, m)
  }
  await qc.invalidateQueries({ queryKey: chaves.chat(chatId), exact: true })
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

function gravarChat(qc: QueryClient, chat: Chat) {
  qc.setQueryData(chaves.chat(chat.id), chat)
}

function invalidarListas(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: chaves.fila })
  void qc.invalidateQueries({ queryKey: chaves.meus })
  void qc.invalidateQueries({ queryKey: chaves.meuVivo })
}

/** Cliente abre (ou retoma) a conversa. O 400 traz `code`
 *  (`fora_do_expediente`) ou `pending_ratings` — ver `pendentesDoErro`. */
export function useAbrirChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Chat>('/api/v1/chat/chats/'),
    // `meuVivo` tem `select` sobre a LISTA — gravar o chat cru ali quebraria
    // o select; invalidar refaz a lista e o select acha o chat vivo
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
    },
  })
}

/** O backend devolve os chats sem nota junto do erro de abertura — o front
 *  força a avaliação antes de tentar de novo. `ApiError` guarda as chaves
 *  com valor-lista em `fieldErrors`; `pending_ratings` é uma delas. */
export function pendentesDoErro(err: unknown): Chat[] {
  if (!(err instanceof ApiError) || !err.fieldErrors) return []
  const bruto = (err.fieldErrors as Record<string, unknown>).pending_ratings
  return Array.isArray(bruto) ? (bruto as Chat[]) : []
}

export function usePegarChat() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (chatId: number) => api.post<Chat>(`/api/v1/chat/chats/${chatId}/take/`),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
    },
  })
}

export function useTransferirChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agent_id: number) =>
      api.post<Chat>(`/api/v1/chat/chats/${chatId}/transfer/`, { agent_id }),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
    },
  })
}

export function useEncerrarChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agent_score?: number | null) =>
      api.post<Chat>(`/api/v1/chat/chats/${chatId}/close/`, { agent_score: agent_score ?? null }),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
      void qc.invalidateQueries({ queryKey: chaves.pendentes })
    },
  })
}

export function useReabrirChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Chat>(`/api/v1/chat/chats/${chatId}/reopen/`),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
    },
  })
}

export function useConverterChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (team_id: number) =>
      api.post<Chat & { ticket_id: number; ticket_reference: string }>(
        `/api/v1/chat/chats/${chatId}/convert/`,
        { team_id },
      ),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      invalidarListas(qc)
      void qc.invalidateQueries({ queryKey: ['tickets'] })
    },
  })
}

export interface AvaliacaoInput {
  service_score: number
  resolution_score: number
  justification: string
}

export function useAvaliarChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dados: AvaliacaoInput) =>
      api.post<Chat>(`/api/v1/chat/chats/${chatId}/rate/`, dados),
    onSuccess: (chat) => {
      gravarChat(qc, chat)
      void qc.invalidateQueries({ queryKey: chaves.pendentes })
      void qc.invalidateQueries({ queryKey: chaves.meuVivo })
    },
  })
}

/** Anexo por REST — funciona com o socket caído de propósito (a mensagem
 *  de texto passa pelo socket; o arquivo nunca dependeu dele). */
export function useEnviarArquivos(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ arquivos, texto }: { arquivos: File[]; texto?: string }) => {
      const form = new FormData()
      for (const f of arquivos) form.append('files', f)
      if (texto) form.append('body', texto)
      return api.post<MensagemChat>(`/api/v1/chat/chats/${chatId}/files/`, form)
    },
    // o socket também vai entregar esta mensagem (o backend faz o mesmo
    // group_send do texto) — anexar aqui só antecipa, e o id deduplica
    onSuccess: (msg) => anexarMensagemNoCache(qc, chatId, msg),
  })
}

export function useMarcarLidas(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ marked_read: number }>(`/api/v1/chat/chats/${chatId}/read/`),
    onSuccess: (r) => {
      if (r.marked_read > 0) void qc.invalidateQueries({ queryKey: chaves.meus })
    },
  })
}

/**
 * Editar/excluir a PRÓPRIA mensagem (`can_edit`, checado pelo servidor: só
 * o autor, mensagem não apagada). O socket também entrega o evento
 * `message_edited`/`message_deleted` pela sala — a resposta HTTP aqui só
 * antecipa (o id deduplica em `anexarMensagemNoCache`).
 */
export function useEditarMensagemChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) =>
      api.patch<MensagemChat>(`/api/v1/chat/chats/${chatId}/messages/${id}/`, { body }),
    onSuccess: (msg) => anexarMensagemNoCache(qc, chatId, msg),
  })
}

export function useExcluirMensagemChat(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete<MensagemChat>(`/api/v1/chat/chats/${chatId}/messages/${id}/`),
    onSuccess: (msg) => anexarMensagemNoCache(qc, chatId, msg),
  })
}

/** "Carregar anteriores": as N mensagens antes da mais antiga já em tela.
 *  Devolve quantas vieram — zero é o sinal de que não há mais. */
export function useCarregarAnteriores(chatId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const atual = qc.getQueryData<MensagemChat[]>(chaves.mensagens(chatId)) ?? []
      if (atual.length === 0) return 0
      const anteriores = await api.get<MensagemChat[]>(
        `/api/v1/chat/chats/${chatId}/messages/?before=${atual[0].id}&limit=${LIMITE_MENSAGENS}`,
      )
      if (anteriores.length > 0) {
        qc.setQueryData<MensagemChat[]>(chaves.mensagens(chatId), (lista) => {
          const ids = new Set((lista ?? []).map((m) => m.id))
          return [...anteriores.filter((m) => !ids.has(m.id)), ...(lista ?? [])]
        })
      }
      return anteriores.length
    },
  })
}
