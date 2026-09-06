import type { UnidadeKpi } from './dados'

/** Segundos → texto curto ("45min", "2h 14min", "3d 2h"). Sem granularidade
 *  variável, "185min" ou "0.13h" seriam ilegíveis nos KPIs e na tabela de agentes. */
export function formatarDuracao(segundos: number | null): string {
  if (segundos == null) return '—'
  const minutos = Math.round(segundos / 60)
  if (minutos < 60) return `${minutos}min`
  const horas = Math.floor(minutos / 60)
  const restoMin = minutos % 60
  if (horas < 24) return restoMin ? `${horas}h ${restoMin}min` : `${horas}h`
  const dias = Math.floor(horas / 24)
  const restoHoras = horas % 24
  return restoHoras ? `${dias}d ${restoHoras}h` : `${dias}d`
}

/** Fração 0–1 → percentual. `null` é "sem amostra", nunca 0%. */
export function formatarPercentual(fracao: number | null, casas = 0): string {
  return fracao == null ? '—' : `${(fracao * 100).toFixed(casas)}%`
}

export function formatarNota(nota: number | null): string {
  return nota == null ? '—' : nota.toFixed(1)
}

/** Variação percentual já pronta para exibir, com sinal — "+12%", "−8%". */
export function formatarVariacao(variacao: number | null): string {
  if (variacao == null) return ''
  const arredondado = Math.round(variacao * 100)
  return `${arredondado > 0 ? '+' : ''}${arredondado}%`
}

export function direcaoVariacao(variacao: number | null): 'up' | 'down' | 'flat' {
  if (!variacao) return 'flat'
  return variacao > 0 ? 'up' : 'down'
}

export function formatarValorKpi(valor: number | null, unidade: UnidadeKpi): string {
  if (valor == null) return '—'
  if (unidade === 'seconds') return formatarDuracao(valor)
  if (unidade === 'score') return valor.toFixed(1)
  return String(Math.round(valor))
}

export function formatarDataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}
