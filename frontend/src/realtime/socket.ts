/**
 * Wrapper de WebSocket com reconexão (backoff exponencial), heartbeat com
 * vigia de resposta, e retomada imediata quando a rede volta ou a aba
 * volta ao primeiro plano. Autenticado pelo cookie de sessão — o próprio
 * navegador manda o cookie no handshake, não há token para anexar
 * (docs/10-frontend-novo.md).
 *
 * "O socket é transporte, não fonte de verdade": quem usa isto NUNCA deve
 * tratar um evento como dado autoritativo — só como dica para invalidar
 * cache (ver bridge.ts) ou, na reconexão, buscar o que faltou via REST
 * (`?after=<id da última vista>`).
 *
 * O que a Rodada 13 mudou, e por quê (era a "instabilidade" do chat):
 *
 * 1. A URL base não é mais `ws://localhost:8000` por padrão. Sem
 *    `VITE_WS_BASE_URL` no build, TODA conexão de produção ia pra
 *    localhost e falhava pra sempre — "reconectando…" o dia inteiro.
 *    Agora deriva da URL da API (`VITE_API_BASE_URL`, http→ws) e, sem
 *    nenhuma das duas, da própria origem da página (wss em https). É o
 *    que o nginx de produção espera: `/ws/` no mesmo host.
 * 2. Fechamento com código TERMINAL (4401 sem sessão, 4403 sem acesso,
 *    4404 chat inexistente — apps/chat/consumers.py; 1008 política) não
 *    reconecta mais: reconectar a cada 2–30s contra uma sessão expirada
 *    era o "erro de conexão toda hora". O status vira `recusado` e a tela
 *    diz o que fazer (recarregar / entrar de novo).
 * 3. Vigia do ping: um socket pode ficar meio-morto (laptop dormiu, trocou
 *    de rede) sem o navegador disparar `close` por minutos — a tela dizia
 *    "Conectado" e nada chegava. Agora cada ping espera o `pong`; sem
 *    resposta em 10s, fecha e reconecta.
 * 4. `online` e `visibilitychange`: a rede voltou ou a aba voltou → tenta
 *    AGORA, sem esperar o backoff de até 30s.
 * 5. `new WebSocket()` pode lançar síncrono (URL inválida, ws:// numa página
 *    https) — antes isso derrubava o componente inteiro; agora vira uma
 *    tentativa falha como outra qualquer.
 */

export type StatusSocket = 'conectando' | 'aberto' | 'fechado' | 'recusado'

interface OpcoesSocket<TEvento> {
  path: string // ex.: '/ws/me/' ou `/ws/chat/${id}/`
  onEvento: (evento: TEvento) => void
  onStatus?: (status: StatusSocket) => void
}

export interface Socket {
  enviar: (mensagem: unknown) => void
  desconectar: () => void
}

const INTERVALO_PING_MS = 30_000
/** Quanto esperar o pong antes de dar o socket como morto. */
const ESPERA_PONG_MS = 10_000
const BACKOFF_MAXIMO_MS = 30_000

/** Códigos com que o backend recusa a conexão de vez (apps/chat/consumers.py)
 *  — e o 1008 do protocolo (violação de política). Reconectar não resolve. */
const CODIGOS_TERMINAIS = new Set([1008, 4401, 4403, 4404])

/**
 * De onde vem o WebSocket, nesta ordem: `VITE_WS_BASE_URL` explícita; a URL
 * da API com o esquema trocado (http→ws, https→wss); sem variável nenhuma, a
 * origem da própria página — que serve nos dois ambientes, porque o nginx de
 * produção e o proxy do Vite em dev (com `ws: true`) entregam `/ws/` no mesmo
 * host da SPA.
 */
export function urlBaseDoSocket(): string {
  const explicita = import.meta.env.VITE_WS_BASE_URL as string | undefined
  if (explicita) return explicita.replace(/\/+$/, '')
  const api = (import.meta.env.VITE_API_BASE_URL as string | undefined) || ''
  if (api) return api.replace(/^http/, 'ws').replace(/\/+$/, '')
  if (typeof window !== 'undefined' && window.location?.host) {
    const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocolo}//${window.location.host}`
  }
  return 'ws://localhost:8000'
}

