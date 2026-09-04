import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Tema = 'claro' | 'escuro' | 'sistema'
export type Densidade = 'confortavel' | 'compacta'

interface PrefsState {
  tema: Tema
  densidade: Densidade
  setTema: (tema: Tema) => void
  setDensidade: (densidade: Densidade) => void
}

/**
 * "Sistema" = SEM atributo `data-tema` no <html>: tokens.css já resolve o
 * padrão via `@media (prefers-color-scheme)` sozinho. Fixar o atributo aqui
 * pra espelhar `prefers-color-scheme` duplicaria a lógica de tema num lugar
 * que PROMPT-IMPLEMENTACAO.md pede explicitamente para não duplicar
 * ("Não duplique lógica de tema em componente").
 */
function aplicarTema(tema: Tema) {
  if (tema === 'sistema') {
    document.documentElement.removeAttribute('data-tema')
  } else {
    document.documentElement.setAttribute('data-tema', tema)
  }
}

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      tema: 'sistema',
      densidade: 'confortavel',
      setTema: (tema) => {
        aplicarTema(tema)
        set({ tema })
      },
      setDensidade: (densidade) => set({ densidade }),
    }),
    {
      name: 'resolv:prefs',
      onRehydrateStorage: () => (estado) => {
        if (estado) aplicarTema(estado.tema)
      },
    },
  ),
)
