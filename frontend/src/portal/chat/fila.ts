import { useEffect } from 'react'
import { quandoReabre } from '@/ui/reabertura'
import { useQueryClient } from '@tanstack/react-query'
import { chaves } from '@/api/chat'
import { entrarNaSala } from '@/realtime/salaChat'
import type { ChatDoCliente, PosicaoNaFila } from '../api/chats'

/** "cerca de 4 min", "cerca de 1 h", "cerca de 1 h 20 min". */
export function tempoEstimado(minutos: number): string {
  if (minutos < 60) return `cerca de ${minutos} min`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m ? `cerca de ${h} h ${m} min` : `cerca de ${h} h`
}

/**
 * O que a pessoa lê enquanto espera. Primeiro é "o próximo", não "o 1º":
 * é a frase que alguém diria no balcão. Sem estimativa (pouca base recente),
 * a posição fica sozinha, sem inventar número. Fila fechada troca o assunto:
 * ninguém vai pegar agora, então a frase diz quando volta e que a conversa
 * não se perdeu.
 */
export function textoDaFila(p: PosicaoNaFila): { titulo: string; detalhe: string | null; fechada: boolean } {
  if (!p.queue_open) {
    const lugar = p.position === 1 ? 'é a próxima' : `está em ${p.position}º lugar`
    return {
      titulo: 'Fora do horário de atendimento',
      detalhe: `Sua conversa continua na fila e ${lugar}.${
        p.queue_opens_at ? ` O atendimento volta ${quandoReabre(p.queue_opens_at)}.` : ''
      }`,
      fechada: true,
    }
  }
  return {
    titulo: p.position === 1 ? 'Você é o próximo da fila' : `Você é o ${p.position}º da fila`,
    detalhe: p.estimated_wait_minutes != null ? `Tempo estimado: ${tempoEstimado(p.estimated_wait_minutes)}` : null,
    fechada: false,
  }
}

/**
 * Mantém a posição viva no cache do chat enquanto ele está na fila.
 *
 * O backend manda `queue_position` pela sala do chat sempre que a fila anda
 * (alguém foi pego, desistiu, virou chamado). A sala já está aberta pela
 * conversa (`useSalaChat`); `entrarNaSala` reaproveita o mesmo socket, então
 * isto é um segundo ouvinte, não uma segunda conexão. O evento vai para a
 * bridge também, que o ignora — ela é do console e do portal, e a posição só
 * interessa aqui.
 *
 * Socket é dica: a cada 30 s o chat é relido por REST. Cobre socket caído e
 * a fila que FECHA com o relógio (o fim do expediente não é um evento).
 */
export function usePosicaoAoVivo(chatId: number | null, naFila: boolean) {
  const qc = useQueryClient()
  useEffect(() => {
    if (chatId == null || !naFila) return
    const assinatura = entrarNaSala(chatId, {
      onEvento: (evento) => {
        if (evento.type !== 'queue_position' || evento.chat_id !== chatId) return
        const { type: _tipo, chat_id: _id, ...posicao } = evento
        qc.setQueryData<ChatDoCliente>(chaves.chat(chatId), (c) =>
          c && c.status === 'queued' ? { ...c, queue_position: posicao } : c,
        )
      },
      onStatus: () => {},
    })
    const rede = setInterval(() => {
      void qc.invalidateQueries({ queryKey: chaves.chat(chatId), exact: true })
    }, 30_000)
    return () => {
      assinatura.sair()
      clearInterval(rede)
    }
  }, [chatId, naFila, qc])
}