export function criarSocket<TEvento>({ path, onEvento, onStatus }: OpcoesSocket<TEvento>): Socket {
  let ws: WebSocket | null = null
  let tentativas = 0
  let fechadoDeProposito = false
  let recusado = false
  let pingHandle: ReturnType<typeof setInterval> | undefined
  let vigiaPongHandle: ReturnType<typeof setTimeout> | undefined
  let reconectarHandle: ReturnType<typeof setTimeout> | undefined

  function limparTimers() {
    clearInterval(pingHandle)
    clearTimeout(vigiaPongHandle)
    pingHandle = undefined
    vigiaPongHandle = undefined
  }

  function conectar() {
    if (fechadoDeProposito || recusado) return
    reconectarHandle = undefined
    onStatus?.('conectando')
    let novo: WebSocket
    try {
      novo = new WebSocket(`${urlBaseDoSocket()}${path}`)
    } catch {
      // URL inválida ou esquema proibido pela página: conta como tentativa
      // falha, não como exceção que derruba quem chamou
      onStatus?.('fechado')
      agendarReconexao()
      return
    }
    ws = novo

    novo.onopen = () => {
      if (novo !== ws) return
      tentativas = 0
      onStatus?.('aberto')
      limparTimers()
      pingHandle = setInterval(() => {
        if (novo.readyState !== WebSocket.OPEN) return
        enviar({ type: 'ping' })
        // Qualquer frame que chegar limpa a vigia (ver onmessage) — não
        // precisa ser o pong, basta o servidor dar sinal de vida.
        clearTimeout(vigiaPongHandle)
        vigiaPongHandle = setTimeout(() => {
          // socket meio-morto: fechar força o onclose, que reconecta
          novo.close()
        }, ESPERA_PONG_MS)
      }, INTERVALO_PING_MS)
    }

    novo.onmessage = (evento) => {
      clearTimeout(vigiaPongHandle)
      try {
        onEvento(JSON.parse(evento.data) as TEvento)
      } catch {
        // payload não-JSON: não deveria acontecer com este backend — ignora
        // em vez de derrubar a conexão por um frame estranho.
      }
    }

    novo.onclose = (evento) => {
      if (novo !== ws) return // socket antigo fechando depois de substituído
      limparTimers()
      if (fechadoDeProposito) return
      if (evento && CODIGOS_TERMINAIS.has(evento.code)) {
        recusado = true
        onStatus?.('recusado')
        return
      }
      onStatus?.('fechado')
      agendarReconexao()
    }

    novo.onerror = () => {
      // onclose é chamado logo em seguida pelo navegador — a reconexão fica
      // só ali, para não agendar duas vezes.
      novo.close()
    }
  }

  function agendarReconexao() {
    if (fechadoDeProposito || recusado || reconectarHandle) return
    tentativas += 1
    const espera = Math.min(BACKOFF_MAXIMO_MS, 1000 * 2 ** tentativas)
    reconectarHandle = setTimeout(conectar, espera)
  }

  /** Rede voltou / aba voltou: se estamos esperando o backoff, tenta agora. */
  function retomarAgora() {
    if (fechadoDeProposito || recusado) return
    if (reconectarHandle) {
      clearTimeout(reconectarHandle)
      reconectarHandle = undefined
      tentativas = 0
      conectar()
    }
  }
  function aoVoltarVisivel() {
    if (document.visibilityState === 'visible') retomarAgora()
  }

  function enviar(mensagem: unknown) {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(mensagem))
  }

  function desconectar() {
    fechadoDeProposito = true
    limparTimers()
    clearTimeout(reconectarHandle)
    reconectarHandle = undefined
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', retomarAgora)
      document.removeEventListener('visibilitychange', aoVoltarVisivel)
    }
    ws?.close()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', retomarAgora)
    document.addEventListener('visibilitychange', aoVoltarVisivel)
  }

  conectar()
  return { enviar, desconectar }
}
