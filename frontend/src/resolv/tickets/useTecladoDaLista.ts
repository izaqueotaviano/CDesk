import { useEffect, useRef, useState, type RefObject } from 'react'

/** Tipos de `<input>` que não são digitação: nesses a tecla "x" ainda é
 *  atalho (a caixa de seleção da própria linha está focada, por exemplo). */
const INPUTS_SEM_TEXTO = new Set(['checkbox', 'radio', 'button', 'submit', 'reset'])

function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false
  if (alvo.isContentEditable) return true
  if (alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLSelectElement) return true
  if (alvo instanceof HTMLInputElement) return !INPUTS_SEM_TEXTO.has(alvo.type)
  return false
}

interface Opcoes {
  /** Quem contém as linhas (`[data-linha="N"]`): a tabela ou os cartões. */
  refContainer: RefObject<HTMLElement | null>
  quantidade: number
  onAbrir: (indice: number) => void
  onAlternar: (indice: number) => void
}

/**
 * Navegação da fila pelo teclado — as teclas que o catálogo de atalhos
 * (resolv/atalhos/catalogo.ts, painel "?") anuncia para a lista:
 *
 * - `j` / `k`: próxima / anterior linha;
 * - `Enter` ou `o`: abrir o ticket da linha focada;
 * - `x`: marcar/desmarcar a linha focada.
 *
 * Foco ROVING: só a linha "atual" tem `tabIndex=0` (o Tab entra na lista
 * uma vez só, não 25), e é o foco real do navegador que anda — o anel de
 * foco visível e o leitor de tela acompanham sem estado paralelo.
 *
 * Fica quieto quando a pessoa está digitando (campo de texto, select,
 * contenteditable), com Ctrl/Cmd/Alt (são atalhos do navegador e do shell),
 * com um diálogo modal aberto, ou com o foco dentro de um popover/menu (as
 * setas e letras ali são dele).
 */
export function useTecladoDaLista({ refContainer, quantidade, onAbrir, onAlternar }: Opcoes) {
  const [indiceFocado, setIndiceFocado] = useState(0)
  // "Última versão" dos callbacks e do índice para o ouvinte do documento,
  // que é registrado uma vez só (não a cada render).
  const refEstado = useRef({ indiceFocado, quantidade, onAbrir, onAlternar })
  useEffect(() => {
    refEstado.current = { indiceFocado, quantidade, onAbrir, onAlternar }
  })

  // Página nova com menos linhas: o índice lembrado não pode apontar para
  // uma linha que não existe (ficaria sem nenhuma com tabIndex=0).
  const indiceValido = quantidade === 0 ? 0 : Math.min(indiceFocado, quantidade - 1)

  useEffect(() => {
    function focar(indice: number) {
      const el = refContainer.current?.querySelector<HTMLElement>(`[data-linha="${indice}"]`)
      if (!el) return
      el.focus()
      // `focus()` já rola até a linha; `nearest` evita pular a página
      // inteira quando ela já está quase à vista.
      el.scrollIntoView?.({ block: 'nearest' })
      setIndiceFocado(indice)
    }

    function aoTeclar(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
      if (!['j', 'k', 'o', 'x', 'Enter'].includes(e.key)) return
      if (ehCampoDeTexto(e.target)) return
      if (document.querySelector('[aria-modal="true"]')) return
      const ativo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (ativo?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return

      const container = refContainer.current
      const { quantidade: total, indiceFocado: lembrado } = refEstado.current
      if (!container || total === 0) return
      const linha = ativo?.closest<HTMLElement>('[data-linha]')
      const atual = linha && container.contains(linha) ? Number(linha.dataset.linha) : -1

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault()
        // Fora da lista, a primeira tecla só ENTRA nela (na linha lembrada);
        // a partir daí, anda.
        if (atual < 0) focar(Math.min(lembrado, total - 1))
        else focar(e.key === 'j' ? Math.min(total - 1, atual + 1) : Math.max(0, atual - 1))
        return
      }
      if (atual < 0) return
      // Enter só na LINHA em si: com o foco no link do protocolo ou na caixa
      // de seleção, o Enter é deles (o link já navega sozinho).
      if (e.key === 'Enter' && ativo !== linha) return
      e.preventDefault()
      if (e.key === 'x') refEstado.current.onAlternar(atual)
      else refEstado.current.onAbrir(atual)
    }

    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [refContainer])

  return { indiceFocado: indiceValido, setIndiceFocado }
}
