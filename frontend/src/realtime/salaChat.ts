import { criarSocket, type Socket, type StatusSocket } from './socket'
import type { EventoServidorChat, MensagemClienteChat } from './types'

/**
 * Registro de sockets de SALA (ws/chat/<id>/) — um por chat, fora do React.
 *
 * O canal pessoal (bridge.ts) já era singleton; o de sala vivia dentro de um
 * `useEffect` com cleanup, e o StrictMode do React (dev) monta, desmonta e
 * monta de novo o mesmo componente no mesmo tick — o que virava fechar e
 * reabrir o handshake, com o backend enxergando dois connects e o cliente
 * perdendo o que chegou no intervalo. Aqui a conexão é contada por
 * assinante: o segundo `entrarNaSala` do mesmo chat reencontra a conexão
 * aberta, e a última saída só desconecta depois de um respiro — tempo de
 * sobra pro remonte do StrictMode reaproveitar em vez de derrubar.
 *
 * O socket continua sendo transporte, não verdade: quem assina recebe o
 * status e, numa reconexão, é quem busca por REST o que ficou pra trás
 * (`?after=<último id>` — ver useSalaChat.ts).
 */

export interface AssinanteSala {
  onEvento: (evento: EventoServidorChat) => void
  onStatus: (status: StatusSocket) => void
}

export interface Assinatura {
  enviar: (mensagem: MensagemClienteChat) => void
  sair: () => void
}

interface Sala {
  socket?: Socket
  assinantes: Set<AssinanteSala>
  status: StatusSocket
}

const salas = new Map<number, Sala>()

// quanto esperar antes de fechar uma sala sem assinantes — mais que o
// remonte síncrono do StrictMode, menos que qualquer percepção humana
const RESPIRO_ANTES_DE_FECHAR_MS = 250

export function entrarNaSala(chatId: number, assinante: AssinanteSala): Assinatura {
  let sala = salas.get(chatId)
  if (!sala) {
    const nova: Sala = { assinantes: new Set(), status: 'conectando' }
    salas.set(chatId, nova)
    nova.socket = criarSocket<EventoServidorChat>({
      path: `/ws/chat/${chatId}/`,
      onEvento: (evento) => {
        for (const a of nova.assinantes) a.onEvento(evento)
      },
      onStatus: (status) => {
        nova.status = status
        for (const a of nova.assinantes) a.onStatus(status)
      },
    })
    sala = nova
  }
  const salaAtual = sala
  salaAtual.assinantes.add(assinante)
  // quem entra depois do handshake precisa do status atual, não só do próximo
  assinante.onStatus(salaAtual.status)

  return {
    enviar: (mensagem) => salaAtual.socket?.enviar(mensagem),
    sair: () => {
      salaAtual.assinantes.delete(assinante)
      if (salaAtual.assinantes.size > 0) return
      setTimeout(() => {
        const ainda = salas.get(chatId)
        if (ainda === salaAtual && ainda.assinantes.size === 0) {
          ainda.socket?.desconectar()
          salas.delete(chatId)
        }
      }, RESPIRO_ANTES_DE_FECHAR_MS)
    },
  }
}

/** Só para teste: quantas salas estão abertas agora. */
export function salasAbertas(): number {
  return salas.size
}
