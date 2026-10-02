/**
 * Filtros do quadro — tudo no cliente, sobre o `entries` que já veio.
 *
 * O quadro montado (`GET boards/{id}/cards/`) já traz assunto, referência,
 * cliente, empresa, responsável, prioridade, prazo e SLA de cada cartão, e é
 * uma resposta só (a fila de não resolvidos inteira, sem paginação). Filtrar
 * no servidor seria um round-trip por tecla para recortar o que a tela já
 * tem; aqui o recorte é instantâneo e as colunas continuam vindo completas,
 * o que importa para o limite de WIP (que conta a coluna inteira, não o
 * recorte).
 *
 * O estado mora na URL (`useSearchParams`), como na fila de chamados: abrir
 * um cartão e voltar mantém o recorte, e o link pode ser mandado para alguém.
 */
import type { Prioridade } from '../tickets/tipos'
import type { Cartao } from './tipos'

export interface Filtros {
  /** Texto livre: assunto, referência, cliente ou empresa. */
  busca: string
  /** `''` (todos) | `'eu'` | `'nenhum'` | id do agente. */
  responsavel: string
  prioridade: Prioridade | ''
  /** Nome da empresa — o quadro não traz o id dela, e o nome é o que se vê. */
  empresa: string
  /** Prazo interno vencido OU algum SLA estourado. */
  atrasados: boolean
}

export const FILTROS_VAZIOS: Filtros = {
  busca: '',
  responsavel: '',
  prioridade: '',
  empresa: '',
  atrasados: false,
}

/** Nomes curtos e em português na URL — é o que aparece no link copiado. */
const PARAM = {
  busca: 'busca',
  responsavel: 'responsavel',
  prioridade: 'prioridade',
  empresa: 'empresa',
  atrasados: 'atrasados',
} as const

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

export function filtrosDaUrl(params: URLSearchParams): Filtros {
  const prioridade = params.get(PARAM.prioridade) ?? ''
  return {
    busca: params.get(PARAM.busca) ?? '',
    responsavel: params.get(PARAM.responsavel) ?? '',
    // valor que não existe (link antigo, digitado à mão) vira "todas" em
    // vez de um filtro que esconde tudo sem explicação
    prioridade: (PRIORIDADES as string[]).includes(prioridade) ? (prioridade as Prioridade) : '',
    empresa: params.get(PARAM.empresa) ?? '',
    atrasados: params.get(PARAM.atrasados) === '1',
  }
}

/** Aplica mudanças preservando as outras chaves da URL (inclusive as que
 *  não são filtro). Valor vazio remove a chave: a URL sem filtro fica limpa. */
export function aplicarNaUrl(atual: URLSearchParams, mudancas: Partial<Filtros>): URLSearchParams {
  const novo = new URLSearchParams(atual)
  for (const [campo, valor] of Object.entries(mudancas) as [keyof Filtros, Filtros[keyof Filtros]][]) {
    const chave = PARAM[campo]
    const texto = typeof valor === 'boolean' ? (valor ? '1' : '') : String(valor ?? '').trim()
    if (texto) novo.set(chave, texto)
    else novo.delete(chave)
  }
  return novo
}

export function temFiltroAtivo(f: Filtros): boolean {
  return Boolean(f.busca.trim() || f.responsavel || f.prioridade || f.empresa || f.atrasados)
}

/** Minúsculas e sem acento: "joao" acha "João", "orcamento" acha "Orçamento". */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** "Atrasado" no quadro = algum relógio já passou: o prazo interno do
 *  cartão ou um dos SLAs contratuais. Os dois são cobrados de quem trabalha
 *  a fila, e o filtro existe para achar o que já devia ter andado. */
export function estaAtrasado(c: Cartao): boolean {
  return c.is_overdue || c.sla.first_response.state === 'breached' || c.sla.resolution.state === 'breached'
}

export function filtrarCartoes(cartoes: Cartao[], f: Filtros, meuId: number | null): Cartao[] {
  const termo = normalizar(f.busca.trim())
  return cartoes.filter((c) => {
    if (termo) {
      const alvo = normalizar(
        [c.subject, c.ticket_reference, c.requester_display, c.company_name].join(' '),
      )
      if (!alvo.includes(termo)) return false
    }
    if (f.responsavel === 'eu') {
      // sem sessão carregada, "Eu" não casa com ninguém — melhor mostrar
      // vazio do que ignorar o filtro e fingir que são os meus
      if (meuId == null || c.assignee_id !== meuId) return false
    } else if (f.responsavel === 'nenhum') {
      if (c.assignee_id != null) return false
    } else if (f.responsavel) {
      if (String(c.assignee_id) !== f.responsavel) return false
    }
    if (f.prioridade && c.priority !== f.prioridade) return false
    if (f.empresa && c.company_name !== f.empresa) return false
    if (f.atrasados && !estaAtrasado(c)) return false
    return true
  })
}

/** Quem aparece no seletor de responsável: só quem TEM chamado no quadro,
 *  em ordem alfabética. Listar a agência inteira ofereceria filtros que
 *  sempre dão vazio. */
export function responsaveisDoQuadro(cartoes: Cartao[]): { id: number; nome: string }[] {
  const mapa = new Map<number, string>()
  for (const c of cartoes) {
    if (c.assignee_id != null && c.assignee_name) mapa.set(c.assignee_id, c.assignee_name)
  }
  return [...mapa].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export function empresasDoQuadro(cartoes: Cartao[]): string[] {
  const nomes = new Set(cartoes.map((c) => c.company_name).filter(Boolean))
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
