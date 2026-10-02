import { ROTULO_PRIORIDADE, ROTULO_STATUS } from './format'
import {
  ROTULO_PERIODO,
  ROTULO_SLA,
  dataCurta,
  valoresDe,
  type ChaveFiltro,
  type Filtros,
} from './filtros'
import type { Facetas, OpcaoFaceta } from './tipos'

/**
 * As dimensões da barra de filtros e de onde vêm as opções de cada uma.
 * Sem React: a barra do computador (BarraFiltros) e a folha do celular
 * (FiltrosMobile) desenham a MESMA lista, e o teste lê daqui.
 */

export type ChaveDimensao = Exclude<ChaveFiltro, 'desde' | 'ate' | 'solicitante'>

export interface Dimensao {
  chave: ChaveDimensao
  rotulo: string
  multiplo: boolean
  /** Sempre à vista na barra. As outras entram por "Mais filtros" e só
   *  viram pílula quando têm valor — nove pílulas lado a lado não cabem na
   *  coluna da fila e a maioria fica vazia na maior parte do tempo. */
  principal: boolean
}

export const DIMENSOES: Dimensao[] = [
  { chave: 'status', rotulo: 'Status', multiplo: true, principal: true },
  { chave: 'priority', rotulo: 'Prioridade', multiplo: true, principal: true },
  { chave: 'assignee', rotulo: 'Responsável', multiplo: false, principal: true },
  { chave: 'sla', rotulo: 'SLA', multiplo: false, principal: true },
  { chave: 'periodo', rotulo: 'Período', multiplo: false, principal: true },
  { chave: 'team', rotulo: 'Equipe', multiplo: false, principal: false },
  { chave: 'empresa', rotulo: 'Empresa', multiplo: false, principal: false },
  { chave: 'category', rotulo: 'Categoria', multiplo: false, principal: false },
  { chave: 'tag', rotulo: 'Etiqueta', multiplo: false, principal: false },
]

export interface Opcao {
  valor: string
  rotulo: string
  /** Quantos tickets viriam com esta opção (faceta). Ausente = não se sabe
   *  (faceta ainda carregando ou dimensão sem contagem, como o período). */
  contagem?: number
}

function daFaceta(linhas: OpcaoFaceta[] | undefined): Opcao[] {
  return (linhas ?? [])
    .filter((l) => l.value != null)
    .map((l) => ({ valor: String(l.value), rotulo: l.label, contagem: l.count }))
}

function fixas(rotulos: Record<string, string>, linhas: OpcaoFaceta[] | undefined): Opcao[] {
  const porValor = new Map((linhas ?? []).map((l) => [String(l.value), l.count]))
  return Object.entries(rotulos).map(([valor, rotulo]) => ({
    valor,
    rotulo,
    contagem: linhas ? (porValor.get(valor) ?? 0) : undefined,
  }))
}

/**
 * Opções de uma dimensão. Enums pequenos (status, prioridade, SLA, período)
 * aparecem sempre, zero incluso — saber que não há nenhum "Baixa" agora é
 * informação. As abertas (equipe, empresa...) vêm da faceta, que só traz
 * quem tem ticket.
 *
 * Responsável ganha as duas perguntas que um agente realmente faz antes da
 * lista de nomes: "os meus" e "os sem dono" (`?assignee=me|unassigned`).
 */
export function opcoesDe(
  chave: ChaveDimensao,
  facetas: Facetas | undefined,
  meuId?: number,
): Opcao[] {
  switch (chave) {
    case 'status':
      return fixas(ROTULO_STATUS, facetas?.status)
    case 'priority':
      return fixas(ROTULO_PRIORIDADE, facetas?.priority)
    case 'sla':
      return fixas(ROTULO_SLA, facetas?.sla)
    case 'periodo':
      return Object.entries(ROTULO_PERIODO).map(([valor, rotulo]) => ({ valor, rotulo }))
    case 'assignee': {
      const linhas = facetas?.assignee
      const contar = (pred: (l: OpcaoFaceta) => boolean) =>
        linhas ? (linhas.find(pred)?.count ?? 0) : undefined
      const pessoas = daFaceta(linhas).filter((o) => o.valor !== String(meuId))
      return [
        { valor: 'me', rotulo: 'Eu', contagem: contar((l) => meuId != null && l.value === meuId) },
        {
          valor: 'unassigned',
          rotulo: 'Sem responsável',
          contagem: contar((l) => l.value == null),
        },
        ...pessoas,
      ]
    }
    case 'team':
      return daFaceta(facetas?.team)
    case 'empresa':
      return daFaceta(facetas?.company)
    case 'category':
      return daFaceta(facetas?.category)
    case 'tag':
      return daFaceta(facetas?.tag)
  }
}

