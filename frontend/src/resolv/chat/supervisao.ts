import { useMutation, useQueryClient } from '@tanstack/react-query'
import { chaves, type Chat } from '@/api/chat'
import { api } from '@/api/client'
import type { Me } from '@/api/types'

/**
 * Supervisão no console: ENTRAR na conversa de outro agente (escreve junto,
 * o atendimento continua do dono), SAIR dela e ASSUMIR o atendimento (a
 * conversa passa a ser de quem assume). Endpoints em apps/chat/views.py
 * (`join`, `leave`, `assume`); a regra de quem pode e do limite de
 * simultâneos é do serviço (`chat_service.join_chat`/`assume_chat`).
 *
 * Arquivo à parte de `./dados` de propósito: os testes das telas de conversa
 * simulam aquele módulo inteiro, e um hook novo lá dentro faria cada um
 * deles quebrar por um motivo que não é o que testam.
 */

export interface Participante {
  id: number
  full_name: string
}

/** Os dois campos que o backend acrescentou ao `Chat` para a supervisão.
 *  Opcionais: respostas antigas em cache (e os testes das outras telas) não
 *  os trazem, e ausente quer dizer "ninguém entrou" e "não pode". */
export type ChatComSupervisao = Chat & {
  participants?: Participante[]
  can_supervise?: boolean
}

/** O que a pessoa logada pode fazer NESTA conversa, do ponto de vista da
 *  supervisão — derivado do que o servidor mandou, sem regra de papel aqui. */
export function supervisaoDe(chat: Chat, me: Me | undefined) {
  const c = chat as ChatComSupervisao
  const participantes = c.participants ?? []
  const souOAgente = me != null && chat.agent_id === me.id
  const participo = me != null && participantes.some((p) => p.id === me.id)
  const ativo = chat.status === 'active'
  const podeSupervisionar = c.can_supervise === true && ativo && !souOAgente
  return {
    participantes,
    souOAgente,
    participo,
    /** escreve quem atende e quem entrou — o mesmo que `can_send` aceita */
    podeEscrever: ativo && (souOAgente || participo),
    podeEntrar: podeSupervisionar && !participo,
    podeAssumir: podeSupervisionar,
  }
}

function useAcaoDeSupervisao(chatId: number, caminho: 'join' | 'leave' | 'assume') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Chat>(`/api/v1/chat/chats/${chatId}/${caminho}/`),
    onSuccess: (chat) => {
      qc.setQueryData(chaves.chat(chat.id), chat)
      // a mensagem de sistema ("fulano entrou") já chega pela sala; o
      // refetch é a rede de segurança para quem está sem socket
      void qc.invalidateQueries({ queryKey: chaves.mensagens(chat.id) })
      void qc.invalidateQueries({ queryKey: chaves.meus })
      void qc.invalidateQueries({ queryKey: chaves.clientes })
    },
  })
}

export const useEntrarNaConversa = (chatId: number) => useAcaoDeSupervisao(chatId, 'join')
export const useSairDaConversa = (chatId: number) => useAcaoDeSupervisao(chatId, 'leave')
export const useAssumirAtendimento = (chatId: number) => useAcaoDeSupervisao(chatId, 'assume')
