import { chaveDeSecao, chaveDeTicket } from '@/stores/tabs'
import { NAV } from './nav'

/**
 * Da URL para a aba: as regras que dizem qual aba da barra (BarraDeAbas.tsx)
 * a rota atual acende, e qual seção ela abre. Puro de propósito: a barra
 * chama isto no render, antes de qualquer efeito rodar, e é assim que a aba
 * certa acende num link direto, no voltar do navegador ou numa navegação
 * feita fora da barra (sidebar, busca, notificação).
 *
 * Três espécies de destino:
 *   - a Início (`/inicio`): aba fixa, fora do store;
 *   - um ticket (`/tickets/27`): aba de ticket, aberta por quem carrega o
 *     ticket (`PaginaDetalheTicket`), não por aqui;
 *   - uma seção: uma aba por rota, escolhida pelo MAIOR prefixo que casa.
 *     `/tickets` (a lista) e `/tickets/novo` são abas diferentes, embora uma
 *     seja prefixo da outra, e `/clientes/3` cai na aba Clientes.
 */

export interface DefinicaoDeSecao {
  /** Rota canônica: chave de dedup da aba (`secao:<rota>` no store). */
  rota: string
  rotulo: string
  /** Classe Tabler (`ti ti-*`). */
  icone: string
}

/** A lista de tickets: única seção cujo prefixo `/tickets/...` pertence a
 *  outras coisas (o ticket aberto, o "novo"). */
const ROTA_DA_LISTA = '/tickets'

/** Chave da aba fixa. Não colide com as do store (`ticket:`/`secao:`). */
export const CHAVE_INICIO = 'inicio'

/** Destinos que a Sidebar não lista como item de navegação, mas que ganham
 *  aba própria: o "Novo ticket" é a ação primária dela, e a conta mora no
 *  menu do rodapé. */
const SECOES_EXTRAS: DefinicaoDeSecao[] = [
  { rota: '/tickets/novo', rotulo: 'Novo ticket', icone: 'ti ti-file-plus' },
  { rota: '/conta', rotulo: 'Minha conta', icone: 'ti ti-user-circle' },
]

/** Rótulo e ícone saem do NAV da Sidebar: uma fonte só de nome, ícone e
 *  rota para a navegação e para as abas. Calendário (ainda inerte) e Início
 *  (aba fixa) ficam de fora. */
export const SECOES: DefinicaoDeSecao[] = [
  ...NAV.filter((n) => n.enabled && n.id !== 'inicio').map((n) => ({
    rota: n.route,
    rotulo: n.label,
    icone: n.icon,
  })),
  ...SECOES_EXTRAS,
]

/** Sem a barra final e sem diferenciar caixa: `/tickets/` e `/Tickets` são a
 *  mesma tela (o React Router também não diferencia). */
function normalizar(pathname: string): string {
  return (pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname).toLowerCase()
}

/** A seção da rota, pelo maior prefixo que casa (`/tickets/novo` ganha de
 *  `/tickets`). Não olha para ticket: `/tickets/27` é responsabilidade de
 *  `ticketDaRota`. Por isso a lista `/tickets` só casa com ela mesma: um
 *  `/tickets/abc` (ou qualquer outro caminho que não seja um ticket nem o
 *  "novo") é rota desconhecida e não acende a aba Tickets. */
export function secaoDaRota(pathname: string): DefinicaoDeSecao | undefined {
  const caminho = normalizar(pathname)
  let melhor: DefinicaoDeSecao | undefined
  for (const secao of SECOES) {
    const casa =
      caminho === secao.rota || (secao.rota !== ROTA_DA_LISTA && caminho.startsWith(`${secao.rota}/`))
    if (casa && (!melhor || secao.rota.length > melhor.rota.length)) melhor = secao
  }
  return melhor
}

export function secaoPorRota(rota: string): DefinicaoDeSecao | undefined {
  return SECOES.find((s) => s.rota === rota)
}

/** O id de `/tickets/27`; `undefined` para qualquer outro caminho. */
export function ticketDaRota(pathname: string): number | undefined {
  const m = normalizar(pathname).match(/^\/tickets\/(\d+)$/)
  return m ? Number(m[1]) : undefined
}

export interface AbaDaRota {
  /** Chave da aba que a rota acende: `inicio`, `ticket:27` ou `secao:/quadro`. */
  chave: string
  /** Presente quando a rota é de uma seção: a barra abre a aba dela. */
  secao?: DefinicaoDeSecao
}

/** Qual aba a URL acende. `null` quando nenhuma (uma rota que a barra não
 *  conhece, como uma página de erro): nenhuma aba fica em destaque. */
export function abaDaRota(pathname: string): AbaDaRota | null {
  if (normalizar(pathname) === '/inicio') return { chave: CHAVE_INICIO }
  const ticket = ticketDaRota(pathname)
  if (ticket !== undefined) return { chave: chaveDeTicket(ticket) }
  const secao = secaoDaRota(pathname)
  return secao ? { chave: chaveDeSecao(secao.rota), secao } : null
}

/** Depois de fechar `fechadas`, a aba mais próxima de `origem` que continua
 *  aberta: a da direita, ou a da esquerda se não houver. A Início nunca fecha,
 *  então é sempre a última da esquerda. `null` só se `origem` não está na lista. */
export function vizinhaAposFechar(chaves: string[], fechadas: Set<string>, origem: string): string | null {
  const i = chaves.indexOf(origem)
  if (i < 0) return null
  for (let j = i + 1; j < chaves.length; j++) if (!fechadas.has(chaves[j]!)) return chaves[j]!
  for (let j = i - 1; j >= 0; j--) if (!fechadas.has(chaves[j]!)) return chaves[j]!
  return null
}
