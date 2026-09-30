import type { Kpi, UnidadeKpi } from './dados'

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

/**
 * Variação já pronta para exibir, com sinal — "+12%", "-8%".
 *
 * A entrada JÁ É PERCENTUAL, não fração: `indicators.variation()` devolve
 * `(atual - anterior) / anterior * 100` (testado lá como
 * `variation(6, 4) == 50.0`). Multiplicar por 100 de novo aqui rendia
 * "+5000%" — o painel mostrava "+20000%" com dado real.
 *
 * Não confundir com `formatarPercentual`, que recebe FRAÇÃO 0–1 (é o contrato
 * de `on_time_rate`) e por isso multiplica. São dois contratos diferentes
 * vindos do mesmo backend, cada um com o seu formatador.
 */
export function formatarVariacao(variacao: number | null): string {
  if (variacao == null) return ''
  const arredondado = Math.round(variacao)
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

/** Minutos (contrato de `espera_media_minutos`/`atendimento_medio_minutos`,
 *  ver `ChatReportView`) → o mesmo texto curto de `formatarDuracao`, que
 *  trabalha em segundos — converte uma vez aqui, sem duplicar a escala. */
export function formatarMinutos(minutos: number | null | undefined): string {
  if (minutos == null) return '—'
  return formatarDuracao(Math.round(minutos * 60))
}

export function formatarDataCurta(iso: string): string {
  const [, mes, dia] = iso.split('-')
  return `${dia}/${mes}`
}

/** Para que lado a variação é boa. */
export type Sentido = 'up-is-good' | 'up-is-bad' | 'neutral'

/** `direction` do backend (`up`/`down`/`null`) no vocabulário do StatCard:
 *  "down" é boa descida (tempo de resposta), `null` é neutro (volume). */
export function sentidoDoKpi(direction: Kpi['direction']): Sentido {
  if (direction === 'down') return 'up-is-bad'
  if (direction === 'up') return 'up-is-good'
  return 'neutral'
}

/** Classe do delta numa tabela: só pinta quando a métrica tem lado bom. */
export function classeDoDelta(variacao: number | null, sentido: Sentido): string {
  const d = direcaoVariacao(variacao)
  if (d === 'flat' || sentido === 'neutral') return 'relatorios-delta'
  const bom = (d === 'up') === (sentido === 'up-is-good')
  return `relatorios-delta relatorios-delta--${bom ? 'bom' : 'ruim'}`
}
