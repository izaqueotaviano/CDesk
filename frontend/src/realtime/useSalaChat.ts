import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { recuperarMensagensPerdidas } from '@/api/chat'
import { aplicarEventoChat } from './bridge'
import { entrarNaSala, type Assinatura } from './salaChat'
import type { StatusSocket } from './socket'
import type { MensagemClienteChat } from './types'

/** Quanto tempo "fulano está digitando" fica na tela sem um novo sinal. */
const DIGITANDO_EXPIRA_MS = 3_000

export interface Digitando {
  user_id: number
  user_name: string
}

/**
 * Uma conversa aberta na tela: assina a sala (registro singleton fora do
 * React — ver salaChat.ts), aplica os eventos no cache e, quando a
 * conexão VOLTA depois de cair, busca por REST o que ficou pra trás.
 *
 * `status` é o que o compositor usa pra travar o envio de TEXTO sem
 * conexão; anexo continua indo por REST, socket caído ou não.
 */
export function useSalaChat(chatId: number | null) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StatusSocket>('conectando')
  const [digitando, setDigitando] = useState<Digitando | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const assinaturaRef = useRef<Assinatura | null>(null)
  const timerDigitando = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (chatId == null) return
    // "já esteve aberto NESTA assinatura" — é o que distingue a primeira
    // conexão (o fetch inicial cobre) de uma reconexão (precisa do ?after=)
    let jaAbriu = false

    const assinatura = entrarNaSala(chatId, {
      onEvento: (evento) => {
        if (evento.type === 'typing') {
          clearTimeout(timerDigitando.current)
          if (evento.is_typing) {
            setDigitando({ user_id: evento.user_id, user_name: evento.user_name })
            timerDigitando.current = setTimeout(() => setDigitando(null), DIGITANDO_EXPIRA_MS)
          } else {
            setDigitando(null)
          }
          return
        }
        if (evento.type === 'error') {
          setErro(evento.detail)
          return
        }
        aplicarEventoChat(evento, chatId, queryClient)
      },
      onStatus: (s) => {
        setStatus(s)
        if (s === 'aberto') {
          if (jaAbriu) void recuperarMensagensPerdidas(queryClient, chatId)
          jaAbriu = true
        }
      },
    })
    assinaturaRef.current = assinatura

    return () => {
      clearTimeout(timerDigitando.current)
      assinatura.sair()
      assinaturaRef.current = null
      setDigitando(null)
      setErro(null)
    }
  }, [chatId, queryClient])

  const enviarMensagem = useCallback((body: string) => {
    setErro(null)
    assinaturaRef.current?.enviar({ type: 'message', body } satisfies MensagemClienteChat)
  }, [])

  const enviarDigitando = useCallback((is_typing: boolean) => {
    assinaturaRef.current?.enviar({ type: 'typing', is_typing } satisfies MensagemClienteChat)
  }, [])

  return { status, digitando, erro, enviarMensagem, enviarDigitando }
}
