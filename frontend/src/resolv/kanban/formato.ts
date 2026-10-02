/**
 * Textos do cartão que dependem de data — o prazo interno e o SLA — em
 * funções puras, com o "agora" vindo de fora (testável e sem `Date.now()`
 * espalhado pelo render).
 */
import { ROTULO_PRIORIDADE } from '../tickets/format'
import type { Cartao, RelogioSla } from './tipos'

const p2 = (n: number) => String(n).padStart(2, '0')

function mesmoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function hora(d: Date): string {
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

function dataCurta(d: Date, agora: Date): string {
  const base = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`
  return d.getFullYear() === agora.getFullYear() ? base : `${base}/${d.getFullYear()}`
}

/** Tom do prazo interno: a cor só aparece quando pede ação. */
export type TomPrazo = 'vencido' | 'proximo' | 'neutro'

export interface PrazoDescrito {
  tom: TomPrazo
  /** O que cabe no cartão: "Venceu 17/09", "Hoje 14:30", "Amanhã 09:00", "02/10". */
  rotulo: string
  /** Frase inteira, para tooltip e leitor de tela. */
  descricao: string
}

/**
 * Prazo INTERNO do quadro (não é o SLA). Vencido em perigo; hoje e amanhã em
 * alerta; o resto neutro. `vencidoNoServidor` é o `is_overdue` do backend —
 * ele manda quando discordar do relógio local por segundos.
 */
export function descreverPrazo(iso: string, agora: Date, vencidoNoServidor = false): PrazoDescrito {
  const d = new Date(iso)
  const completo = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} às ${hora(d)}`
  if (vencidoNoServidor || d.getTime() < agora.getTime()) {
    return {
      tom: 'vencido',
      rotulo: mesmoDia(d, agora) ? `Venceu ${hora(d)}` : `Venceu ${dataCurta(d, agora)}`,
      descricao: `Prazo interno vencido em ${completo}`,
    }
  }
  const amanha = new Date(agora)
  amanha.setDate(agora.getDate() + 1)
  if (mesmoDia(d, agora)) {
    return { tom: 'proximo', rotulo: `Hoje ${hora(d)}`, descricao: `Prazo interno: hoje às ${hora(d)}` }
  }
  if (mesmoDia(d, amanha)) {
    return { tom: 'proximo', rotulo: `Amanhã ${hora(d)}`, descricao: `Prazo interno: amanhã às ${hora(d)}` }
  }
  return { tom: 'neutro', rotulo: dataCurta(d, agora), descricao: `Prazo interno: ${completo}` }
}

/** "21 dias", "1 hora", "45 minutos" — a unidade maior que cabe, sem resto:
 *  numa dica de relance, "21 dias" diz o que importa; o resto está no badge. */
export function duracaoPorExtenso(minutos: number): string {
  const m = Math.abs(Math.round(minutos))
  if (m >= 1440) {
    const d = Math.floor(m / 1440)
    return d === 1 ? '1 dia' : `${d} dias`
  }
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return h === 1 ? '1 hora' : `${h} horas`
  }
  return m === 1 ? '1 minuto' : `${m} minutos`
}

export type QualSla = 'first_response' | 'resolution'

const NOME_SLA: Record<QualSla, string> = {
  first_response: 'primeira resposta',
  resolution: 'resolução',
}

/**
 * O significado do badge de SLA ("-21d 2h") em uma frase. O badge sozinho é
 * um número com sinal: não diz qual relógio é, nem se o negativo é "passou"
 * ou "falta". Esta frase vai no tooltip e é o que o leitor de tela lê.
 */
export function descreverSla(relogio: RelogioSla, qual: QualSla): string {
  const nome = NOME_SLA[qual]
  if (relogio.state === 'met') return `SLA de ${nome} cumprido`
  if (relogio.state === 'none' || relogio.minutes_left == null) return `Sem SLA de ${nome}`
  const quanto = duracaoPorExtenso(relogio.minutes_left)
  if (relogio.state === 'breached' || relogio.minutes_left < 0) return `SLA de ${nome} estourado há ${quanto}`
  if (relogio.state === 'at_risk') return `SLA de ${nome} em risco: vence em ${quanto}`
  return `SLA de ${nome} vence em ${quanto}`
}

/** "2026-09-05T14:30" ↔ ISO — o backend espera ISO completo, o
 *  `datetime-local` do navegador devolve sem timezone (assume local). */
