import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getTabsServidor, putTabsServidor, type TicketResumo } from '@/api/tabs'

/**
 * Abas do shell — contrato original em docs/06-abas-frontend.md, generalizado
 * na Fase 2 da unificação de shell (a barra que hoje é só de tickets passou a
 * cobrir também as seções da Sidebar — Tickets, Quadro, Chat, Clientes,
 * Avisos, Auditoria, Configurações, Relatórios).
 *
 * Duas espécies de aba, uma união marcada por `tipo`:
 *   - `ticket`  — o contrato de sempre. Múltiplas por vez, espelhadas no
 *     servidor (`/tickets/tabs/`), com rascunho e posição de scroll.
 *   - `secao`   — nova. NUNCA vai para o servidor: é navegação ambiente
 *     (qual área você tem aberta), não dado de trabalho — o mesmo raciocínio
 *     que já mantinha rascunho/scroll fora do PUT. Uma por rota (reabrir a
 *     mesma seção reaproveita a aba, nunca duplica).
 *
 * `chaveAba` é o identificador estável de UMA aba, dos dois tipos — é o que
 * `active` guarda agora (string, não mais o `ticketId` cru), e o que a barra
 * usa pra saber qual aba fechar/focar.
 */

export interface AbaTicket {
  tipo: 'ticket'
  ticketId: number
  /** Resumo hidratado pelo servidor — undefined logo após abrir localmente,
   *  antes da próxima reconciliação preencher. */
  resumo?: TicketResumo
  scroll: number
  draft: string
}

export interface AbaSecao {
  tipo: 'secao'
  /** Rota canônica da seção (a mesma da Sidebar) — chave de dedup: abrir de
   *  novo a mesma rota reaproveita esta aba, não duplica. */
  rota: string
  /** Rótulo fixo da aba — não muda com navegação interna à seção (o ?aba= de
   *  Configurações, por exemplo): é sempre "Configurações". */
  titulo: string
  /** Classe `ti ti-*` — a mesma da Sidebar, pra ícone da aba bater com o da
   *  navegação. */
  icone: string
}

export type Aba = AbaTicket | AbaSecao

export function chaveAba(aba: Aba): string {
  return aba.tipo === 'ticket' ? `ticket:${aba.ticketId}` : `secao:${aba.rota}`
}

function ehTicket(aba: Aba): aba is AbaTicket {
  return aba.tipo === 'ticket'
}

interface TabsState {
  tabs: Aba[]
  /** Chave da aba ativa (`chaveAba`) — string, não mais o ticketId cru. */
  active: string | null
  /** true enquanto a reconciliação inicial (GET) não voltou — a barra deve
   *  mostrar o que já tinha em localStorage, não esperar a rede (docs/06). */
  reconciliando: boolean

  abrirTicket: (ticketId: number, resumo?: TicketResumo) => void
  abrirSecao: (rota: string, titulo: string, icone: string) => void
  fechar: (chave: string) => void
  definirAtiva: (chave: string) => void
  atualizarScroll: (ticketId: number, scroll: number) => void
  atualizarRascunho: (ticketId: number, draft: string) => void
  reconciliar: () => Promise<void>
}

let reconciliacaoEmVoo: Promise<void> | null = null

const DEBOUNCE_MS = 2000 // docs/06; o backend (UserTicketTabs) já tolera bem
// menos (~600ms, docs/07) — 2s do lado do cliente evita disparar PUT a cada
// clique de troca de aba em sequência rápida.
let debounceHandle: ReturnType<typeof setTimeout> | undefined

/** Só os tickets sincronizam — abas de seção nunca chegam perto do PUT
 *  (comentário no topo do arquivo). `active` só viaja quando a aba ativa É um
 *  ticket: ficar numa seção não deveria apagar "qual ticket eu tinha aberto
 *  por último" no espelho do servidor. */
function sincronizarComServidor() {
  clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    const { tabs, active } = useTabs.getState()
    const idsTicket = tabs.filter(ehTicket).map((t) => t.ticketId)
    const ativoTicket = tabs.find((a) => ehTicket(a) && chaveAba(a) === active) as
      | AbaTicket
      | undefined
    putTabsServidor({ ticket_ids: idsTicket, active_ticket_id: ativoTicket?.ticketId ?? null })
      .then(aplicarVerdadeDoServidor)
      .catch(() => {
        // Melhor esforço — rede caiu, a próxima mudança de aba tenta de novo.
        // Não há como isto travar a UI: abrir/fechar já aconteceu localmente.
      })
  }, DEBOUNCE_MS)
}

/** A resposta do servidor (já filtrada por visibilidade) vira a verdade para
 *  as abas de TICKET — preserva scroll/draft locais das que sobreviveram e
 *  NUNCA mexe nas abas de seção, que o servidor nem conhece. */
