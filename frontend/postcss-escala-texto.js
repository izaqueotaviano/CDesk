/**
 * Tamanho do texto (Minha conta → Aparência; Configurações do portal): toda
 * declaração `font-size` absoluta do CSS do app passa a ser multiplicada por
 * `--escala-texto`, que `stores/prefs.ts` carimba no <html> (1 no padrão).
 *
 * Por que no BUILD, e não com `zoom` nem com `rem`:
 *
 * - `zoom` no <html> foi o primeiro caminho testado e quebra coisa demais: no
 *   Chromium, `100vh` dentro de um elemento com zoom 1,25 vira 125% da tela
 *   (o shell do console e a sidebar usam `height: 100vh` e passam a rolar), e
 *   `getBoundingClientRect` devolve coordenadas já ampliadas, então tudo que
 *   posiciona pelo ponteiro (menu de contexto da "Trabalhando agora", arrasto
 *   do quadro e da lista, redimensionar o mini chat) sai deslocado pelo mesmo
 *   fator. Consertar isso seria mexer em cada um desses pontos.
 * - `rem` não alcança nada: o CSS do produto escreve tamanho de fonte em px
 *   (~470 declarações entre SCSS e Tailwind), e reescrever tudo em rem seria
 *   mexer em todas as telas para ganhar o que esta transformação dá de graça.
 *
 * O que muda é só o TEXTO (e os ícones Tabler, que são fonte e acompanham o
 * texto ao lado). Caixas, espaçamentos, larguras de coluna e pontos de quebra
 * ficam onde estão, então nada que mede a tela muda de comportamento.
 *
 * Valores relativos ao pai (em, %, ex, ch) ficam como estão: o pai já foi
 * escalado, e multiplicar de novo aplicaria o fator duas vezes. Palavras-chave
 * (`inherit`, `small`…) e zero também.
 */

const PALAVRAS_CHAVE =
  /^(inherit|initial|unset|revert|revert-layer|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|math)$/i
const ZERO = /^0(px|rem)?$/i
// Número seguido de unidade relativa ao PAI — já vem escalado de cima.
const RELATIVO_AO_PAI = /(^|[\s(,*/+-])[\d.]+(em|%|ex|ch|cap|lh)(?![a-z])/i
// O que vale a pena escalar: medida absoluta, ou um token (`var(--fs-corpo)`)
// que resolve para uma.
const ABSOLUTO = /[\d.](px|rem|pt)(?![a-z])|var\(/i

export function escalarFontSize(valor) {
  const v = valor.trim()
  if (v.includes('--escala-texto')) return v // já transformado (idempotente)
  if (PALAVRAS_CHAVE.test(v) || ZERO.test(v)) return v
  if (RELATIVO_AO_PAI.test(v)) return v
  if (!ABSOLUTO.test(v)) return v
  return `calc(${v} * var(--escala-texto, 1))`
}

export default function escalaDoTexto() {
  return {
    postcssPlugin: 'resolv-escala-texto',
    Declaration: {
      // Só a propriedade exata: `font-size-adjust` é outra coisa, e o atalho
      // `font:` não aparece no CSS do produto a não ser como `font: inherit`.
      'font-size'(decl) {
        const novo = escalarFontSize(decl.value)
        if (novo !== decl.value) decl.value = novo
      },
    },
  }
}
escalaDoTexto.postcss = true
