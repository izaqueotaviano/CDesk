import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type Paginado } from '@/api/client'

export interface Notificacao {
  id: number
  kind: string
  title: string
  body: string
  url: string
  ticket_id: number | null
  actor_name: string | null
  read_at: string | null
  created_at: string
}

/** `unread_count` vem embutido na paginação — não é um segundo endpoint
 *  (`apps.notifications.views.NotificationViewSet.list`). */
type RespostaNotificacoes = Paginado<Notificacao> & { unread_count: number }

/** Chave em `['notifications', ...]` de propósito: `realtime/bridge.ts` já
 *  invalida `queryKey: ['notifications']` a cada evento de socket
 *  (`type: 'notification'`) — o prefixo é o que faz esse fio, que já
 *  existia esperando um consumidor, funcionar sem mexer na bridge. */
export function useNotificacoes(apenasNaoLidas = false) {
  return useQuery({
    queryKey: ['notifications', 'list', apenasNaoLidas],
    queryFn: () =>
      api.get<RespostaNotificacoes>(`/api/v1/notifications/?limit=30${apenasNaoLidas ? '&unread=1' : ''}`),
    staleTime: 15_000,
    // A cada 60s de rede — o socket cobre o "agora", isto é a rede de
    // segurança se a conexão cair (mesmo padrão do detalhe do ticket).
    refetchInterval: 60_000,
  })
}

export function useMarcarNotificacaoLida() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.post<{ marked_read: number }>(`/api/v1/notifications/${id}/read/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarcarTodasLidas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ marked_read: number }>('/api/v1/notifications/read-all/'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
