import type { Prioridade, RelogioSla, StatusTicket } from './tipos'

/** "03/09/2026 15:51" — formato da coluna "Aberto em" do print. */
export function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * "Tempo de espera em fila" — NÃO existe como campo no serializer
 * (`TicketList` não expõe wait time; o backend só aceita ordenar por `espera`).
 * Derivado aqui: tempo desde a abertura enquanto não houve 1ª resposta; depois
 * disso, "—" (já saiu da fila). É uma aproximação honesta — o ideal é o
 * backend expor o valor autoritativo (ver melhorias sugeridas).
 */
export function esperaEmFila(createdAt: string, firstResponseAt: string | null, agoraMs: number): string {
  if (firstResponseAt) return '—'
  const inicio = new Date(createdAt).getTime()
  if (Number.isNaN(inicio)) return '—'
  const seg = Math.max(0, Math.floor((agoraMs - inicio) / 1000))
  if (seg < 60) return `${seg}seg`
  const min = Math.floor(seg / 60)
  if (min < 60) return `${min}min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  low: 'Baixa',
  normal: 'Normal',
  high: 'Alta',
  urgent: 'Urgente',
}

/** Cor da barra de urgência — mapeada às cores semânticas do design system. */
export const COR_PRIORIDADE: Record<Prioridade, string> = {
  low: 'var(--text-muted)',
  normal: 'var(--ok)',
  high: 'var(--away)',
  urgent: 'var(--danger)',
}

export const ROTULO_STATUS: Record<StatusTicket, string> = {
  new: 'Novo',
  open: 'Aberto',
  pending_customer: 'Aguardando retorno',
  closed: 'Fechado',
}

/** Cor do relógio de SLA (`RelogioSla.state`) — mesma semântica de
 *  `COR_PRIORIDADE`: vermelho estourou, âmbar em risco, cinza sem prazo,
 *  verde no prazo. Usado nas listas da Início ("Seus próximos",
 *  "Vencendo na equipe") e reaproveitável na tabela de tickets no dia em
 *  que ela ganhar uma coluna de SLA. */
export function corEstadoSla(sla: RelogioSla): string {
  if (sla.state === 'breached') return 'var(--danger)'
  if (sla.state === 'at_risk') return 'var(--away)'
  if (sla.state === 'none') return 'var(--text-muted)'
  return 'var(--ok)'
}

/** Texto curto do relógio — "2h restantes", "Estourado", "Sem SLA". */
export function textoEstadoSla(sla: RelogioSla): string {
  if (sla.state === 'breached') return 'Estourado'
  if (sla.state === 'none') return 'Sem SLA'
  if (sla.minutes_left == null) return 'No prazo'
  const h = Math.floor(sla.minutes_left / 60)
  const restante = h > 0 ? `${h}h` : `${sla.minutes_left}min`
  return sla.state === 'at_risk' ? `${restante} — em risco` : `${restante} restantes`
}
