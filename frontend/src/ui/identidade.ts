/**
 * Cor de IDENTIDADE — o que distingue "esta pessoa" de "aquela" (avatar de
 * iniciais, selo de plano, série de gráfico por categoria). É uma paleta
 * separada da semântica (azul = ação, verde = sucesso, âmbar = alerta,
 * vermelho = perigo) de propósito: os seis tons daqui não querem dizer nada,
 * só ajudam a separar uma coisa da outra numa lista.
 *
 * Um único hash para o produto inteiro. Portal do cliente (ui/Avatar.tsx),
 * console do agente (resolv/*) e componentes cvz leem daqui — a mesma pessoa
 * cai na mesma cor dos dois lados da conversa. Os valores das seis cores
 * moram nas três árvores de tokens (styles/tokens.css, resolv/styles/
 * tokens.scss, cvz/styles/_theme.scss) e mudam juntos.
 *
 * Determinístico e sem estado: não é sorteio, não varia entre sessões nem
 * entre dispositivos. Normaliza caixa e espaços porque "Ana Silva" e
 * "ana silva " são a mesma pessoa vindo de dois cadastros.
 */

export const TONS_DE_IDENTIDADE = 6

export type IndiceDeIdentidade = 1 | 2 | 3 | 4 | 5 | 6

/**
 * O hash em si, parametrizado pela contagem de tons — é o que
 * `indiceDeIdentidade` usa com `TONS_DE_IDENTIDADE` (6, produto inteiro) e
 * `resolv/chat/tons.ts` usa com sua própria contagem (15, só chat): mesmo
 * algoritmo, paletas diferentes, sem duplicar a soma de char codes.
 */
export function indiceEmModulo(chave: string, tons: number): number {
  const normalizada = chave.trim().toLowerCase()
  const soma = [...normalizada].reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return (soma % tons) + 1
}

export function indiceDeIdentidade(chave: string): IndiceDeIdentidade {
  return indiceEmModulo(chave, TONS_DE_IDENTIDADE) as IndiceDeIdentidade
}

/**
 * Atributo pronto pra espalhar num elemento de iniciais:
 * `<span className="cc-card__avatar" {...identidadeDe(nome)}>`.
 * Quem pinta é o CSS, pelo atributo (resolv/styles/identidade.scss) — o
 * componente não precisa saber de cor nenhuma.
 */
export function identidadeDe(chave: string): { 'data-identidade': IndiceDeIdentidade } {
  return { 'data-identidade': indiceDeIdentidade(chave) }
}

/**
 * Tinta em vez de preenchimento: fundo a 14% e texto na cor. É o selo (plano
 * da empresa), não o avatar — resolv/styles/identidade.scss pinta pelo
 * atributo. Recebe o índice, não a chave, porque quem chama já decidiu o tom
 * (ver ui/planos.ts).
 */
export function tintaDeIdentidade(indice: IndiceDeIdentidade): { 'data-identidade-tinta': IndiceDeIdentidade } {
  return { 'data-identidade-tinta': indice }
}
