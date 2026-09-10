import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { aplicarEventoChat } from './bridge'
import { criarSocket, type Socket } from './socket'
import type { EventoServidorChat, MensagemClienteChat } from './types'

/**
 * Socket de UM painel de chat aberto — ciclo de vida diferente do canal
 * pessoal: "enquanto um painel de conversa estiver aberto" (docs/10-frontend-novo.md),
 * não a sessão inteira. Por isso conecta no efeito e desconecta no cleanup,
 * em vez de ser singleton.
 */
export function useChatSocket(chatId: number | null) {
  const queryClient = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (chatId == null) return

    const socket = criarSocket<EventoServidorChat>({
      path: `/ws/chat/${chatId}/`,
      onEvento: (evento) => aplicarEventoChat(evento, chatId, queryClient),
    })
    socketRef.current = socket

    return () => {
      socket.desconectar()
      socketRef.current = null
    }
    // queryClient tem identidade estável; só chatId deve reabrir a conexão.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  return {
    enviarMensagem: (body: string) =>
      socketRef.current?.enviar({ type: 'message', body } satisfies MensagemClienteChat),
    enviarDigitando: (is_typing: boolean) =>
      socketRef.current?.enviar({ type: 'typing', is_typing } satisfies MensagemClienteChat),
  }
}
