import { assinarEventoPessoal } from './bridge'

/**
 * Avisar quem NÃO está olhando a tela — três entregas do mesmo trabalho:
 * som, marca no título da aba e notificação do sistema operacional.
 *
 * A regra vale para as três: só dispara com a aba em segundo plano ou sem
 * foco. Quem está olhando já viu o card entrar na fila (ou a linha nova na
 * lista); alertar em cima disso é o mesmo aviso duas vezes.
 *
 * Antes este arquivo era só o som (`avisosSonoros`), e só de chat. Duas
 * mudanças: chamado novo passou a avisar também — antes um agente em outra
 * aba não tinha nada, o aviso ficava esperando ele voltar e olhar o sino — e
 * entrou a notificação do SO, que é a única das três que aparece por cima de
 * outro programa. Nenhuma delas alcança quem está com o navegador fechado;
 * isso exigiria web push (service worker + VAPID), que não existe aqui.
 */

// --------------------------------------------------------------------------
// o que interrompe
// --------------------------------------------------------------------------

/** Dois timbres para dar pra distinguir sem olhar: conversa ao vivo é mais
 *  aguda que chamado. */
type Timbre = 'chat' | 'chamado'

const HERTZ: Record<Timbre, number> = { chat: 880, chamado: 620 }

/**
 * O critério é "alguém está esperando VOCÊ agora", não "algo mudou".
 *
 * Fora de propósito: `sla_warning`/`sla_breached` (mudança de estado que a
 * varredura periódica dispara em lote — viraria uma rajada de bipes), os
 * encerramentos (`ticket_closed`, `chat_closed`: ninguém está esperando),
 * `announcement`, `kanban_due`, `lgpd_deadline` e `attachment_blocked`. Tudo
 * isso continua chegando no sino, que é onde se lê o que não é urgente.
 *
 * A lista serve aos DOIS shells: para o cliente, no portal, só chegam
 * `chat_message` e `ticket_replied` ("o suporte respondeu"), e os dois são
 * exatamente o caso de alguém esperando resposta.
 */
const KINDS_QUE_AVISAM: Record<string, Timbre> = {
  chat_message: 'chat',
  chat_transferred: 'chat',
  ticket_created: 'chamado',
  ticket_assigned: 'chamado',
  ticket_replied: 'chamado',
  mention: 'chamado',
}

// --------------------------------------------------------------------------
// preferência de notificação do sistema (por DISPOSITIVO)
// --------------------------------------------------------------------------

/** localStorage, não conta de usuário: "avisar neste computador" é uma
 *  escolha do aparelho — a permissão do navegador também é. Levar isso pro
 *  servidor faria o desktop do escritório ligar o aviso no notebook de casa. */
const CHAVE = 'resolv-avisos-sistema'

export type EstadoAviso =
  /** navegador sem a API (ou Chrome no Android, que exige service worker) */
  | 'indisponivel'
  /** dá pra ligar: nunca pediu permissão, ou pediu e a pessoa desligou aqui */
  | 'desligado'
  | 'ligado'
  /** a pessoa negou no navegador — só as configurações dele desfazem */
  | 'bloqueado'

function suportado(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function'
}

function escolhaSalva(): 'sim' | 'nao' | null {
  try {
    const salvo = localStorage.getItem(CHAVE)
    return salvo === 'sim' || salvo === 'nao' ? salvo : null
  } catch {
    return null // aba anônima/preview sem storage: cai no padrão
  }
}

function salvarEscolha(valor: 'sim' | 'nao') {
  try {
    localStorage.setItem(CHAVE, valor)
  } catch {
    // melhor esforço: sem persistir, o aviso ainda vale nesta aba
  }
}

export function estadoDosAvisos(): EstadoAviso {
  if (!suportado()) return 'indisponivel'
  if (Notification.permission === 'denied') return 'bloqueado'
  if (Notification.permission !== 'granted') return 'desligado'
  // permissão concedida é uma escolha explícita: vale como "sim" enquanto
  // ninguém desligar por aqui
  return escolhaSalva() === 'nao' ? 'desligado' : 'ligado'
}

/** Pede a permissão só quando a pessoa clica — nunca na carga da página,
 *  que é o pedido que todo mundo nega por reflexo. */
