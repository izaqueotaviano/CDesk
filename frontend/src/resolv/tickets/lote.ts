import type { ResultadoLote } from './dados'

export type AcaoDeLote = 'atribuir' | 'prioridade' | 'status' | 'encerrar'

const PARTICIPIO: Record<AcaoDeLote, [string, string]> = {
  atribuir: ['atribuído', 'atribuídos'],
  prioridade: ['atualizado', 'atualizados'],
  status: ['atualizado', 'atualizados'],
  encerrar: ['encerrado', 'encerrados'],
}

export interface ResumoDoLote {
  /** `sucesso`: tudo mudou. `parcial`: parte mudou, parte foi ignorada.
   *  `falha`: nada mudou — é o único que interrompe o leitor de tela. */
  tipo: 'sucesso' | 'parcial' | 'falha'
  texto: string
}

function tickets(n: number, [um, varios]: [string, string]): string {
  return n === 1 ? `1 ticket ${um}` : `${n} tickets ${varios}`
}

/**
 * A frase que a fila mostra depois de uma ação em lote: quantos mudaram e,
 * dos que não mudaram, POR QUÊ — com o motivo do próprio backend, agrupado
 * ("Ticket já está fechado (2); Já está neste status."). Um genérico "algo
 * falhou" obrigaria a abrir chamado por chamado para descobrir qual.
 */
export function resumirLote(res: ResultadoLote, acao: AcaoDeLote): ResumoDoLote {
  const ok = res.updated.length
  const ignorados = res.failed.length
  const feitos = tickets(ok, PARTICIPIO[acao])
  if (ignorados === 0) return { tipo: 'sucesso', texto: `${feitos}.` }

  const porMotivo = new Map<string, number>()
  for (const f of res.failed) {
    const motivo = (f.detail || 'Motivo não informado').trim().replace(/\.$/, '')
    porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1)
  }
  const motivos = [...porMotivo].map(([m, n]) => (n > 1 ? `${m} (${n})` : m)).join('; ')
  const trechoIgnorados = `${ignorados} ${ignorados === 1 ? 'ignorado' : 'ignorados'}: ${motivos}.`

  if (ok === 0) return { tipo: 'falha', texto: `Nenhum ticket foi alterado. ${trechoIgnorados}` }
  return { tipo: 'parcial', texto: `${feitos}. ${trechoIgnorados}` }
}
