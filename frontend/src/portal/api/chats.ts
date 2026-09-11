import { useQueries, useQuery } from '@tanstack/react-query'
import { API_BASE_URL, api, type Paginado } from '@/api/client'
import type { AvaliacaoChat, Chat, MensagemChat, StatusChat } from '@/api/chat'

function lista<T>(d: Paginado<T> | T[]): T[] {
  return Array.isArray(d) ? d : d.results
}

/** As conversas do cliente (o backend já recorta pelo próprio usuário). */
export function useChatsRecentes(limite = 5) {
  return useQuery({
    queryKey: ['portal', 'chats', 'recentes', limite],
    queryFn: () => api.get<Paginado<Chat> | Chat[]>(`/api/v1/chat/chats/?limit=${limite}`),
    staleTime: 15_000,
    select: lista,
  })
}

/** Histórico — só as encerradas, mais recentes primeiro (é o que a
 *  listagem já devolve por padrão, `-queued_at`). */
export function useHistoricoChats(limite = 30) {
  return useQuery({
    queryKey: ['portal', 'chats', 'historico', limite],
    queryFn: () => api.get<Paginado<Chat> | Chat[]>(`/api/v1/chat/chats/?status=closed&limit=${limite}`),
    staleTime: 15_000,
    select: lista,
  })
}

/** Quantas conversas estão vivas agora (na fila ou em atendimento). */
export function useContagemChatsAtivos() {
  return useQuery({
    queryKey: ['portal', 'chats', 'ativos'],
    queryFn: async () => {
      const [ativos, fila] = await Promise.all([
        api.get<Paginado<Chat> | Chat[]>('/api/v1/chat/chats/?status=active&limit=1'),
        api.get<Paginado<Chat> | Chat[]>('/api/v1/chat/chats/?status=queued&limit=1'),
      ])
      const contar = (d: Paginado<Chat> | Chat[]) => (Array.isArray(d) ? d.length : d.count)
      return contar(ativos) + contar(fila)
    },
    staleTime: 15_000,
  })
}

// --------------------------------------------------------------------------
// Conversa contínua — ChatTimelineView (apps/chat/views.py). Todas as sessões
// de chat do cliente costuradas numa linha só, na ORDEM em que aconteceram —
// "reabrir" reaproveita o mesmo chat (histórico já contínuo ali), mas "novo
// chat" cria uma sessão à parte; esta tela costura as duas coisas na leitura.
// --------------------------------------------------------------------------

export interface MensagemLinhaDoTempo extends MensagemChat {
  /** De qual sessão (Chat) veio — é o que marca onde um atendimento termina
   *  e o próximo começa (`ChatTimelineMessageSerializer`). */
  chat_id: number
}

export interface SessaoLinhaDoTempo {
  id: number
  status: StatusChat
  queued_at: string
  closed_at: string | null
  agent_name: string | null
  rating: AvaliacaoChat | null
  close_reason_name: string | null
  /** Quando o atendimento virou chamado: é o protocolo que a pessoa procura
   *  depois, não o número do chat. */
  ticket_reference: string | null
}

export interface PaginaLinhaDoTempo {
  messages: MensagemLinhaDoTempo[]
  sessions: SessaoLinhaDoTempo[]
  has_more: boolean
}

const LIMITE_LINHA_DO_TEMPO = 60

function opcoesPaginaLinhaDoTempo(before: number | undefined, q: string, clientId?: number) {
  const params = new URLSearchParams({ limit: String(LIMITE_LINHA_DO_TEMPO) })
  if (before) params.set('before', String(before))
  if (q) params.set('q', q)
  // `?client=` é a leitura do CONSOLE: a mesma conversa costurada, só que de
  // outra pessoa. Sem ele, é a de quem pede — o portal, como sempre.
  if (clientId != null) params.set('client', String(clientId))
  return {
    queryKey: ['portal', 'chats', 'continua', clientId ?? 'eu', before ?? null, q],
    queryFn: () => api.get<PaginaLinhaDoTempo>(`/api/v1/chat/timeline/?${params.toString()}`),
    staleTime: 15_000,
  }
}

/**
 * `cursores` cresce por `carregarMais()` — cada posição é o `before` de uma
 * página já pedida, da mais recente (undefined, índice 0) para trás. Sem
 * `useQueries` isso precisaria de um `useEffect` acumulando mensagens em
 * estado próprio; aqui o cache do React Query já é o acumulador, e cada
 * página velha fica disponível para reordenar sem refazer a chamada.
 */
export function useConversaContinua(cursores: (number | undefined)[], q = '', clientId?: number) {
  const paginas = useQueries({
    queries: cursores.map((before) => opcoesPaginaLinhaDoTempo(before, q, clientId)),
  })

  const carregando = paginas.some((p) => p.isLoading)
  const erro = paginas.find((p) => p.isError)?.error

  // cursores[0] é o mais recente; a ordem cronológica é do mais antigo pro
  // mais novo, ou seja, o inverso de `cursores`.
  const carregadas = [...paginas].reverse().map((p) => p.data).filter((d): d is PaginaLinhaDoTempo => d != null)
  const mensagens = carregadas.flatMap((p) => p.messages)

  const sessoesPorId = new Map<number, SessaoLinhaDoTempo>()
  for (const pagina of carregadas) for (const sessao of pagina.sessions) sessoesPorId.set(sessao.id, sessao)
  const sessoes = [...sessoesPorId.values()].sort((a, b) => a.id - b.id)

  // se ainda falta carregar a página mais antiga, não dá pra saber se há mais
  // — só confia no `has_more` de quem é, hoje, a ponta mais antiga já carregada
  const ultimaPagina = paginas[paginas.length - 1]
  const temMais = ultimaPagina?.data?.has_more ?? false

  return { mensagens, sessoes, carregando, erro, temMais }
}

export function urlExportarConversaContinua(): string {
  return `${API_BASE_URL}/api/v1/chat/timeline/export/`
}
