/**
 * Como dirigir os controles do @material/web num teste.
 *
 * Um `<input>` nativo aceita `fireEvent.change(el, { target: { value } })`
 * porque o `dom-testing-library` acha o setter de `value` no protótipo
 * IMEDIATO do elemento. Nos componentes do Material o `value` é declarado
 * duas ou três classes acima (`MdOutlinedTextField` → `OutlinedTextField` →
 * `TextField`), que é onde a busca do testing-library para — daí o
 * "The given element does not have a value setter".
 *
 * As duas funções abaixo fazem o que o componente faz quando a pessoa digita
 * ou escolhe: escrevem a PROPRIEDADE e disparam o evento que o wrapper ouve
 * (ver ui/material/index.tsx). Nada de simular tecla a tecla — o teclado quem
 * trata é o componente, e ele é do Google, não deste repositório.
 */

/** Digita num md-*-text-field (o `input` é o evento de cada tecla). */
export function digitar(campo: Element, valor: string) {
  ;(campo as HTMLElement & { value: string }).value = valor
  campo.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
}

/**
 * Escolhe uma opção de um md-*-select pelo `value` dela.
 *
 * Assíncrona porque o `value` do select só "pega" depois que o menu terminou
 * de renderizar: o setter procura a opção na lista (`select.js::select()`) e,
 * antes do primeiro update do Lit, essa lista está vazia — o valor seria
 * descartado em silêncio. Daí também a conferência no fim: se um dia o valor
 * não entrar, o teste falha dizendo isso, em vez de falhar três linhas adiante
 * por um endpoint que nunca foi chamado.
 */
export async function escolher(select: Element, valor: string) {
  const el = select as HTMLElement & { value: string; updateComplete?: Promise<unknown> }
  await el.updateComplete
  el.value = valor
  if (el.value !== valor) {
    throw new Error(`O <${el.localName}> não aceitou o valor ${JSON.stringify(valor)} — opção inexistente?`)
  }
  select.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
}
