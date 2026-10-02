import { useEffect } from 'react'
import { useConsultaDeMidia } from '@/resolv/shell/useConsultaDeMidia'

/**
 * As três formas do console de chat, pela largura:
 *
 * - `tres` (≥1200px): lista | conversa | painel do cliente, lado a lado;
 * - `dois` (768–1199px): lista | conversa, e o painel vira uma FOLHA que
 *   abre por cima pelo botão "Detalhes do cliente";
 * - `um` (<768px): uma coisa por vez — lista, conversa (com voltar) e a
 *   folha de detalhes.
 *
 * Os números batem com os `@media` de chat.scss; o 767 é o MESMO corte do
 * shell (`CONSULTA_TELA_PEQUENA`), onde a sidebar vira gaveta.
 */
export const CONSULTA_UMA_COLUNA = '(max-width: 767px)'
export const CONSULTA_DUAS_COLUNAS = '(max-width: 1199px)'

export type ModoDoConsole = 'tres' | 'dois' | 'um'

export function useModoDoConsole(): ModoDoConsole {
  const uma = useConsultaDeMidia(CONSULTA_UMA_COLUNA)
  const duas = useConsultaDeMidia(CONSULTA_DUAS_COLUNAS)
  return uma ? 'um' : duas ? 'dois' : 'tres'
}

/**
 * A altura que SOBRA na tela, em `--cc-altura-visivel` no <html>.
 *
 * No celular, o teclado virtual cobre a parte de baixo da página sem mudar o
 * `100dvh` — e a parte de baixo é justamente onde mora o compositor. A
 * `visualViewport` diz quanto de tela ficou de fato à vista; o console usa
 * esse número como altura (chat.scss) e o compositor sobe junto com o
 * teclado, em vez de ficar escondido atrás dele.
 *
 * Zoom de pinça também encolhe a viewport visual, e ali o layout NÃO deve
 * acompanhar (a pessoa quer ver maior, não a página menor) — por isso só
 * vale com escala 1.
 */
export function useAlturaVisivel() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const raiz = document.documentElement
    const medir = () => {
      if (vv.scale > 1.01) {
        raiz.style.removeProperty('--cc-altura-visivel')
        return
      }
      raiz.style.setProperty('--cc-altura-visivel', `${Math.round(vv.height)}px`)
    }
    medir()
    vv.addEventListener('resize', medir)
    return () => {
      vv.removeEventListener('resize', medir)
      raiz.style.removeProperty('--cc-altura-visivel')
    }
  }, [])
}