function aplicarVerdadeDoServidor(resposta: { tabs: TicketResumo[]; active_ticket_id: number | null }) {
  const locaisPorId = new Map(useTabs.getState().tabs.filter(ehTicket).map((a) => [a.ticketId, a]))
  const abasSecao = useTabs.getState().tabs.filter((a): a is AbaSecao => a.tipo === 'secao')
  const abasTicket: AbaTicket[] = resposta.tabs.map((resumo) => ({
    tipo: 'ticket',
    ticketId: resumo.id,
    resumo,
    scroll: locaisPorId.get(resumo.id)?.scroll ?? 0,
    draft: locaisPorId.get(resumo.id)?.draft ?? '',
  }))
  // Seção primeiro, depois ticket: só afeta a ORDEM da barra numa reconciliação
  // (rara — login e reconexão), nunca o que está ativo.
  const ativoAnterior = useTabs.getState().active
  const eraSecaoAtiva = ativoAnterior?.startsWith('secao:') ?? false
  useTabs.setState({
    tabs: [...abasSecao, ...abasTicket],
    active: eraSecaoAtiva
      ? ativoAnterior
      : resposta.active_ticket_id != null
        ? `ticket:${resposta.active_ticket_id}`
        : null,
    reconciliando: false,
  })
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      active: null,
      reconciliando: true,

      abrirTicket: (ticketId, resumo) => {
        const jaAberta = get().tabs.some((a) => ehTicket(a) && a.ticketId === ticketId)
        set((s) => ({
          tabs: jaAberta
            ? s.tabs.map((a) =>
                ehTicket(a) && a.ticketId === ticketId && resumo ? { ...a, resumo } : a,
              )
            : [...s.tabs, { tipo: 'ticket', ticketId, resumo, scroll: 0, draft: '' }],
          active: `ticket:${ticketId}`,
        }))
        sincronizarComServidor()
      },

      abrirSecao: (rota, titulo, icone) => {
        const chave = `secao:${rota}`
        const jaAberta = get().tabs.some((a) => a.tipo === 'secao' && a.rota === rota)
        set((s) => ({
          tabs: jaAberta ? s.tabs : [...s.tabs, { tipo: 'secao', rota, titulo, icone }],
          active: chave,
        }))
        // Local apenas — seção nunca sincroniza (comentário no topo do arquivo).
      },

      fechar: (chave) => {
        set((s) => {
          const tabs = s.tabs.filter((a) => chaveAba(a) !== chave)
          const active = s.active === chave ? (tabs.length > 0 ? chaveAba(tabs[tabs.length - 1]!) : null) : s.active
          return { tabs, active }
        })
        sincronizarComServidor()
      },

      definirAtiva: (chave) => {
        set({ active: chave })
        sincronizarComServidor()
      },

      // Local apenas — nunca aciona sync com o servidor (docs/06).
      atualizarScroll: (ticketId, scroll) => {
        set((s) => ({
          tabs: s.tabs.map((a) => (ehTicket(a) && a.ticketId === ticketId ? { ...a, scroll } : a)),
        }))
      },
      atualizarRascunho: (ticketId, draft) => {
        set((s) => ({
          tabs: s.tabs.map((a) => (ehTicket(a) && a.ticketId === ticketId ? { ...a, draft } : a)),
        }))
      },

      reconciliar: () => {
        // Dedup de chamada em voo: o StrictMode do React roda efeitos duas
        // vezes em dev (a barra chama reconciliar() no mount) — sem isto, cada
        // carga de tela dispara DOIS GET/PUT reais em /tickets/tabs/. Mesma
        // categoria do bug de socket duplicado que docs/07 mediu, só que aqui
        // com fetch: a correção é devolver a MESMA promise a quem chamar
        // enquanto a primeira ainda está em voo, não abrir uma segunda.
        if (reconciliacaoEmVoo) return reconciliacaoEmVoo

        reconciliacaoEmVoo = (async () => {
          // NÃO capture `get().tabs` antes do await: abrirTicket()/fechar()
          // rodam enquanto o GET está em voo (é exatamente o que a Página de
          // Detalhe faz ao montar junto com a barra) e são locais e síncronos
          // por contrato (docs/06). Ler antes do await pegaria uma fotografia
          // velha e a resposta do servidor apagaria a aba que acabou de abrir
          // por cima dela.
          const servidor = await getTabsServidor()
          const locaisTicket = get().tabs.filter(ehTicket)
          const idsServidor = new Set(servidor.tabs.map((t) => t.id))
          const idsSoLocais = locaisTicket.map((a) => a.ticketId).filter((id) => !idsServidor.has(id))

          if (idsSoLocais.length === 0) {
            aplicarVerdadeDoServidor(servidor)
            return
          }

          // "união = servidor ∪ (local que o servidor não conhece)" (docs/07)
          // — manda pro servidor validar/filtrar; a resposta do PUT vira a verdade.
          const uniao = [...servidor.tabs.map((t) => t.id), ...idsSoLocais]
          const ativoTicket = get().tabs.find((a) => ehTicket(a) && chaveAba(a) === get().active) as
            | AbaTicket
            | undefined
          const respostaDoPut = await putTabsServidor({
            ticket_ids: uniao,
            active_ticket_id: ativoTicket?.ticketId ?? servidor.active_ticket_id,
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
      // v1→v2: `Aba` ganhou `tipo` (união ticket/seção) e `active` deixou de
      // ser o ticketId cru para virar `chaveAba` (string). localStorage de
      // antes da Fase 2 só tinha abas de ticket sem `tipo` e `active` numérico
      // — sem esta migração, o zustand assumiria os dois formatos compatíveis
      // e a troca de contrato virava dado corrompido em silêncio (abas sem
      // `tipo` quebrando `ehTicket`/`chaveAba`, `active` numérico nunca batendo
      // com nenhuma `chaveAba` string), não uma migração.
      version: 2,
      migrate: (persisted) => {
        const antigo = persisted as { tabs?: unknown[]; active?: unknown } | undefined
        if (!antigo || !Array.isArray(antigo.tabs)) return { tabs: [], active: null }
        const tabs: Aba[] = antigo.tabs
          .filter((a): a is { ticketId: number; resumo?: TicketResumo; scroll?: number; draft?: string } =>
            typeof a === 'object' && a !== null && typeof (a as { ticketId?: unknown }).ticketId === 'number',
          )
          .map((a) => ({
            tipo: 'ticket' as const,
            ticketId: a.ticketId,
            resumo: a.resumo,
            scroll: a.scroll ?? 0,
            draft: a.draft ?? '',
          }))
        const active = typeof antigo.active === 'number' ? `ticket:${antigo.active}` : null
        return { tabs, active }
      },
    },
  ),
)
