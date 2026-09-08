import { useCallback, useSyncExternalStore } from 'react'

/** Ponto em que o shell troca de forma: abaixo disto a sidebar vira gaveta e
 *  o painel de conteúdo perde o respiro (shell.scss e sidebar.scss usam o
 *  MESMO número em `@media` — mudar um sem o outro desalinha JS e CSS). */
export const CONSULTA_TELA_PEQUENA = '(max-width: 767px)'

const nada = () => {}

/**
 * `matchMedia` como estado de React: reage a redimensionamento de verdade,
 * não só à carga inicial — é o caso de quem arrasta a borda da janela pra
 * dividir a tela enquanto trabalha. `useSyncExternalStore` porque é
 * exatamente isso: uma fonte externa com subscribe/snapshot, sem efeito
 * espelhando estado.
 *
 * jsdom/SSR sem `matchMedia`: cai em "não casa", mesma tolerância de
 * `sistemaPrefereEscuro` (stores/prefs.ts) — o teste que precisar do outro
 * lado faz `vi.stubGlobal('matchMedia', …)`, como BotaoTema.test.tsx.
 */
export function useConsultaDeMidia(consulta: string): boolean {
  const assinar = useCallback(
    (aoMudar: () => void) => {
      const lista = window.matchMedia?.(consulta)
      if (!lista) return nada
      lista.addEventListener('change', aoMudar)
      return () => lista.removeEventListener('change', aoMudar)
    },
    [consulta],
  )
  const ler = useCallback(
    () => typeof window !== 'undefined' && window.matchMedia?.(consulta).matches === true,
    [consulta],
  )
  return useSyncExternalStore(assinar, ler, () => false)
}
