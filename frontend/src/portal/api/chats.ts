import { useQuery } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'
import type { Chat } from '@/api/chat'

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
