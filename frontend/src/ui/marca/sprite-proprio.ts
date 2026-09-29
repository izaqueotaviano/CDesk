/**
 * Símbolos desenhados NESTE projeto, na gramática do sprite da Convertize —
 * separados de `sprite.ts`, que é gerado a partir do kit e não deve receber
 * nada à mão (o gerador o reescreve).
 *
 * A gramática, lida do próprio kit:
 *   viewBox 24×24, formas CHEIAS (o `fill` vem de `currentColor`)
 *   class="s"  traço (sem preenchimento)
 *   class="a"  a SEGUNDA camada: 38% de opacidade, e vira laranja no item
 *              ativo. É ela que dá ao conjunto a leitura de duas cores.
 *
 * Por que existe
 * --------------
 * O sprite do kit é desenhado para painel de LOJA (cart, box, truck, store):
 * a Convertize é SaaS de e-commerce. O vocabulário de helpdesk não está lá, e
 * "Avisos" ficou sendo o único item da navegação com um Tabler de contorno
 * fino entre formas cheias — lia como defeito.
 *
 * O megafone cai bem na gramática de duas camadas: o cone é o corpo e as
 * ondas são o detalhe, a mesma composição de `i-phone` (aparelho + arco de
 * sinal) e `i-headset` (conchas + arco do arco de cabeça).
 */
export const SIMBOLOS_PROPRIOS: Record<string, string> = {
  // Megafone — a seção "Avisos" (mural de comunicados da equipe).
  megafone: `<symbol id="i-megafone" viewBox="0 0 24 24">`
    + `<path d="M3.4 10.1a1.7 1.7 0 0 1 1.7-1.7h1.8l8.4-4.6a1 1 0 0 1 1.5.9v14.6a1 1 0 0 1-1.5.9l-8.4-4.6H5.1a1.7 1.7 0 0 1-1.7-1.7Z"/>`
    + `<path d="M7.7 16.3h2.5l-.4 3.8a1.5 1.5 0 0 1-3-.2Z"/>`
    + `<path class="s a" stroke-width="2" d="M19.4 9.4a4 4 0 0 1 0 5.2"/>`
    + `<path class="s a" stroke-width="2" d="M21.4 7.2a7 7 0 0 1 0 9.6"/>`
    + `</symbol>`,
}
