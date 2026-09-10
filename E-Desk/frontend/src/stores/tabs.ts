import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getTabsServidor, putTabsServidor, type TicketResumo } from '@/api/tabs'

/**
 * Abas de ticket — contrato em docs/06-abas-frontend.md e
 * docs/07-arquitetura-frontend.md.
 *
 *   - Fonte primária: o FRONTEND. Abrir/fechar/trocar aba é local e síncrono,
 *     nunca espera rede.
 *   - localStorage (via `persist`) cobre o F5.
 *   - O servidor é o espelho durável: só a LISTA de tickets abertos e a aba
 *     ativa. Rascunho e posição de scroll NUNCA são enviados — são "voláteis
 *     e potencialmente sensíveis demais para persistir sem criptografia"
 *     (docs/06) — por isso `atualizarScroll`/`atualizarRascunho` não chamam
 *     `agendarSync`.
 *   - Reconciliação: o backend nunca devolve ticket fora de `visible_to(user)`;
 *     uma aba que perdeu acesso some em silêncio, inclusive na volta (GET).
 */

export interface Aba {
  ticketId: number
  /** Resumo hidratado pelo servidor — undefined logo após abrir localmente,
   *  antes da próxima reconciliação preencher. */
  resumo?: TicketResumo
  scroll: number
  draft: string
}

interface TabsState {
  tabs: Aba[]
  active: number | null
  /** true enquanto a reconciliação inicial (GET) não voltou — a TabBar deve
   *  mostrar o que já tinha em localStorage, não esperar a rede (docs/06). */
  reconciliando: boolean

  abrir: (ticketId: number, resumo?: TicketResumo) => void
  fechar: (ticketId: number) => void
  definirAtiva: (ticketId: number) => void
  atualizarScroll: (ticketId: number, scroll: number) => void
  atualizarRascunho: (ticketId: number, draft: string) => void
  reconciliar: () => Promise<void>
}

let reconciliacaoEmVoo: Promise<void> | null = null

const DEBOUNCE_MS = 2000 // docs/06; o backend (UserTicketTabs) já tolera bem
// menos (~600ms, docs/07) — 2s do lado do cliente evita disparar PUT a cada
// clique de troca de aba em sequência rápida.
let debounceHandle: ReturnType<typeof setTimeout> | undefined

function sincronizarComServidor() {
  clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    const { tabs, active } = useTabs.getState()
    putTabsServidor({ ticket_ids: tabs.map((t) => t.ticketId), active_ticket_id: active })
      .then(aplicarVerdadeDoServidor)
      .catch(() => {
        // Melhor esforço — rede caiu, a próxima mudança de aba tenta de novo.
        // Não há como isto travar a UI: abrir/fechar já aconteceu localmente.
      })
  }, DEBOUNCE_MS)
}

/** A resposta do servidor (já filtrada por visibilidade) vira a verdade —
 *  mas preserva scroll/draft locais das abas que sobreviveram. */
function aplicarVerdadeDoServidor(resposta: { tabs: TicketResumo[]; active_ticket_id: number | null }) {
  const locaisPorId = new Map(useTabs.getState().tabs.map((a) => [a.ticketId, a]))
  const tabs: Aba[] = resposta.tabs.map((resumo) => ({
    ticketId: resumo.id,
    resumo,
    scroll: locaisPorId.get(resumo.id)?.scroll ?? 0,
    draft: locaisPorId.get(resumo.id)?.draft ?? '',
  }))
  useTabs.setState({ tabs, active: resposta.active_ticket_id, reconciliando: false })
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      active: null,
      reconciliando: true,

      abrir: (ticketId, resumo) => {
        const jaAberta = get().tabs.some((a) => a.ticketId === ticketId)
        set((s) => ({
          tabs: jaAberta
            ? s.tabs.map((a) => (a.ticketId === ticketId && resumo ? { ...a, resumo } : a))
            : [...s.tabs, { ticketId, resumo, scroll: 0, draft: '' }],
          active: ticketId,
        }))
        sincronizarComServidor()
      },

      fechar: (ticketId) => {
        set((s) => {
          const tabs = s.tabs.filter((a) => a.ticketId !== ticketId)
          const active =
            s.active === ticketId ? (tabs.at(-1)?.ticketId ?? null) : s.active
          return { tabs, active }
        })
        sincronizarComServidor()
      },

      definirAtiva: (ticketId) => {
        set({ active: ticketId })
        sincronizarComServidor()
      },

      // Local apenas — nunca aciona sync com o servidor (docs/06).
      atualizarScroll: (ticketId, scroll) => {
        set((s) => ({
          tabs: s.tabs.map((a) => (a.ticketId === ticketId ? { ...a, scroll } : a)),
        }))
      },
      atualizarRascunho: (ticketId, draft) => {
        set((s) => ({
          tabs: s.tabs.map((a) => (a.ticketId === ticketId ? { ...a, draft } : a)),
        }))
      },

      reconciliar: () => {
        // Dedup de chamada em voo: o StrictMode do React roda efeitos duas
        // vezes em dev (TabBar chama reconciliar() no mount) — sem isto, cada
        // carga de tela dispara DOIS GET/PUT reais em /tickets/tabs/. Mesma
        // categoria do bug de socket duplicado que docs/07 mediu, só que aqui
        // com fetch: a correção é devolver a MESMA promise a quem chamar
        // enquanto a primeira ainda está em voo, não abrir uma segunda.
        if (reconciliacaoEmVoo) return reconciliacaoEmVoo

        reconciliacaoEmVoo = (async () => {
          // NÃO capture `get().tabs` antes do await: abrir()/fechar() rodam
          // enquanto o GET está em voo (é exatamente o que a Página de
          // Detalhe faz ao montar junto com a TabBar) e são locais e
          // síncronos por contrato (docs/06). Ler antes do await pegaria uma
          // fotografia velha e a resposta do servidor apagaria a aba que
          // acabou de abrir por cima dela.
          const servidor = await getTabsServidor()
          const locais = get().tabs
          const idsServidor = new Set(servidor.tabs.map((t) => t.id))
          const idsSoLocais = locais.map((a) => a.ticketId).filter((id) => !idsServidor.has(id))

          if (idsSoLocais.length === 0) {
            aplicarVerdadeDoServidor(servidor)
            return
          }

          // "união = servidor ∪ (local que o servidor não conhece)" (docs/07)
          // — manda pro servidor validar/filtrar; a resposta do PUT vira a verdade.
          const uniao = [...servidor.tabs.map((t) => t.id), ...idsSoLocais]
          const respostaDoPut = await putTabsServidor({
            ticket_ids: uniao,
            active_ticket_id: get().active ?? servidor.active_ticket_id,
          })
          aplicarVerdadeDoServidor(respostaDoPut)
        })().finally(() => {
          reconciliacaoEmVoo = null
        })
        return reconciliacaoEmVoo
      },
    }),
    {
      name: 'resolv:tabs',
      // reconciliando nunca persiste — cada carga da página começa
      // reconciliando de novo, mesmo com abas já hidratadas do localStorage.
      partialize: (s) => ({ tabs: s.tabs, active: s.active }),
    },
  ),
)
