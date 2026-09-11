/**
 * Ponte entre os custom elements do @material/web e o React 18.
 *
 * O React 19 fala com custom element nativamente: propriedade vira
 * propriedade, evento customizado vira `on...`. O 18 — que é o desta base —
 * NÃO faz isso: ele escreve tudo como ATRIBUTO (então `error={false}` vira
 * `error="false"`, que é verdadeiro no DOM) e só conhece os eventos da lista
 * dele. Sem uma ponte, `value`, `selected`, `indeterminate` e os eventos de
 * diálogo simplesmente não funcionam.
 *
 * Esta ponte faz o mínimo necessário, e faz certo:
 *  - `propriedades` são escritas como PROPRIEDADE no elemento, depois que ele
 *    é definido (`whenDefined`), e reescritas quando mudam;
 *  - `eventos` são registrados com `addEventListener` de verdade, o que
 *    também cobre os que o React não conhece (`close`, `cancel`, `opening`).
 *
 * Quem usa isto são os componentes deste diretório; nenhuma tela chama a
 * ponte direto.
 */
import { useEffect, useRef, type RefObject } from 'react'

type Props = Record<string, unknown>
type Eventos = Record<string, ((e: Event) => void) | undefined>

/** Espera o elemento existir para só então escrever nele. */
function aoDefinir(el: HTMLElement, acao: () => void) {
  const nome = el.localName
  if (!nome.includes('-') || customElements.get(nome)) {
    acao()
    return
  }
  // `whenDefined` resolve no microtask seguinte à definição; se o componente
  // desmontar antes disso, o `acao` escreve num elemento fora da árvore —
  // inofensivo, e mais simples que carregar um flag de cancelamento.
  void customElements.whenDefined(nome).then(acao)
}

export function useElementoMaterial<T extends HTMLElement>(
  propriedades: Props,
  eventos: Eventos = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null)

  // As propriedades são reescritas a cada render em que MUDAM de valor. O
  // objeto `propriedades` é literal e muda de identidade todo render, então a
  // dependência é o conteúdo serializado, não o objeto.
  const chave = JSON.stringify(propriedades)
  const primeiraEscritaFeita = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const escrever = () => {
      for (const [nome, valor] of Object.entries(propriedades)) {
        if (valor === undefined) continue
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(el as any)[nome] = valor
      }
    }
    aoDefinir(el, () => {
      escrever()
      // Reescreve UMA vez depois do primeiro render do componente. Algumas
      // propriedades dependem do que já existe dentro dele: o `value` do
      // md-outlined-select procura a opção correspondente na lista do menu
      // (select.js::select()), e essa lista só existe depois do primeiro
      // update do Lit — antes disso o valor é descartado em silêncio e o campo
      // aparece vazio. Uma vez só, e só na montagem: repetir a cada tecla
      // mexeria no cursor de quem está digitando.
      if (primeiraEscritaFeita.current) return
      primeiraEscritaFeita.current = true
      const componente = el as HTMLElement & { updateComplete?: Promise<unknown> }
      void componente.updateComplete?.then(escrever)
    })
    // `propriedades` sai de propósito: quem manda é `chave`, o conteúdo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  // Os ouvintes ficam num ref para o efeito não reassinar a cada render por
  // causa de uma arrow function nova — o corpo do handler sempre lê o mais
  // recente. A escrita é num efeito sem lista de dependência (roda depois de
  // TODO render): mexer no ref durante o render é o que a regra
  // `react-hooks/refs` proíbe, e o handler só lê no evento, bem depois disso.
  const ouvintes = useRef(eventos)
  useEffect(() => {
    ouvintes.current = eventos
  })
  const nomes = Object.keys(eventos).sort().join(',')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const registrados = nomes ? nomes.split(',') : []
    const fns = registrados.map((nome) => {
      const fn = (e: Event) => ouvintes.current[nome]?.(e)
      el.addEventListener(nome, fn)
      return [nome, fn] as const
    })
    return () => fns.forEach(([nome, fn]) => el.removeEventListener(nome, fn))
  }, [nomes])

  return ref
}
