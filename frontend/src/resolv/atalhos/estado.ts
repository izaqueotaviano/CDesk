import { create } from 'zustand'

/**
 * Painel "Atalhos de teclado" aberto ou não. Store e não estado do shell
 * porque três lugares abrem o mesmo painel sem se conhecerem: a tecla `?`
 * (AtalhosGlobais), o menu da conta (MenuPresenca) e o botão de ajuda de
 * quem mais quiser apontar para ele.
 */
interface EstadoPainelAtalhos {
  aberto: boolean
  abrir: () => void
  fechar: () => void
}

export const usePainelAtalhos = create<EstadoPainelAtalhos>()((set) => ({
  aberto: false,
  abrir: () => set({ aberto: true }),
  fechar: () => set({ aberto: false }),
}))

export function abrirPainelAtalhos() {
  usePainelAtalhos.getState().abrir()
}
