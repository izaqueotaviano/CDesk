import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarSocket, urlBaseDoSocket, type StatusSocket } from './socket'

class FakeWebSocket {
  static instancias: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e?: { code: number }) => void) | null = null
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
    this.onclose?.({ code: 1005 })
  }
  abrir() {
    this.readyState = 1
    this.onopen?.()
  }
  cair(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code })
  }
}

function assinante() {
  const status: StatusSocket[] = []
  return { status, onStatus: (s: StatusSocket) => status.push(s), onEvento: () => {} }
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
  vi.unstubAllEnvs()
})

describe('urlBaseDoSocket — de onde vem o WebSocket', () => {
  it('em produção sem variável nenhuma, usa a origem da própria página', () => {
    vi.stubEnv('VITE_WS_BASE_URL', '')
    vi.stubEnv('VITE_API_BASE_URL', '')
    vi.stubEnv('DEV', false)
    // jsdom: http://localhost:3000 por padrão
    expect(urlBaseDoSocket()).toBe(`ws://${window.location.host}`)
  })

  it('em dev sem variável nenhuma, usa a porta fixa do backend (o Vite não faz proxy de /ws/)', () => {
    vi.stubEnv('VITE_WS_BASE_URL', '')
    vi.stubEnv('VITE_API_BASE_URL', '')
    vi.stubEnv('DEV', true)
    expect(urlBaseDoSocket()).toBe('ws://localhost:8000')
  })

  it('deriva da URL da API trocando o esquema (https → wss)', () => {
    vi.stubEnv('VITE_WS_BASE_URL', '')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.exemplo.com.br/')
    expect(urlBaseDoSocket()).toBe('wss://api.exemplo.com.br')
  })

  it('a variável explícita ganha de tudo', () => {
    vi.stubEnv('VITE_WS_BASE_URL', 'wss://ws.exemplo.com.br/')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.exemplo.com.br')
    expect(urlBaseDoSocket()).toBe('wss://ws.exemplo.com.br')
  })
})

describe('criarSocket — o que faz a conexão parar de "dar erro toda hora"', () => {
  it('código terminal (4401 sem sessão) NÃO reconecta: status "recusado" e fim', () => {
    const a = assinante()
    criarSocket({ path: '/ws/me/', onEvento: a.onEvento, onStatus: a.onStatus })
    FakeWebSocket.instancias[0].abrir()
    FakeWebSocket.instancias[0].cair(4401)
    expect(a.status.at(-1)).toBe('recusado')
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instancias).toHaveLength(1)
  })

  it('queda comum (1006) reconecta com backoff — e a rede voltando antecipa a tentativa', () => {
    const a = assinante()
    criarSocket({ path: '/ws/me/', onEvento: a.onEvento, onStatus: a.onStatus })
    FakeWebSocket.instancias[0].abrir()
    FakeWebSocket.instancias[0].cair()
    expect(a.status.at(-1)).toBe('fechado')
    // backoff de 2s agendado; o evento `online` chega antes
    vi.advanceTimersByTime(500)
    window.dispatchEvent(new Event('online'))
    expect(FakeWebSocket.instancias).toHaveLength(2)
    expect(a.status.at(-1)).toBe('conectando')
  })

  it('ping sem pong em 10s: dá o socket por morto, fecha e reconecta', () => {
    const a = assinante()
    criarSocket({ path: '/ws/chat/1/', onEvento: a.onEvento, onStatus: a.onStatus })
    const ws = FakeWebSocket.instancias[0]
    ws.abrir()
    vi.advanceTimersByTime(30_000) // ping
    expect(ws.enviados).toEqual([JSON.stringify({ type: 'ping' })])
    vi.advanceTimersByTime(10_000) // sem pong
    expect(ws.fechado).toBe(true)
    expect(a.status.at(-1)).toBe('fechado')
    vi.advanceTimersByTime(2_000)
    expect(FakeWebSocket.instancias).toHaveLength(2)
  })

  it('o pong (ou qualquer frame) dentro do prazo mantém a conexão', () => {
    const a = assinante()
    criarSocket({ path: '/ws/chat/1/', onEvento: a.onEvento, onStatus: a.onStatus })
    const ws = FakeWebSocket.instancias[0]
    ws.abrir()
    vi.advanceTimersByTime(30_000)
    ws.onmessage?.({ data: JSON.stringify({ type: 'pong' }) })
    vi.advanceTimersByTime(10_000)
    expect(ws.fechado).toBe(false)
    expect(a.status.at(-1)).toBe('aberto')
  })

  it('`new WebSocket` lançando (esquema proibido) vira tentativa falha, não exceção', () => {
    vi.stubGlobal(
      'WebSocket',
      class {
        constructor() {
          throw new Error('SecurityError')
        }
      },
    )
    const a = assinante()
    expect(() => criarSocket({ path: '/ws/me/', onEvento: a.onEvento, onStatus: a.onStatus })).not.toThrow()
    expect(a.status).toEqual(['conectando', 'fechado'])
  })

  it('desconectar de propósito não reconecta nem avisa "fechado" como queda', () => {
    const a = assinante()
    const s = criarSocket({ path: '/ws/me/', onEvento: a.onEvento, onStatus: a.onStatus })
    FakeWebSocket.instancias[0].abrir()
    s.desconectar()
    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instancias).toHaveLength(1)
    expect(a.status).toEqual(['conectando', 'aberto'])
  })
})
