import { ATALHOS, type IdAtalho } from './catalogo'

/**
 * Despachante ÚNICO de atalhos de teclado do console. Um `keydown` no
 * documento, não um por tela: com vários ouvintes soltos, "g" depois "i"
 * precisaria de um buffer em cada um, e duas telas montadas ao mesmo tempo
 * (shell + detalhe) disputariam a mesma tecla sem ordem definida.
 *
 * Quem quer reagir a um atalho REGISTRA um manipulador para o id do catálogo
 * (`useAtalhos`). Vários registros do mesmo id convivem numa pilha: vale o
 * mais recente — o detalhe do ticket, montado depois do shell, ganha o Esc
 * enquanto uma gaveta dele estiver aberta, e devolve ao sair.
 *
 * As regras de quando NÃO disparar moram em `deveIgnorar` (exportada para o
 * teste): digitando num campo, dentro de um diálogo modal, com
 * Ctrl/⌘/Alt (fora o `mod+z` declarado), tecla repetida por segurar, ou
 * evento que outra parte da tela já tratou.
 */

export type Manipulador = (evento: KeyboardEvent) => void
export type MapaDeAtalhos = Partial<Record<IdAtalho, Manipulador | undefined | false>>

interface Registro {
  mapa: () => MapaDeAtalhos
}

/** Tempo para a segunda tecla de uma sequência ("g" → "i"). */
export const ESPERA_SEQUENCIA_MS = 1200

const registros: Registro[] = []
let buffer: string[] = []
let relogio: ReturnType<typeof setTimeout> | undefined

const TIPOS_DE_INPUT_SEM_TEXTO = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
])

/** O alvo aceita texto? Aí a tecla é da pessoa, não do atalho. */
export function ehAlvoEditavel(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  if (alvo.isContentEditable || alvo.closest('[contenteditable=""], [contenteditable="true"]')) {
    return true
  }
  const tag = alvo.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    return !TIPOS_DE_INPUT_SEM_TEXTO.has((alvo as HTMLInputElement).type)
  }
  // web components de campo (md-outlined-text-field etc.) — o foco real fica
  // no shadow DOM e o alvo que chega aqui é o host
  return alvo.getAttribute('role') === 'textbox' || alvo.getAttribute('role') === 'combobox'
}

/** Há um diálogo modal aberto? Enquanto houver, o teclado é dele. */
export function haModalAberto(alvo: EventTarget | null): boolean {
  if (alvo instanceof Element && alvo.closest('[aria-modal="true"], dialog[open], [role="alertdialog"]')) {
    return true
  }
  return document.querySelector('[aria-modal="true"], dialog[open]') !== null
}

/** A tecla do evento no vocabulário do catálogo (`?`, `g`, `Escape`, `mod+z`). */
export function teclaDoEvento(e: KeyboardEvent): string {
  const tecla = e.key.length === 1 ? e.key.toLowerCase() : e.key
  // `?` e `/` chegam com Shift em vários layouts; letras maiúsculas (Caps
  // Lock) viram minúsculas acima. Shift não é modificador aqui.
  return e.ctrlKey || e.metaKey ? `mod+${tecla}` : tecla
}

export function deveIgnorar(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.repeat) return true
  if (e.altKey) return true
  // Ctrl/⌘ só passa na forma declarada `mod+…` — decide quem casa, abaixo.
  if (ehAlvoEditavel(e.target)) return true
  if (haModalAberto(e.target)) return true
  return false
}

function manipuladorPara(id: IdAtalho): Manipulador | undefined {
  // de trás para a frente: o registro mais recente ganha
  for (let i = registros.length - 1; i >= 0; i--) {
    const m = registros[i]!.mapa()[id]
    if (m) return m
  }
  return undefined
}

function limparBuffer() {
  buffer = []
  if (relogio !== undefined) clearTimeout(relogio)
  relogio = undefined
}

function mesmaSequencia(a: string[], b: string[]) {
  return a.length === b.length && a.every((t, i) => t === b[i])
}

function comecaCom(seq: string[], prefixo: string[]) {
  return prefixo.length < seq.length && prefixo.every((t, i) => t === seq[i])
}

/** Tenta casar `sequencia` com um atalho registrado. */
function casar(sequencia: string[]): { id: IdAtalho; m: Manipulador } | 'prefixo' | null {
  let ehPrefixo = false
  for (const def of ATALHOS) {
    const m = manipuladorPara(def.id)
    if (!m) continue
    for (const combinacao of def.combinacoes) {
      if (mesmaSequencia(combinacao, sequencia)) return { id: def.id, m }
      if (comecaCom(combinacao, sequencia)) ehPrefixo = true
    }
  }
  return ehPrefixo ? 'prefixo' : null
}

function aoTeclar(e: KeyboardEvent) {
  if (deveIgnorar(e)) {
    limparBuffer()
    return
  }
  const tecla = teclaDoEvento(e)
  // Ctrl/⌘ com tecla que não é `mod+…` no catálogo (Ctrl+C, ⌘R…) é do
  // navegador: nem conta como tecla de sequência.
  let resultado = casar([...buffer, tecla])
  if (resultado === null && buffer.length > 0) {
    // "g" seguido de algo que não completa nada: a sequência morre e a tecla
    // nova é avaliada sozinha — "g" e depois "?" ainda abre a ajuda.
    limparBuffer()
    resultado = casar([tecla])
  }
  if (resultado === null) return
  if (resultado === 'prefixo') {
    buffer = [...buffer, tecla]
    if (relogio !== undefined) clearTimeout(relogio)
    relogio = setTimeout(limparBuffer, ESPERA_SEQUENCIA_MS)
    return
  }
  limparBuffer()
  // A tecla virou comando: não pode também digitar/rolar/abrir a busca
  // rápida do Firefox (que é o `/` e o `'`).
  e.preventDefault()
  resultado.m(e)
}

/** Registra um mapa de atalhos. Devolve a função que o remove. `mapa` é lida
 *  a cada tecla, então quem registra pode trocar manipuladores sem se
 *  registrar de novo. */
export function registrarAtalhos(mapa: () => MapaDeAtalhos): () => void {
  const registro: Registro = { mapa }
  registros.push(registro)
  if (registros.length === 1) document.addEventListener('keydown', aoTeclar)
  return () => {
    const i = registros.indexOf(registro)
    if (i >= 0) registros.splice(i, 1)
    if (registros.length === 0) {
      document.removeEventListener('keydown', aoTeclar)
      limparBuffer()
    }
  }
}
