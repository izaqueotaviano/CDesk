import { create } from 'zustand'

/**
 * Estado só de INTERFACE do mini chat — quais atendimentos estão expandidos
 * em painel. Não confundir com dado de chat (mensagens, fila), que é
 * servidor via TanStack Query. O widget "vive fora do host de conteúdo" e
 * "sobrevive à troca de aba/rota" (docs/01-arquitetura.md §6), por isso
 * este estado mora num módulo, não dentro de uma rota: trocar de tela — ou
 * de shell (Resolv ↔ cvzdesk) — não fecha o que a pessoa deixou aberto.
 *
 * `abertos` guarda só ids; quem decide se o id ainda vale é a lista "meus
 * atendimentos" do servidor (o painel some sozinho quando o chat encerra ou
 * é transferido — ver MiniChat.tsx).
 */
interface ChatUiState {
  /** Chats expandidos, do mais antigo pro mais recente. */
  abertos: number[]
  abrir: (chatId: number, limite: number) => void
  fechar: (chatId: number) => void
  alternar: (chatId: number, limite: number) => void
}

export const useChatUi = create<ChatUiState>((set, get) => ({
  abertos: [],
  abrir: (chatId, limite) =>
    set((s) => {
      if (s.abertos.includes(chatId)) return s
      // acima do limite, o mais antigo dá lugar ao novo — nunca recusa o
      // clique em silêncio
      const proximos = [...s.abertos, chatId]
      return { abertos: proximos.slice(Math.max(0, proximos.length - Math.max(1, limite))) }
    }),
  fechar: (chatId) => set((s) => ({ abertos: s.abertos.filter((id) => id !== chatId) })),
  alternar: (chatId, limite) => {
    if (get().abertos.includes(chatId)) get().fechar(chatId)
    else get().abrir(chatId, limite)
  },
}))
