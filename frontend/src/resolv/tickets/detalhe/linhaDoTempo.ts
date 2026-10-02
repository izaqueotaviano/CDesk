/**
 * Helpers puros do detalhe do ticket — sem React, sem rede — para a linha do
 * tempo (mensagens + eventos numa sequência só), tempos e rótulos.
 * Tudo aqui recebe `agoraMs` de fora: quem chama decide o "agora" (o instante
 * do último fetch, como a lista faz), e a função continua determinística.
 */
import { API_BASE_URL, ApiError } from '@/api/client'
import { ROTULO_STATUS } from '../format'
import type { EstadoSla, StatusTicket } from '../tipos'
import type { Evento, Mensagem, RelogioSla } from './tiposDetalhe'

export const ICONE_CANAL: Record<string, string> = {
  web: 'ti ti-mail',
  chat: 'ti ti-message-circle-2',
  internal: 'ti ti-building',
  system: 'ti ti-robot',
}
export const ROTULO_CANAL: Record<string, string> = {
  web: 'Pelo e-mail',
  chat: 'Pelo chat',
  internal: 'Aberto internamente',
  system: 'Automático',
}

export type ItemLinha =
  | { tipo: 'mensagem'; quando: string; mensagem: Mensagem }
  | { tipo: 'evento'; quando: string; evento: Evento }

export interface GrupoDia {
  chave: string
  rotulo: string
  itens: ItemLinha[]
}

const MIN = 60_000
const HORA = 60 * MIN
const DIA = 24 * HORA

function chaveDia(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Mensagens e eventos de status ordenados pelo instante, mais antigo primeiro.
 *  Mensagens e eventos criados no mesmo instante ficam mensagem → evento
 *  (a resposta "Enviar e fechar" grava os dois com o mesmo relógio). */
export function mesclarLinhaDoTempo(
  mensagens: Mensagem[],
  eventos: Evento[],
  incluirEventos = true,
): ItemLinha[] {
  const itens: ItemLinha[] = mensagens.map((m) => ({
    tipo: 'mensagem',
    quando: m.created_at,
    mensagem: m,
  }))
  if (incluirEventos) {
    eventos.forEach((e) => itens.push({ tipo: 'evento', quando: e.created_at, evento: e }))
  }
  return itens
    .map((item, i) => ({ item, i }))
    .sort((a, b) => {
      const da = new Date(a.item.quando).getTime() - new Date(b.item.quando).getTime()
      if (da !== 0) return da
      if (a.item.tipo !== b.item.tipo) return a.item.tipo === 'mensagem' ? -1 : 1
      return a.i - b.i
    })
    .map(({ item }) => item)
}

/** "Hoje", "Ontem" ou "qui., 03/09/2026". */
export function rotuloDia(iso: string, agoraMs: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hoje = new Date(agoraMs)
  const diffDias = Math.round(
    (new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      DIA,
  )
  if (diffDias === 0) return 'Hoje'
  if (diffDias === 1) return 'Ontem'
  const semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' }).format(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${semana}, ${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

export function agruparPorDia(itens: ItemLinha[], agoraMs: number): GrupoDia[] {
  const grupos: GrupoDia[] = []
  for (const item of itens) {
    const chave = chaveDia(new Date(item.quando))
    const ultimo = grupos.at(-1)
    if (ultimo && ultimo.chave === chave) ultimo.itens.push(item)
    else grupos.push({ chave, rotulo: rotuloDia(item.quando, agoraMs), itens: [item] })
  }
  return grupos
}

/** "agora", "há 5 min", "há 3h", "há 2d" — sempre relativo a `agoraMs`. */
export function tempoRelativo(iso: string, agoraMs: number): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Math.max(0, agoraMs - t)
  if (diff < MIN) return 'agora'
  if (diff < HORA) return `há ${Math.floor(diff / MIN)} min`
  if (diff < DIA) return `há ${Math.floor(diff / HORA)}h`
  return `há ${Math.floor(diff / DIA)}d`
}

/** "15:20" */
export function horaCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Duração curta em português: "35min", "2h 15min", "3d 4h". */
export function duracaoCurta(minutos: number): string {
  const m = Math.abs(Math.round(minutos))
  if (m < 60) return `${m}min`
  const h = Math.floor(m / 60)
  const resto = m % 60
  if (h < 24) return resto ? `${h}h ${resto}min` : `${h}h`
  const d = Math.floor(h / 24)
  const hr = h % 24
  return hr ? `${d}d ${hr}h` : `${d}d`
}

export type Tom = 'neutro' | 'ok' | 'alerta' | 'perigo'

export function descreverEvento(ev: Evento): { texto: string; tom: Tom } {
  const quem = ev.actor_name
  const de = ev.from_status || null
  if (ev.is_reopen) {
    return {
      texto: ev.is_automatic
        ? 'Reaberto pela resposta do cliente'
        : `${quem ?? 'Alguém'} reabriu o ticket`,
      tom: 'alerta',
    }
  }
  if (ev.to_status === 'closed') {
    return {
      texto: ev.is_automatic
        ? 'Fechado automaticamente por falta de resposta'
        : `${quem ?? 'Sistema'} fechou o ticket`,
      tom: 'ok',
    }
  }
  if (!de && ev.to_status === 'new') {
    return { texto: quem ? `${quem} abriu o ticket` : 'Ticket aberto', tom: 'neutro' }
  }
  const destino = ROTULO_STATUS[ev.to_status] ?? ev.to_status
  if (ev.is_automatic) {
    return { texto: `Voltou para ${destino} com a resposta do cliente`, tom: 'neutro' }
  }
  // mesmo status dos dois lados: é um registro (macro aplicada, movida no
  // quadro), e a nota é que conta o que houve
  if (de === ev.to_status) {
    return { texto: `${quem ?? 'Sistema'} atualizou o ticket`, tom: 'neutro' }
  }
  return { texto: `${quem ?? 'Sistema'} moveu para ${destino}`, tom: 'neutro' }
}

export const ROTULO_SLA: Record<EstadoSla, string> = {
  none: 'sem SLA',
  met: 'cumprido',
  ok: 'no prazo',
  at_risk: 'em risco',
  breached: 'estourado',
}

export const TOM_SLA: Record<EstadoSla, Tom> = {
  none: 'neutro',
  met: 'ok',
  ok: 'ok',
  at_risk: 'alerta',
  breached: 'perigo',
}

/** Texto do relógio: "2h 15min" (restante), "-35min" (estourado), "—" (sem SLA). */
export function tempoSla(relogio: RelogioSla): string {
  if (relogio.state === 'none') return '—'
  if (relogio.state === 'met') return 'ok'
  if (relogio.minutes_left == null) return '—'
  const txt = duracaoCurta(relogio.minutes_left)
  return relogio.minutes_left < 0 ? `-${txt}` : txt
}

export function tamanhoArquivo(bytes?: number): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

export function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

/** Avatares e anexos chegam como caminho relativo à API (`/avatars/...`,
 *  `/api/v1/attachments/...`) — resolvidos contra a origem do Vite dariam 404. */
export function urlApi(caminho: string): string {
  return caminho.startsWith('http') ? caminho : `${API_BASE_URL}${caminho}`
}

/** Mensagem de erro no padrão da casa: o que houve + código técnico entre
 *  parênteses. Quem chama completa com a garantia sobre o trabalho da pessoa. */
export function mensagemDeErro(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    const campo = e.fieldErrors ? Object.values(e.fieldErrors)[0]?.[0] : undefined
    const texto = e.detail ?? campo ?? padrao
    return `${texto} (erro ${e.status})`
  }
  return padrao
}

/** Substitui `{{solicitante}}` / `{{empresa}}` / `{{referencia}}` no texto da
 *  macro; marcador desconhecido fica visível para a pessoa resolver. */
export function interpolarMacro(
  texto: string,
  ctx: { solicitante?: string; empresa?: string; referencia?: string },
): string {
  return texto.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (original, chave: string) => {
    if (chave === 'solicitante' && ctx.solicitante)
      return ctx.solicitante.trim().split(/\s+/)[0] ?? ''
    if (chave === 'empresa' && ctx.empresa) return ctx.empresa
    if (chave === 'referencia' && ctx.referencia) return ctx.referencia
    return original
  })
}

