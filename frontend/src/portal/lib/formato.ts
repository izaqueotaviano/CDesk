import { useState } from 'react'
import type { Prioridade, StatusTicket } from '@/resolv/tickets/tipos'

const fmtData = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

export function dataCurta(iso: string | null | undefined): string {
  return iso ? fmtData.format(new Date(iso)) : '—'
}
export function dataHora(iso: string | null | undefined): string {
  return iso ? fmtDataHora.format(new Date(iso)) : '—'
}
export function hora(iso: string): string {
  return fmtHora.format(new Date(iso))
}

/** "há 5 min", "há 2 h", "há 3 d"; mais velho que uma semana vira a data. */
export function relativo(iso: string | null | undefined, agoraMs: number): string {
  if (!iso) return '—'
  const min = Math.max(0, Math.floor((agoraMs - new Date(iso).getTime()) / 60_000))
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  if (d < 7) return `há ${d} d`
  return dataCurta(iso)
}

/** "Agora" de referência estável por montagem — não `Date.now()` em render. */
export function useAgora(): number {
  const [agora] = useState(() => Date.now())
  return agora
}

/** "12 min", "1 h 05", "2 d" — quanto durou algo entre dois instantes. */
export function duracaoEntre(inicioIso: string | null | undefined, fimIso: string | null | undefined): string | null {
  if (!inicioIso || !fimIso) return null
  const min = Math.round((new Date(fimIso).getTime() - new Date(inicioIso).getTime()) / 60_000)
  if (min < 0) return null
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, '0')}`
  return `${Math.floor(h / 24)} d`
}

/** `330` → `5h30`; `300` → `5h`; `45` → `45min` — mesma leitura de
 *  `apps.customers.services.maintenance._formatar` no backend, pra o número
 *  da franquia bater com o que o agente vê do outro lado. */
export function horasEMinutos(minutos: number): string {
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (!h) return `${m}min`
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export function tamanhoArquivo(bytes?: number): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

export type Tom = 'neutro' | 'acento' | 'ok' | 'alerta' | 'perigo'

export const TOM_PRIORIDADE: Record<Prioridade, Tom> = {
  low: 'neutro',
  normal: 'acento',
  high: 'alerta',
  urgent: 'perigo',
}

/**
 * Status como o CLIENTE lê. Os quatro estados do modelo viram cinco rótulos:
 * `closed` se divide em Resolvido (dá para reabrir respondendo) e Fechado
 * (encerrado automaticamente por falta de resposta — não reabre; abre-se um
 * novo). A mesma regra do filtro `resolucao=` do backend.
 */
export function statusDoCliente(t: { status: StatusTicket; auto_closed?: boolean | null }): {
  rotulo: string
  tom: Tom
} {
  switch (t.status) {
    case 'pending_customer':
      return { rotulo: 'Aguardando você', tom: 'alerta' }
    case 'new':
      return { rotulo: 'Aguardando suporte', tom: 'acento' }
    case 'open':
      return { rotulo: 'Em andamento', tom: 'acento' }
    case 'closed':
      return t.auto_closed ? { rotulo: 'Fechado', tom: 'neutro' } : { rotulo: 'Resolvido', tom: 'ok' }
  }
}

export function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? ''
}
