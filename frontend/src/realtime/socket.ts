/**
 * Wrapper de WebSocket com reconexão (backoff exponencial) e heartbeat.
 * Autenticado pelo cookie de sessão — o próprio navegador manda o cookie no
 * handshake, não há token para anexar (docs/10-frontend-novo.md).
 *
 * "O socket é transporte, não fonte de verdade": quem usa isto NUNCA deve
 * tratar um evento como dado autoritativo — só como dica para invalidar
 * cache (ver bridge.ts) ou, na reconexão, buscar o que faltou via REST
 * (`?after=<id da última vista>`).
 */

export type StatusSocket = 'conectando' | 'aberto' | 'fechado'

interface OpcoesSocket<TEvento> {
  path: string // ex.: '/ws/me/' ou `/ws/chat/${id}/`
  onEvento: (evento: TEvento) => void
  onStatus?: (status: StatusSocket) => void
}

export interface Socket {
  enviar: (mensagem: unknown) => void
  desconectar: () => void
}

const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8000'
const INTERVALO_PING_MS = 30_000
const BACKOFF_MAXIMO_MS = 30_000

export function criarSocket<TEvento>({ path, onEvento, onStatus }: OpcoesSocket<TEvento>): Socket {
  let ws: WebSocket | null = null
  let tentativas = 0
  let fechadoDeProposito = false
  let pingHandle: ReturnType<typeof setInterval> | undefined
  let reconectarHandle: ReturnType<typeof setTimeout> | undefined

  function conectar() {
    onStatus?.('conectando')
    ws = new WebSocket(`${WS_BASE_URL}${path}`)

    ws.onopen = () => {
      tentativas = 0
      onStatus?.('aberto')
      pingHandle = setInterval(() => enviar({ type: 'ping' }), INTERVALO_PING_MS)
    }

    ws.onmessage = (evento) => {
      try {
        onEvento(JSON.parse(evento.data) as TEvento)
      } catch {
        // payload não-JSON: não deveria acontecer com este backend — ignora
        // em vez de derrubar a conexão por um frame estranho.
      }
    }

    ws.onclose = () => {
      onStatus?.('fechado')
      clearInterval(pingHandle)
      if (!fechadoDeProposito) agendarReconexao()
    }

    ws.onerror = () => {
      // onclose é chamado logo em seguida pelo navegador — a reconexão fica
      // só ali, para não agendar duas vezes.
      ws?.close()
    }
  }

  function agendarReconexao() {
    tentativas += 1
    const espera = Math.min(BACKOFF_MAXIMO_MS, 1000 * 2 ** tentativas)
    reconectarHandle = setTimeout(conectar, espera)
  }

  function enviar(mensagem: unknown) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensagem))
  }

  function desconectar() {
    fechadoDeProposito = true
    clearInterval(pingHandle)
    clearTimeout(reconectarHandle)
    ws?.close()
  }

  conectar()
  return { enviar, desconectar }
}