export function paraDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${hora(d)}`
}

/** Só Alta e Urgente ganham marcador no cartão. Baixa e Normal são o estado
 *  comum da fila: um ponto verde em todo cartão "Normal" lia como "está tudo
 *  bem", que não é o que a prioridade diz, e virava ruído no quadro inteiro. */
export const MARCADOR_PRIORIDADE: Partial<Record<Cartao['priority'], string>> = {
  high: 'ti ti-arrow-up',
  urgent: 'ti ti-alert-triangle',
}

/** O relógio de SLA que vale mostrar no cartão: o de 1ª resposta enquanto
 *  ela não aconteceu, depois o de resolução. Os dois brigariam por espaço; a
 *  fila (TicketsTable) já mostra os dois em detalhe, aqui é resumo. */
export function slaDoCartao(c: Cartao): { relogio: RelogioSla; qual: QualSla } {
  const fr = c.sla.first_response
  return fr.state === 'none' || fr.state === 'met'
    ? { relogio: c.sla.resolution, qual: 'resolution' }
    : { relogio: fr, qual: 'first_response' }
}

/** Nome acessível do cartão inteiro: o que se vê nele, em frase. Sem isto o
 *  leitor de tela lia o conteúdo cru, inclusive o texto do botão de prazo. */
export function rotuloDoCartao(c: Cartao, agoraMs: number): string {
  const partes = [`${c.ticket_reference}: ${c.subject}`]
  const cliente = [c.requester_display, c.company_name].filter(Boolean).join(', ')
  if (cliente) partes.push(cliente)
  if (MARCADOR_PRIORIDADE[c.priority]) partes.push(`Prioridade ${ROTULO_PRIORIDADE[c.priority].toLowerCase()}`)
  if (c.due_at) partes.push(descreverPrazo(c.due_at, new Date(agoraMs), c.is_overdue).descricao)
  const { relogio, qual } = slaDoCartao(c)
  if (relogio.state !== 'none' && relogio.state !== 'met' && relogio.minutes_left != null) {
    partes.push(descreverSla(relogio, qual))
  }
  partes.push(c.assignee_name ? `Responsável: ${c.assignee_name}` : 'Sem responsável')
  return partes.join('. ')
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`
}

/** O que o contador do cabeçalho da coluna mostra e o que ele quer dizer.
 *
 *  O limite de WIP mede a coluna INTEIRA (`total`), não o recorte dos
 *  filtros: filtrar a tela não esvazia a coluna da equipe. Por isso, quando
 *  o filtro esconde cartões da coluna, o contador mostra "2 de 5" (o recorte
 *  e o todo) e o aviso de limite continua valendo pelo todo. */
export function contagemDaColuna(visiveis: number, total: number, limite: number | null, filtrando: boolean) {
  const acima = limite != null && total > limite
  // "x de y" só quando o filtro de fato escondeu algo nesta coluna: "1 de 1"
  // e "0 de 0" são o mesmo número dito duas vezes
  const recortada = filtrando && visiveis < total
  const texto = recortada ? `${visiveis} de ${total}` : limite != null ? `${total}/${limite}` : String(total)
  let descricao = recortada
    ? `${visiveis} de ${plural(total, 'ticket', 'tickets')} com os filtros atuais`
    : plural(total, 'ticket', 'tickets')
  if (limite != null) descricao += `, limite de ${limite}`
  if (acima) descricao += '. Acima do limite'
  return { texto, descricao, acima }
}

// ---------------------------------------------------------------------------
// Cor do status: a cor é dado (o admin escolhe em Configurações > Status), então
// o texto por cima dela não pode ser fixo. Branco em âmbar dá 2:1; escuro em
// roxo some. `coresDaBarra` escolhe a tinta pelo contraste e, quando o branco
// quase chega (um azul médio), escurece o fundo o pouco que falta em vez de
// trocar a tinta.
// ---------------------------------------------------------------------------

const TINTA_CLARA = '#ffffff'
const TINTA_ESCURA = '#1f1f1f'
/** Cor de um status sem cor válida cadastrada (ou de um ticket cujo status a
 *  coluna não conhece). Cinza quente: não afirma nada. */
export const COR_SEM_STATUS = '#8a8a85'

function rgbDe(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminancia([r, g, b]: [number, number, number]): number {
  const canal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

/** Razão de contraste WCAG entre duas cores `#rrggbb` (1 a 21). */
export function contraste(a: string, b: string): number {
  const ra = rgbDe(a)
  const rb = rgbDe(b)
  if (!ra || !rb) return 1
  const [claro, escuro] = [luminancia(ra), luminancia(rb)].sort((x, y) => y - x)
  return (claro! + 0.05) / (escuro! + 0.05)
}

function escurecer(hex: string, fracao: number): string {
  const rgb = rgbDe(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb.map((v) => Math.round(v * (1 - fracao)))
  return `#${[r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('')}`
}

export interface CoresDaBarra {
  fundo: string
  texto: string
}

/** Fundo e tinta do cabeçalho de uma coluna, com contraste AA (4,5:1) garantido. */
export function coresDaBarra(cor: string): CoresDaBarra {
  const base = rgbDe(cor) ? cor.toLowerCase().replace(/^([^#])/, '#$1') : COR_SEM_STATUS
  for (const passo of [0, 0.08, 0.16, 0.24]) {
    const fundo = escurecer(base, passo)
    if (contraste(TINTA_CLARA, fundo) >= 4.5) return { fundo, texto: TINTA_CLARA }
  }
  if (contraste(TINTA_ESCURA, base) >= 4.5) return { fundo: base, texto: TINTA_ESCURA }
  return { fundo: escurecer(base, 0.4), texto: TINTA_CLARA }
}

/** Cor de reserva por status do ticket, as mesmas dos status de fábrica. */
export const COR_DO_STATUS: Record<Cartao['ticket_status'], string> = {
  new: '#6c4e9c',
  open: '#5a87b8',
  pending_customer: '#e9a23b',
  closed: COR_SEM_STATUS,
}

export interface StatusDoCartao {
  nome: string
  cor: string
}
