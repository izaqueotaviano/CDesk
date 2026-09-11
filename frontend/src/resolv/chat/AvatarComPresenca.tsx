import type { Presenca } from '@/ui/Avatar'
import { iniciais } from './format'
import { tomDeChat, type IndiceDeChat } from './tons'

/** Onde o avatar está pousado — o recorte da bolinha é uma borda NA COR
 *  desse fundo, então ele precisa ser dito. */
export type FundoDoAvatar = 'card' | 'canvas' | 'superficie' | 'cabecalho'

/**
 * O avatar do console com a bolinha de disponibilidade.
 *
 * O console desenhava o avatar como um `<span>` solto com a cor de
 * identidade — sem lugar para o estado. Em vez de trocar por outro
 * componente de avatar (o `ui/Avatar` do portal, o `cvz/Avatar` do admin),
 * este envolve o que já existe: a marcação e a classe continuam as mesmas,
 * e só o ponto é novo. Trocar o avatar do console inteiro seria mexer em
 * lista, cabeçalho, mini chat e mensagens de uma vez, fora do escopo desta
 * correção.
 *
 * Sem `presenca` nada é desenhado — uma bolinha cinza "por padrão"
 * afirmaria "offline" sobre quem o sistema simplesmente não sabe.
 */
export function AvatarComPresenca({
  nome,
  presenca,
  classe = 'cc-card__avatar',
  fundo = 'card',
  tom,
}: {
  nome: string
  presenca?: Presenca | null
  /** A classe que já vestia o `<span>` — o visual não muda. */
  classe?: string
  /** Superfície de trás, para o recorte da bolinha. */
  fundo?: FundoDoAvatar
  /**
   * O tom da paleta do chat (resolv/chat/tons.ts): por padrão o do NOME (o
   * que a lista já fazia). Um índice fixa o tom (o mini chat pinta a aba
   * pela cor do atendimento, já resolvida por `tonsDistintos` pra não
   * colidir com outra conversa aberta) e `null` não escreve atributo
   * nenhum — é o caso do cabeçalho do painel, que herda a cor do bloco em
   * volta.
   */
  tom?: IndiceDeChat | null
}) {
  const identidade = tom === undefined ? tomDeChat(nome) : tom === null ? {} : { 'data-tom-chat': tom }
  return (
    <span className={`cc-avatar ${classe}`} {...identidade}>
      {iniciais(nome)}
      {presenca && (
        <span
          className={`cc-avatar__ponto cc-avatar__ponto--${presenca} cc-avatar__ponto--em-${fundo}`}
          aria-hidden="true"
        />
      )}
      {presenca && <span className="cc-visualmente-oculto">{ROTULO[presenca]}</span>}
    </span>
  )
}

const ROTULO: Record<Presenca, string> = {
  available: 'disponível',
  away: 'ausente',
  offline: 'offline',
}
