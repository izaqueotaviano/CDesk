import { assinarEventoPessoal } from './bridge'

/**
 * Som de chat novo — SÓ quando a aba está em segundo plano ou sem foco.
 *
 * Quem está olhando a tela já viu o card entrar na fila (ou a mensagem
 * chegar); tocar um alerta em cima disso é o mesmo aviso duas vezes. Quem
 * está em outra aba, ou noutra janela, não tem nada além do som — é pra
 * essa pessoa que ele existe.
 *
 * Bipe sintetizado pelo Web Audio, sem arquivo: não há asset de áudio na
 * base, e um oscilador de 120 ms cumpre o papel sem trazer binário pro
 * repositório. Se o navegador bloquear (autoplay sem gesto), falha em
 * silêncio — o título da aba ainda avisa.
 */

let iniciado = false
let tituloOriginal: string | null = null

export function emSegundoPlano(): boolean {
  return document.hidden || !document.hasFocus()
}

function bipar(vezes: number) {
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < vezes; i++) {
      const osc = ctx.createOscillator()
      const ganho = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      ganho.gain.value = 0.08
      osc.connect(ganho)
      ganho.connect(ctx.destination)
      const inicio = ctx.currentTime + i * 0.22
      osc.start(inicio)
      osc.stop(inicio + 0.12)
    }
    void ctx.resume()
  } catch {
    // sem áudio disponível — o título da aba já cobre o aviso
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

export function iniciarAvisosSonoros() {
  if (iniciado) return
  iniciado = true

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) restaurarTitulo()
  })
  window.addEventListener('focus', restaurarTitulo)

  assinarEventoPessoal((evento) => {
    if (!emSegundoPlano()) return
    if (evento.type === 'chat_queued') {
      bipar(2)
      marcarTitulo()
    } else if (
      evento.type === 'notification' &&
      (evento.kind === 'chat_message' || evento.kind === 'chat_transferred')
    ) {
      bipar(1)
      marcarTitulo()
    }
  })
}