/** Valores selecionados de uma dimensão, na forma de lista. */
export function selecionadosDe(chave: ChaveDimensao, filtros: Filtros): string[] {
  return valoresDe(filtros[chave])
}

/**
 * As opções + os selecionados que a faceta não trouxe (uma empresa marcada
 * que, com os outros filtros, ficou com zero): somem da faceta, mas não
 * podem sumir da tela — senão não haveria onde desmarcar.
 */
export function opcoesComSelecionados(opcoes: Opcao[], selecionados: string[]): Opcao[] {
  const conhecidos = new Set(opcoes.map((o) => o.valor))
  const faltando = selecionados
    .filter((v) => !conhecidos.has(v))
    .map((v) => ({ valor: v, rotulo: v, contagem: 0 }))
  return [...opcoes, ...faltando]
}

/** Texto da pílula ativa: "Alta, Urgente", "Eu", "03/09 a 10/09". Até dois
 *  nomes; do terceiro em diante vira "+N" para a pílula não empurrar a barra. */
export function resumoDaDimensao(
  chave: ChaveDimensao,
  filtros: Filtros,
  opcoes: Opcao[],
): string | null {
  if (chave === 'periodo') {
    if (filtros.periodo) return ROTULO_PERIODO[filtros.periodo] ?? filtros.periodo
    if (filtros.desde && filtros.ate)
      return `${dataCurta(filtros.desde)} a ${dataCurta(filtros.ate)}`
    if (filtros.desde) return `desde ${dataCurta(filtros.desde)}`
    if (filtros.ate) return `até ${dataCurta(filtros.ate)}`
    return null
  }
  const valores = selecionadosDe(chave, filtros)
  if (valores.length === 0) return null
  const porValor = new Map(opcoes.map((o) => [o.valor, o.rotulo]))
  const nomes = valores.map((v) => porValor.get(v) ?? v)
  return nomes.length > 2
    ? `${nomes.slice(0, 2).join(', ')} +${nomes.length - 2}`
    : nomes.join(', ')
}

export function dimensaoAtiva(chave: ChaveDimensao, filtros: Filtros): boolean {
  if (chave === 'periodo') return Boolean(filtros.periodo || filtros.desde || filtros.ate)
  return Boolean(filtros[chave])
}

export type MudancaDeFiltro = Partial<Record<ChaveFiltro, string | undefined>>

/**
 * Aplica o clique numa opção: lista (status, prioridade) liga/desliga o
 * valor; valor único troca, e clicar no que já está marcado desmarca — é o
 * jeito de "voltar a todos" sem procurar outro botão.
 */
export function mudancaAoAlternar(d: Dimensao, filtros: Filtros, valor: string): MudancaDeFiltro {
  if (d.chave === 'periodo') {
    return {
      periodo: filtros.periodo === valor ? undefined : valor,
      desde: undefined,
      ate: undefined,
    }
  }
  if (d.multiplo) {
    const atuais = valoresDe(filtros[d.chave])
    const novos = atuais.includes(valor) ? atuais.filter((v) => v !== valor) : [...atuais, valor]
    return { [d.chave]: novos.join(',') || undefined }
  }
  return { [d.chave]: filtros[d.chave] === valor ? undefined : valor }
}

export function mudancaAoLimpar(chave: ChaveDimensao): MudancaDeFiltro {
  return chave === 'periodo'
    ? { periodo: undefined, desde: undefined, ate: undefined }
    : { [chave]: undefined }
}
