import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Estado só de INTERFACE do mini chat — quais atendimentos estão expandidos
 * em painel, se a fila (o balão) está aberta, e o rascunho de cada conversa.
 * Não confundir com dado de chat (mensagens, fila), que é servidor via
 * TanStack Query. O widget "vive fora do host de conteúdo" e "sobrevive à
 * troca de aba/rota" (docs/01-arquitetura.md §6), por isso este estado mora
 * num módulo, não dentro de uma rota: trocar de tela — ou de shell (Resolv ↔
 * cvzdesk) — não fecha o que a pessoa deixou aberto.
 *
 * `abertos` guarda só ids; quem decide se o id ainda vale é a lista "meus
 * atendimentos" do servidor (o painel some sozinho quando o chat encerra ou
 * é transferido — ver MiniChat.tsx).
 *
 * `rascunhos` é o que faz a MESMA conversa poder ser respondida de onde for
 * melhor: o texto digitado no painel do mini chat aparece no console (e
 * vice-versa), porque os dois leem daqui pelo id do chat — não de um
 * `useState` preso a cada instância. Some ao enviar.
 *
 * `abertos` e `rascunhos` PERSISTEM (localStorage, `resolv:chat-ui`): um F5
 * ou um link aberto no meio do atendimento não pode fechar os painéis nem
 * jogar fora o que a pessoa estava escrevendo. `filaAberta` não persiste —
 * é um popover, começa fechado. Ids que sobraram de atendimentos já
 * encerrados são podados pelo MiniChat com a lista do servidor (`podar`), e
 * o logout zera tudo (`limparTudo`) pra próxima pessoa nesta máquina não
 * herdar nada.
 */
interface ChatUiState {
  /** Chats expandidos, do mais antigo pro mais recente. */
  abertos: number[]
  /** O balão da fila está aberto (lista de quem espera, com "Pegar"). */
  filaAberta: boolean
  /** Texto do compositor por chat — compartilhado entre console e mini chat. */
  rascunhos: Record<number, string>
  abrir: (chatId: number, limite: number) => void
  fechar: (chatId: number) => void
  alternar: (chatId: number, limite: number) => void
  alternarFila: () => void
  fecharFila: () => void
  definirRascunho: (chatId: number, texto: string) => void
  limparRascunho: (chatId: number) => void
  /** Tira de `abertos` e `rascunhos` o que não é mais um atendimento meu. */
  podar: (validos: number[]) => void
  /** No logout: zera painéis, fila e rascunhos. */
  limparTudo: () => void
}

export const useChatUi = create<ChatUiState>()(
  persist(
    (set, get) => ({
      abertos: [],
      filaAberta: false,
      rascunhos: {},
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
      alternarFila: () => set((s) => ({ filaAberta: !s.filaAberta })),
      fecharFila: () => set({ filaAberta: false }),
      definirRascunho: (chatId, texto) =>
        set((s) => {
          if ((s.rascunhos[chatId] ?? '') === texto) return s
          if (texto === '') {
            const { [chatId]: _fora, ...resto } = s.rascunhos
            return { rascunhos: resto }
          }
          return { rascunhos: { ...s.rascunhos, [chatId]: texto } }
        }),
      limparRascunho: (chatId) =>
        set((s) => {
          if (!(chatId in s.rascunhos)) return s
          const { [chatId]: _fora, ...resto } = s.rascunhos
          return { rascunhos: resto }
        }),
      podar: (validos) =>
        set((s) => {
          const ok = new Set(validos)
          const abertos = s.abertos.filter((id) => ok.has(id))
          const sobras = Object.keys(s.rascunhos)
            .map(Number)
            .filter((id) => !ok.has(id))
          if (abertos.length === s.abertos.length && sobras.length === 0) return s
          const rascunhos = { ...s.rascunhos }
          for (const id of sobras) delete rascunhos[id]
          return { abertos, rascunhos }
        }),
      limparTudo: () => set({ abertos: [], filaAberta: false, rascunhos: {} }),
    }),
    {
      name: 'resolv:chat-ui',
      partialize: (s) => ({ abertos: s.abertos, rascunhos: s.rascunhos }),
      // Baseline explícita — mesmo motivo de `stores/tabs.ts`.
      version: 1,
    },
  ),
)
