import { create } from 'zustand'

/**
 * Estado só de INTERFACE do widget global de chat — não confundir com dado
 * de chat (mensagens, fila), que é servidor via TanStack Query. O widget
 * "vive fora do host de conteúdo" e "sobrevive à troca de aba/rota"
 * (docs/01-arquitetura.md), por isso este estado não pode morar dentro de
 * uma rota: precisa estar num nível que o React Router nunca desmonta.
 */
interface ChatUiState {
  aberto: boolean
  minimizado: boolean
  sessaoEmFoco: number | null
  abrir: (sessaoId?: number) => void
  minimizar: () => void
  fechar: () => void
  focarSessao: (sessaoId: number) => void
}

export const useChatUi = create<ChatUiState>((set) => ({
  aberto: false,
  minimizado: false,
  sessaoEmFoco: null,
  abrir: (sessaoId) => set({ aberto: true, minimizado: false, sessaoEmFoco: sessaoId ?? null }),
  minimizar: () => set({ minimizado: true }),
  fechar: () => set({ aberto: false, minimizado: false, sessaoEmFoco: null }),
  focarSessao: (sessaoId) => set({ sessaoEmFoco: sessaoId, aberto: true, minimizado: false }),
}))
