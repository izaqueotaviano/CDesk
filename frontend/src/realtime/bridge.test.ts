import type { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { conectarCanalPessoal, desconectarCanalPessoal } from './bridge'

/** Mesma dublê de `salaChat.test.ts` — registra instâncias e deixa o teste
 *  abrir/derrubar sem precisar de um servidor de verdade. */
class FakeWebSocket {
  static instancias: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  fechado = false

  constructor(public url: string) {
    FakeWebSocket.instancias.push(this)
  }
  send() {}
  close() {
    this.fechado = true
    this.readyState = 3
    this.onclose?.()
  }
}

const queryClientFalso = { invalidateQueries: vi.fn(), setQueryData: vi.fn() } as unknown as QueryClient

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks() // as chaves invalidadas de um teste não contam no outro
  FakeWebSocket.instancias = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  desconectarCanalPessoal() // não vaza o singleton de um teste pro outro
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('canal pessoal — sobrevive à troca de usuário na mesma aba', () => {
  it('chamar de novo sem desconectar reaproveita o mesmo socket (comportamento de sempre)', () => {
    conectarCanalPessoal(queryClientFalso)
    conectarCanalPessoal(queryClientFalso)
    expect(FakeWebSocket.instancias).toHaveLength(1)
  })

  it('logout fecha o socket da pessoa que saiu e o próximo connect abre um novo', () => {
    conectarCanalPessoal(queryClientFalso)
    const antigo = FakeWebSocket.instancias[0]
    expect(antigo.fechado).toBe(false)

    desconectarCanalPessoal()
    expect(antigo.fechado).toBe(true)

    // pessoa B loga na mesma aba — sem o fix, isto devolveria o `antigo` morto
    conectarCanalPessoal(queryClientFalso)
    expect(FakeWebSocket.instancias).toHaveLength(2)
    expect(FakeWebSocket.instancias[1]).not.toBe(antigo)
  })

  it('desconectar sem nunca ter conectado não explode', () => {
    expect(() => desconectarCanalPessoal()).not.toThrow()
  })
})

/** Entrega um frame como o navegador entrega: JSON cru no `onmessage`. */
function receber(evento: unknown) {
  FakeWebSocket.instancias[0].onmessage?.({ data: JSON.stringify(evento) })
}

function invalidou(chave: unknown[]): boolean {
  return vi
    .mocked(queryClientFalso.invalidateQueries)
    .mock.calls.some(([filtro]) => JSON.stringify(filtro?.queryKey) === JSON.stringify(chave))
}

// Prefixo `['tickets']`: cobre a fila (`['tickets','lista',params]`) E as
// contagens da barra lateral (`['tickets','resumo']`). Invalidar só a lista
// deixava a gaveta dizendo "Não atribuídos 40" com a fila já esvaziada.
const CHAVE_DA_FILA = ['tickets']

describe('canal pessoal — a fila de tickets acompanha o que o sino avisa', () => {
  beforeEach(() => conectarCanalPessoal(queryClientFalso))

  it('chamado novo na equipe revalida a fila, não só o sino', () => {
    // é o único aviso que o agente da equipe recebe: a abertura não emite
    // `ticket_event` (ele só alcança solicitante/responsável/dono/seguidores)
    receber({ type: 'notification', kind: 'ticket_created', ticket_id: 7 })
    expect(invalidou(['notifications'])).toBe(true)
    expect(invalidou(CHAVE_DA_FILA)).toBe(true)
  })

  it('SLA estourado revalida a fila — o relógio da linha vem calculado do servidor', () => {
    receber({ type: 'notification', kind: 'sla_breached', ticket_id: 7 })
    expect(invalidou(CHAVE_DA_FILA)).toBe(true)
  })

  it('ticket atribuído NÃO pede a fila de novo: o `ticket_event` já cobre quem recebe', () => {
    receber({ type: 'notification', kind: 'ticket_assigned', ticket_id: 7 })
    expect(invalidou(['notifications'])).toBe(true)
    expect(invalidou(CHAVE_DA_FILA)).toBe(false)
  })

  it('notificação de chat não mexe na fila de tickets', () => {
    receber({ type: 'notification', kind: 'chat_message', chat_id: 3 })
    expect(invalidou(CHAVE_DA_FILA)).toBe(false)
  })

  it('`ticket_event` continua revalidando detalhe e fila (comportamento de sempre)', () => {
    receber({ type: 'ticket_event', ticket_id: 7, kind: 'reply' })
    expect(invalidou(['ticket', 7])).toBe(true)
    expect(invalidou(CHAVE_DA_FILA)).toBe(true)
  })
})