export function marcadoresPendentes(texto: string): string[] {
  return [...new Set(texto.match(/\{\{\s*[a-zA-Z_]+\s*\}\}/g) ?? [])]
}

/** Valor de um `<input type="datetime-local">` a partir de um ISO (fuso local). */
export function paraDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Regras do fechamento (D4), as mesmas que o backend aplica em
 *  `ticket_service.close_ticket`: criação ≤ início ≤ término ≤ agora, no
 *  minuto (o `datetime-local` não tem segundos). */
export function validarFechamento(opts: {
  criadoEm: string
  inicio: string
  fim: string
  agoraMs: number
}): { inicio?: string; fim?: string } {
  const criado = new Date(opts.criadoEm)
  criado.setSeconds(0, 0)
  const inicioDate = opts.inicio ? new Date(opts.inicio) : null
  const fimDate = opts.fim ? new Date(opts.fim) : null
  const erros: { inicio?: string; fim?: string } = {}
  if (!inicioDate) erros.inicio = 'Informe quando a solução começou.'
  else if (inicioDate < criado) erros.inicio = 'Não pode ser antes da abertura do ticket.'
  if (!fimDate) erros.fim = 'Informe quando a solução terminou.'
  else if (inicioDate && fimDate < inicioDate) erros.fim = 'Não pode ser antes do início.'
  else if (fimDate.getTime() > opts.agoraMs + 60_000) erros.fim = 'Não pode ser no futuro.'
  return erros
}

/** Status que o agente pode escolher ao responder em público (`_AGENT_REPLY_STATUSES`). */
export const STATUS_AO_ENVIAR: StatusTicket[] = ['open', 'pending_customer', 'closed']

/** Status inicial do seletor "ao enviar": mantém o atual quando faz sentido;
 *  ticket fechado volta a "Aberto" (responder reabre). */
export function statusInicialAoEnviar(status: StatusTicket): StatusTicket {
  return status === 'open' || status === 'pending_customer' ? status : 'open'
}

/** Rótulo do botão primário do compositor — diz as duas consequências. */
export function rotuloEnviar(opts: {
  publico: boolean
  statusAtual: StatusTicket
  statusEscolhido: StatusTicket
  enviando: boolean
}): string {
  if (opts.enviando) return 'Enviando…'
  if (!opts.publico) return 'Salvar nota'
  if (opts.statusEscolhido === 'closed') return 'Enviar e fechar'
  if (opts.statusAtual === 'closed') return 'Enviar e reabrir'
  if (opts.statusEscolhido === 'pending_customer' && opts.statusAtual !== 'pending_customer') {
    return 'Enviar e aguardar cliente'
  }
  return 'Enviar resposta'
}
