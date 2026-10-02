/**
 * Regras de leitura do consumo da empresa (cota de tickets e franquia de
 * manutenção) e dos fatos do cabeçalho — funções puras, testadas à parte
 * (uso.test.ts), para a página só desenhar.
 */

/** Tom da barra de consumo. Cor é ESTADO, não enfeite: até 80% a barra é
 *  neutra (carvão), perto do limite vira alerta e só no limite vira perigo.
 *  Antes, 17% já saía na cor de destaque e lia como problema. */
export type TomDoUso = 'neutro' | 'alerta' | 'perigo'

export const LIMIAR_ALERTA = 80
export const LIMIAR_PERIGO = 100

export function tomDoUso(pct: number): TomDoUso {
  if (pct >= LIMIAR_PERIGO) return 'perigo'
  if (pct >= LIMIAR_ALERTA) return 'alerta'
  return 'neutro'
}

/** Porcentagem inteira de `usado` sobre `limite`, sem teto (130% é informação:
 *  a barra satura, o texto não). `null` quando não há limite — e limite zero
 *  com algo usado já é 100%, não uma divisão por zero. */
export function porcentagemDoUso(usado: number, limite: number | null): number | null {
  if (limite == null) return null
  if (limite <= 0) return usado > 0 ? LIMIAR_PERIGO : 0
  return Math.round((usado / limite) * 100)
}

/** "este mês" / "esta semana" — o período vem da empresa (ou do plano). */
export function trechoDoPeriodo(periodo: string | null | undefined): string {
  return periodo === 'weekly' ? 'esta semana' : 'este mês'
}

/** 0 → "0h"; 45 → "45min"; 60 → "1h"; 90 → "1h 30min". Zero sai em horas
 *  porque é lido ao lado da franquia ("0h de 10h"), não como duração. */
export function formatarMinutos(minutos: number): string {
  const total = Math.max(0, Math.round(minutos))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (total === 0) return '0h'
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

/** "YYYY-MM-DD" como data LOCAL. `new Date('2026-09-30')` é meia-noite UTC,
 *  e a oeste de Greenwich isso vira dia 29 na tela. */
export function dataLocal(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MES_LONGO = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

/** O período renova no dia seguinte ao último (`period_end` é inclusivo,
 *  ver apps/customers/services/quota.py::current_period): "1 out". */
export function renovacaoDoPeriodo(fimDoPeriodo: string): string | null {
  const fim = dataLocal(fimDoPeriodo)
  if (!fim) return null
  const dia = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1)
  return `${dia.getDate()} ${MES_CURTO[dia.getMonth()]}`
}

/** "Cliente desde": o início do contrato quando existe; senão, o dia do
 *  cadastro. Mês e ano bastam ("março de 2024") — o dia exato é ruído. */
export function clienteDesde(contrato: string | null | undefined, cadastro: string | null | undefined): string | null {
  const base = (contrato && dataLocal(contrato)) || (cadastro ? new Date(cadastro) : null)
  if (!base || Number.isNaN(base.getTime())) return null
  return `${MES_LONGO[base.getMonth()]} de ${base.getFullYear()}`
}

/** Quando algo aconteceu, do jeito que se fala: "hoje, 14:32", "ontem,
 *  09:10", "12 set", "12 set 2025". `agora` entra por parâmetro para o teste
 *  (e a tela) não dependerem do relógio na hora do render. */
export function formatarQuando(iso: string | null | undefined, agora: Date): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const dia = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diferenca = Math.round((dia(agora) - dia(d)) / 86_400_000)
  if (diferenca === 0) return `hoje, ${hora}`
  if (diferenca === 1) return `ontem, ${hora}`
  const curto = `${d.getDate()} ${MES_CURTO[d.getMonth()]}`
  return d.getFullYear() === agora.getFullYear() ? curto : `${curto} ${d.getFullYear()}`
}

/** Tempo restante do SLA no formato do `SlaBadge` ("45min", "2h14", "3d"). */
export function restanteDoSla(minutos: number | null): string | undefined {
  if (minutos == null) return undefined
  const total = Math.abs(Math.round(minutos))
  if (total < 60) return `${total}min`
  const h = Math.floor(total / 60)
  if (h >= 24) return `${Math.floor(h / 24)}d`
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}
