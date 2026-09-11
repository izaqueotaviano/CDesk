import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { entrarNaSala, salasAbertas } from './salaChat'
import type { StatusSocket } from './socket'

/** WebSocket de mentira: registra instâncias e deixa o teste abrir/derrubar. */
class FakeWebSocket {
  static instancias: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  enviados: string[] = []
  fechado = false

  constructor(public url: string) {
    FakeWebSocket.instancias.push(this)
  }
  send(d: string) {
    this.enviados.push(d)
  }
  close() {
    this.fechado = true
    this.readyState = 3
    this.onclose?.()
  }
  abrir() {
    this.readyState = 1
    this.onopen?.()
  }
  cair() {
    this.readyState = 3
    this.onclose?.()
  }
}

function assinante() {
  const status: StatusSocket[] = []
  const eventos: unknown[] = []
  return {
    status,
    eventos,
    onStatus: (s: StatusSocket) => status.push(s),
    onEvento: (e: unknown) => eventos.push(e),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instancias = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('entrarNaSala — uma conexão por chat, fora do React', () => {
  it('duas assinaturas do mesmo chat compartilham UMA conexão (StrictMode não abre duas)', () => {
    const a = assinante()
    const b = assinante()
    const s1 = entrarNaSala(1, a)
    const s2 = entrarNaSala(1, b)

    expect(FakeWebSocket.instancias).toHaveLength(1)
    expect(FakeWebSocket.instancias[0].url).toMatch(/\/ws\/chat\/1\/$/)

    FakeWebSocket.instancias[0].abrir()
    expect(a.status).toEqual(['conectando', 'aberto'])
    expect(b.status).toEqual(['conectando', 'aberto'])

    FakeWebSocket.instancias[0].onmessage?.({ data: JSON.stringify({ type: 'pong' }) })
    expect(a.eventos).toEqual([{ type: 'pong' }])
    expect(b.eventos).toEqual([{ type: 'pong' }])

    s1.sair()
    s2.sair()
    vi.advanceTimersByTime(300)
    expect(FakeWebSocket.instancias[0].fechado).toBe(true)
    expect(salasAbertas()).toBe(0)
  })

  it('sair e voltar dentro do respiro reaproveita a conexão (o remonte do StrictMode)', () => {
    const s1 = entrarNaSala(2, assinante())
    s1.sair()
    const s2 = entrarNaSala(2, assinante())
    vi.advanceTimersByTime(300)

    expect(FakeWebSocket.instancias).toHaveLength(1)
    expect(FakeWebSocket.instancias[0].fechado).toBe(false)
    s2.sair()
  })

  it('chats diferentes têm conexões diferentes', () => {
    const s1 = entrarNaSala(3, assinante())
    const s2 = entrarNaSala(4, assinante())
    expect(FakeWebSocket.instancias).toHaveLength(2)
    expect(salasAbertas()).toBe(2)
    s1.sair()
    s2.sair()
  })

  it('queda de conexão: avisa "fechado" e reconecta com backoff exponencial', () => {
    const a = assinante()
    const s = entrarNaSala(5, a)
    FakeWebSocket.instancias[0].abrir()
    FakeWebSocket.instancias[0].cair()
    expect(a.status.at(-1)).toBe('fechado')

    // 1ª tentativa: 2s (1000 * 2**1)
    vi.advanceTimersByTime(1999)
    expect(FakeWebSocket.instancias).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instancias).toHaveLength(2)
    expect(a.status.at(-1)).toBe('conectando')

    FakeWebSocket.instancias[1].abrir()
    expect(a.status.at(-1)).toBe('aberto')

    // enviar vai pela conexão NOVA
    s.enviar({ type: 'ping' })
    expect(FakeWebSocket.instancias[1].enviados).toEqual([JSON.stringify({ type: 'ping' })])
    s.sair()
  })

  it('quem assina depois do handshake recebe o status atual na hora', () => {
    const a = assinante()
    const s1 = entrarNaSala(6, a)
    FakeWebSocket.instancias[0].abrir()

    const b = assinante()
    const s2 = entrarNaSala(6, b)
    expect(b.status).toEqual(['aberto'])
    s1.sair()
    s2.sair()
  })
})