export async function ligarAvisosDoSistema(): Promise<EstadoAviso> {
  if (!suportado()) return 'indisponivel'
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission()
    } catch {
      return estadoDosAvisos()
    }
  }
  if (Notification.permission === 'granted') {
    salvarEscolha('sim')
    return 'ligado'
  }
  return estadoDosAvisos()
}

export function desligarAvisosDoSistema(): void {
  salvarEscolha('nao')
}

// --------------------------------------------------------------------------
// as três entregas
// --------------------------------------------------------------------------

let iniciado = false
let tituloOriginal: string | null = null

export function emSegundoPlano(): boolean {
  return document.hidden || !document.hasFocus()
}

/**
 * Bipe sintetizado pelo Web Audio, sem arquivo: não há asset de áudio na
 * base, e um oscilador de 120 ms cumpre o papel sem trazer binário pro
 * repositório. Se o navegador bloquear (autoplay antes de qualquer gesto),
 * falha em silêncio — as outras duas entregas ainda avisam.
 */
function bipar(vezes: number, timbre: Timbre) {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < vezes; i++) {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = HERTZ[timbre]
      ganho.gain.value = 0.08
      osc.connect(ganho)
      ganho.connect(ctx.destination)
      const inicio = ctx.currentTime + i * 0.22
      osc.start(inicio)
      osc.stop(inicio + 0.12)
    }
    void ctx.resume()
  } catch {
    // sem áudio disponível — o título da aba e o aviso do SO já cobrem
  }
}

function marcarTitulo() {
  if (tituloOriginal === null) tituloOriginal = document.title
  document.title = `● ${tituloOriginal}`
}

function restaurarTitulo() {
  if (tituloOriginal !== null) {
    document.title = tituloOriginal
    tituloOriginal = null
  }
}

/** Navegar a partir do clique no aviso do SO. Fora do React, então quem
 *  monta o shell injeta o `navigate` do router; sem ele, recarrega a página
 *  (funciona, só é mais caro). */
let irPara: (url: string) => void = (url) => window.location.assign(url)

export function definirNavegacao(fn: (url: string) => void): void {
  irPara = fn
}

function notificarNoSistema(titulo: string, corpo: string, tag: string, url?: string) {
  if (estadoDosAvisos() !== 'ligado') return
  try {
    // `tag` faz o aviso novo SUBSTITUIR o anterior do mesmo assunto em vez de
    // empilhar: cinco mensagens da mesma conversa são uma notificação, não
    // cinco.
    const aviso = new Notification(titulo, { body: corpo, tag })
    aviso.onclick = () => {
      window.focus()
      aviso.close()
      if (url) irPara(url)
    }
  } catch {
    // Chrome no Android exige ServiceWorkerRegistration.showNotification e
    // lança aqui. Sem service worker na base, o certo é não avisar em vez de
    // quebrar o resto da função.
  }
}

function avisar(opcoes: { vezes: number; timbre: Timbre; titulo: string; corpo: string; tag: string; url?: string }) {
  bipar(opcoes.vezes, opcoes.timbre)
  marcarTitulo()
  notificarNoSistema(opcoes.titulo, opcoes.corpo, opcoes.tag, opcoes.url)
}

export function iniciarAvisos() {
  if (iniciado) return
  iniciado = true

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restaurarTitulo()
  })
  window.addEventListener('focus', restaurarTitulo)

  assinarEventoPessoal((evento) => {
    if (!emSegundoPlano()) return

    if (evento.type === 'chat_queued') {
      avisar({
        vezes: 2, // dois bipes: é o único que tem alguém esperando AO VIVO
        timbre: 'chat',
        titulo: 'Novo chat na fila',
        corpo: `${evento.client_name} · ${evento.company}`,
        tag: 'chat-fila',
        url: '/chat',
      })
      return
    }

    if (evento.type !== 'notification') return
    const timbre = KINDS_QUE_AVISAM[evento.kind]
    if (!timbre) return

    avisar({
      vezes: 1,
      timbre,
      // O título/corpo do backend já é escrito para leitura humana (é o mesmo
      // texto do sino); repetir a formatação aqui daria duas versões para
      // manter em sincronia.
      titulo: evento.title ?? 'Resolv',
      corpo: evento.body ?? evento.preview ?? '',
      // Uma notificação por conversa/chamado: o `tag` agrupa por assunto, não
      // por evento.
      tag: evento.chat_id ? `chat-${evento.chat_id}` : `ticket-${evento.ticket_id ?? evento.kind}`,
      url: evento.url,
    })
  })
}
