import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { getTabsServidor, putTabsServidor, type TicketResumo } from '@/api/tabs'

/**
 * Abas do shell: contrato original em docs/06-abas-frontend.md, generalizado
 * para a barra de abas do topo do console (`resolv/shell/BarraDeAbas.tsx`),
 * que mostra numa faixa só os tickets abertos e as seções abertas (Tickets,
 * Chats, Quadro, Clientes, Avisos, Notas, Relatórios, Auditoria,
 * Configurações, Novo ticket, Minha conta).
 *
 * Duas espécies de aba, uma união marcada por `tipo`:
 *   - `ticket`: o contrato de sempre. Múltiplas por vez, espelhadas no
 *     servidor (`/tickets/tabs/`), com rascunho e posição de scroll. Quem
 *     abre é `PaginaDetalheTicket` (`abrirTicket`), quando os dados chegam.
 *   - `secao`: NUNCA vai para o servidor. É navegação ambiente (qual área
 *     você tem aberta), não dado de trabalho: o mesmo raciocínio que já
 *     mantinha rascunho/scroll fora do PUT. Uma por rota (reabrir a mesma
 *     seção reaproveita a aba, nunca duplica). Quem abre é a própria barra,
 *     ao observar a URL (`abrirSecao`). A Início não mora aqui: é fixa na
 *     barra, sem estado.
 *
 * Nenhuma operação que envolva só seções chega perto do PUT: abrir, ativar,
 * fechar ou reordenar seções é local. O servidor só é avisado quando algo de
 * TICKET muda (quais estão abertos, em que ordem, qual está ativo).
 *
 * `chaveAba` é o identificador estável de UMA aba, dos dois tipos: é o que
 * `active` guarda (string, não o `ticketId` cru), e o que a barra usa para
 * saber qual aba fechar/focar.
 *
 * O `localStorage` de versões anteriores é tolerado (`migrate`), e o que quer
 * que esteja guardado é saneado a cada carga (`merge`): o formato sem `tipo`,
 * abas de seção herdadas (inclusive as da época em que as rotas se chamavam
 * /chamados) e itens inválidos, que são descartados em vez de derrubar o
 * console. Seção com rota que a barra não conhece mais é descartada por ela ao
 * montar.
 *
 * O rascunho mora DENTRO da aba, então fechar a aba o apagaria. Para nenhuma
 * forma de fechar (x, Delete, "Fechar todas"...) custar o texto de uma
 * resposta, quem fecha uma aba com rascunho o deixa em `rascunhosGuardados`
 * (por ticket, os mais recentes), e reabrir o ticket o devolve ao compositor.
 *
 * `limparTudo` esvazia tudo isto ao sair da conta (logout e 401): o
 * `localStorage` é da máquina, não da pessoa, e a próxima a entrar não pode
 * herdar abas nem rascunhos.
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
  /** Rótulo da seção, o mesmo da Sidebar. A barra NÃO o lê (rótulo e ícone
   *  saem da tabela de rotas dela, `abasDaRota.ts`, que é uma fonte só): segue
   *  gravado porque o formato guardado no `localStorage` já o tem. */
  titulo: string
  /** Classe `ti ti-*` da seção, mesma observação de `titulo`. */
  icone: string
}

export type Aba = AbaTicket | AbaSecao

/** As chaves de aba, num lugar só (o store, a barra e as regras de rota as
 *  montam por aqui): `ticket:<id>` e `secao:<rota>`. */
const PREFIXO_TICKET = 'ticket:'

export function chaveDeTicket(ticketId: number): string {
  return `${PREFIXO_TICKET}${ticketId}`
}

export function chaveDeSecao(rota: string): string {
  return `secao:${rota}`
}

export function chaveAba(aba: Aba): string {
  return aba.tipo === 'ticket' ? chaveDeTicket(aba.ticketId) : chaveDeSecao(aba.rota)
}

function ehTicket(aba: Aba): aba is AbaTicket {
  return aba.tipo === 'ticket'
}

/** Quantos rascunhos de abas fechadas se guardam (os mais recentes). */
const LIMITE_RASCUNHOS_GUARDADOS = 30

/** O rascunho de um ticket cuja aba foi fechada. */
export interface RascunhoGuardado {
  ticketId: number
  draft: string
}

/** `guardados` com o rascunho de cada aba de ticket de `fechadas` que tinha
 *  texto (o mais recente por último, o mais velho sai ao passar do limite). */
function guardarRascunhos(guardados: RascunhoGuardado[], fechadas: Aba[]): RascunhoGuardado[] {
  let lista = guardados
  for (const aba of fechadas) {
    if (!ehTicket(aba) || aba.draft.trim() === '') continue
    lista = [...lista.filter((r) => r.ticketId !== aba.ticketId), { ticketId: aba.ticketId, draft: aba.draft }]
  }
  return lista === guardados ? guardados : lista.slice(-LIMITE_RASCUNHOS_GUARDADOS)
}

function sanearRascunhosGuardados(persistido: unknown): RascunhoGuardado[] {
  if (!Array.isArray(persistido)) return []
  const vistos = new Set<number>()
  const lista: RascunhoGuardado[] = []
  for (const bruto of persistido) {
    const r = bruto as Partial<RascunhoGuardado> | null
    if (!r || typeof r.ticketId !== 'number' || typeof r.draft !== 'string' || r.draft.trim() === '') continue
    if (vistos.has(r.ticketId)) continue
    vistos.add(r.ticketId)
    lista.push({ ticketId: r.ticketId, draft: r.draft })
  }
  return lista.slice(-LIMITE_RASCUNHOS_GUARDADOS)
}

function resumosIguais(a: TicketResumo | undefined, b: TicketResumo): boolean {
  return (
    a !== undefined &&
    a.id === b.id &&
    a.reference === b.reference &&
    a.subject === b.subject &&
    a.status === b.status &&
    (a.stage_color ?? null) === (b.stage_color ?? null) &&
    a.requester_display === b.requester_display &&
    (a.company_name ?? '') === (b.company_name ?? '')
  )
}

function idsDeTicket(tabs: Aba[]): number[] {
  return tabs.filter(ehTicket).map((a) => a.ticketId)
}

interface TabsState {
  tabs: Aba[]
  /** Chave da aba ativa (`chaveAba`) — string, não mais o ticketId cru. */
  active: string | null
  /** true enquanto a reconciliação inicial (GET) não voltou — a barra deve
   *  mostrar o que já tinha em localStorage, não esperar a rede (docs/06). */
  reconciliando: boolean
  /** Rascunhos de abas de ticket fechadas com texto não enviado (ver o
   *  comentário no topo do arquivo). */
  rascunhosGuardados: RascunhoGuardado[]

  abrirTicket: (ticketId: number, resumo?: TicketResumo) => void
  abrirSecao: (rota: string, titulo: string, icone: string) => void
  fechar: (chave: string) => void
  /** Fecha várias de uma vez ("fechar as outras", "as da direita", "todas"):
   *  UM set e UM sync, em vez de N `fechar` em sequência disparando N
   *  reconciliações. Se a ativa estiver entre elas, a ativa passa a ser a
   *  última que sobrou (ou nenhuma) só para o store não apontar para o nada:
   *  quem decide o que fica ativo, e para onde navegar, é a barra (a vizinha
   *  da aba fechada). */
  fecharVarias: (chaves: string[]) => void
  /** Nova ordem completa da barra (chaves de TODAS as abas, arrastar e
   *  soltar). Chave desconhecida é ignorada e aba que faltou na lista fica no
   *  fim — a ordem nunca perde aba. */
  reordenar: (chaves: string[]) => void
  definirAtiva: (chave: string) => void
  atualizarScroll: (ticketId: number, scroll: number) => void
  atualizarRascunho: (ticketId: number, draft: string) => void
  /** Põe o resumo novo numa aba de ticket já aberta (a etapa, o status, a
   *  empresa mudaram enquanto a pessoa estava nele). Só isso: não abre, não
   *  ativa e não chama o servidor. */
  atualizarResumo: (ticketId: number, resumo: TicketResumo) => void
  reconciliar: () => Promise<void>
  /** Esquece tudo (abas, rascunhos, reconciliação em voo): ao sair da conta. */
  limparTudo: () => void
}

let reconciliacaoEmVoo: Promise<void> | null = null
/** Sobe a cada `limparTudo`: uma resposta do servidor que volta depois de a
 *  pessoa sair da conta é de outra sessão e não pode repovoar o store. */
let geracao = 0

const DEBOUNCE_MS = 2000 // docs/06; o backend (UserTicketTabs) já tolera bem
// menos (~600ms, docs/07) — 2s do lado do cliente evita disparar PUT a cada
// clique de troca de aba em sequência rápida.
let debounceHandle: ReturnType<typeof setTimeout> | undefined

/** Só os tickets sincronizam: abas de seção nunca chegam perto do PUT
 *  (comentário no topo do arquivo). `active_ticket_id` é o ticket ativo, ou
 *  null quando a aba ativa é uma seção. As operações que só mexem em seção
 *  nem chamam esta função. */
function sincronizarComServidor() {
  clearTimeout(debounceHandle)
  debounceHandle = setTimeout(() => {
    const { tabs, active, reconciliando, reconciliar } = useTabs.getState()
    if (reconciliando) {
      // Ainda não se sabe o que o servidor tem (a primeira leitura demorou ou
      // falhou): um PUT agora trocaria a lista dele só pelo que este aparelho
      // tem e apagaria os tickets abertos em outro. Lê primeiro; a
      // reconciliação já manda a união. Falhando, a próxima mudança tenta de novo.
      reconciliar()
        .then(() => {
          if (!useTabs.getState().reconciliando) sincronizarComServidor()
        })
        .catch(() => {})
      return
    }
    const minhaGeracao = geracao
    const idsTicket = tabs.filter(ehTicket).map((t) => t.ticketId)
    const ativoTicket = tabs.find((a) => ehTicket(a) && chaveAba(a) === active) as
      | AbaTicket
      | undefined
    putTabsServidor({ ticket_ids: idsTicket, active_ticket_id: ativoTicket?.ticketId ?? null })
      .then((resposta) => {
        if (minhaGeracao === geracao) aplicarVerdadeDoServidor(resposta, idsTicket)
      })
      .catch(() => {
        // Melhor esforço — rede caiu, a próxima mudança de aba tenta de novo.
        // Não há como isto travar a UI: abrir/fechar já aconteceu localmente.
      })
  }, DEBOUNCE_MS)
}

/** A resposta do servidor (já filtrada por visibilidade) vira a verdade para
 *  as abas de TICKET: preserva scroll/draft locais das que sobreviveram, e
 *  NUNCA mexe nas abas de seção, que o servidor nem conhece.
 *
 *  A barra mistura as duas espécies numa ordem que a pessoa montou, então a
 *  reconciliação não pode reembaralhar: cada seção fica no lugar em que
 *  estava, e os tickets preenchem os demais lugares na ordem do servidor. Os
 *  que sobrarem (abertos em outro aparelho) entram no fim.
 *
 *  `enviados` são os ids de ticket que ESTE aparelho tinha quando o PUT que
 *  gerou esta resposta saiu (não a lista inteira que seguiu nele: os tickets
 *  que só o servidor conhecia não são "fechados no voo" por não estarem aqui).
 *  A resposta demora, e a pessoa não espera: o ticket que ela abriu enquanto o
 *  PUT estava em voo não está na resposta e NÃO pode sumir por isso (é o que
 *  acontecia ao recarregar dentro de um ticket com abas só locais: a aba do
 *  ticket na tela era apagada). Pela mesma razão, o que ela fechou nesse meio
 *  tempo não ressuscita. */
function aplicarVerdadeDoServidor(
  resposta: { tabs: TicketResumo[]; active_ticket_id: number | null },
  enviados?: number[],
) {
  const locais = useTabs.getState().tabs
  const locaisPorId = new Map(locais.filter(ehTicket).map((a) => [a.ticketId, a]))
  const idsEnviados = enviados ? new Set(enviados) : null
  const idsDaResposta = new Set(resposta.tabs.map((r) => r.id))
  const fechadaNoVoo = (id: number) => idsEnviados !== null && idsEnviados.has(id) && !locaisPorId.has(id)
  const abertaNoVoo = (a: AbaTicket) => idsEnviados !== null && !idsEnviados.has(a.ticketId) && !idsDaResposta.has(a.ticketId)

  // Uma aba que só o servidor conhece (e que este aparelho fechou há pouco,
  // com o espelho ainda atrasado) volta com o rascunho que ficou guardado.
  const guardados = useTabs.getState().rascunhosGuardados
  const doServidor: AbaTicket[] = resposta.tabs
    .filter((resumo) => !fechadaNoVoo(resumo.id))
    .map((resumo) => ({
      tipo: 'ticket',
      ticketId: resumo.id,
      resumo,
      scroll: locaisPorId.get(resumo.id)?.scroll ?? 0,
      draft: locaisPorId.get(resumo.id)?.draft ?? guardados.find((r) => r.ticketId === resumo.id)?.draft ?? '',
    }))
  const tabs: Aba[] = []
  let proximo = 0
  for (const aba of locais) {
    if (aba.tipo === 'secao' || abertaNoVoo(aba)) tabs.push(aba)
    else if (proximo < doServidor.length) tabs.push(doServidor[proximo++]!)
  }
  tabs.push(...doServidor.slice(proximo))

  // Quem manda no que está ativo é a tela em que a pessoa está (a URL), e o
  // store já reflete isso: só cai no ativo do servidor quando a aba ativa
  // local não existe mais (ou nunca existiu, num aparelho novo).
  const ativoAnterior = useTabs.getState().active
  const ativoLocalSobrou = ativoAnterior !== null && tabs.some((a) => chaveAba(a) === ativoAnterior)
  const restaurados = new Set(tabs.filter(ehTicket).filter((a) => !locaisPorId.has(a.ticketId)).map((a) => a.ticketId))
  useTabs.setState({
    tabs,
    rascunhosGuardados: guardados.filter((r) => !restaurados.has(r.ticketId)),
    active: ativoLocalSobrou
      ? ativoAnterior
      : resposta.active_ticket_id != null
        ? chaveDeTicket(resposta.active_ticket_id)
        : null,
    reconciliando: false,
  })
}

/** Tudo o que já esteve no `localStorage` (`resolv:tabs`) vira o formato
 *  atual: v1 (abas de ticket sem `tipo`, `active` numérico), v2 (união
 *  ticket/seção) e v3. Entrada que não se reconhece é descartada, nunca
 *  lançada: uma aba ruim não pode impedir o console de abrir. */
export function migrarAbasPersistidas(persistido: unknown): { tabs: Aba[]; active: string | null } {
  const antigo = persistido as { tabs?: unknown[]; active?: unknown } | undefined
  if (!antigo || !Array.isArray(antigo.tabs)) return { tabs: [], active: null }

  const tabs: Aba[] = []
  const rotasVistas = new Set<string>()
  const ticketsVistos = new Set<number>()
  for (const bruta of antigo.tabs) {
    if (typeof bruta !== 'object' || bruta === null) continue
    const a = bruta as Record<string, unknown>
    if (a.tipo === 'secao') {
      if (typeof a.rota !== 'string' || a.rota === '') continue
      // As rotas do console se chamavam /chamados antes de virarem /tickets.
      const rota = a.rota.replace(/^\/chamados(?=\/|$)/, '/tickets')
      if (rotasVistas.has(rota)) continue
      rotasVistas.add(rota)
      tabs.push({
        tipo: 'secao',
        rota,
        titulo: typeof a.titulo === 'string' ? a.titulo : rota,
        icone: typeof a.icone === 'string' ? a.icone : 'ti ti-layout-grid',
      })
    } else if (typeof a.ticketId === 'number' && !ticketsVistos.has(a.ticketId)) {
      ticketsVistos.add(a.ticketId)
      tabs.push({
        tipo: 'ticket',
        ticketId: a.ticketId,
        resumo: a.resumo as TicketResumo | undefined,
        scroll: typeof a.scroll === 'number' ? a.scroll : 0,
        draft: typeof a.draft === 'string' ? a.draft : '',
      })
    }
  }

  const bruto =
    typeof antigo.active === 'number'
      ? chaveDeTicket(antigo.active)
      : typeof antigo.active === 'string'
        ? antigo.active.replace(/^secao:\/chamados(?=\/|$)/, 'secao:/tickets')
        : null
  const active = bruto !== null && tabs.some((t) => chaveAba(t) === bruto) ? bruto : null
  return { tabs, active }
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [],
      active: null,
      reconciliando: true,
      rascunhosGuardados: [],

      abrirTicket: (ticketId, resumo) => {
        const jaAberta = get().tabs.some((a) => ehTicket(a) && a.ticketId === ticketId)
        set((s) => {
          // Reabrir um ticket cuja aba foi fechada com texto no compositor
          // devolve o texto (e tira da lista de guardados).
          const guardado = jaAberta ? undefined : s.rascunhosGuardados.find((r) => r.ticketId === ticketId)
          return {
            tabs: jaAberta
              ? s.tabs.map((a) =>
                  ehTicket(a) && a.ticketId === ticketId && resumo ? { ...a, resumo } : a,
                )
              : [...s.tabs, { tipo: 'ticket', ticketId, resumo, scroll: 0, draft: guardado?.draft ?? '' }],
            rascunhosGuardados: guardado
              ? s.rascunhosGuardados.filter((r) => r.ticketId !== ticketId)
              : s.rascunhosGuardados,
            active: chaveDeTicket(ticketId),
          }
        })
        sincronizarComServidor()
      },

      abrirSecao: (rota, titulo, icone) => {
        const chave = chaveDeSecao(rota)
        const jaAberta = get().tabs.some((a) => a.tipo === 'secao' && a.rota === rota)
        set((s) => ({
          tabs: jaAberta ? s.tabs : [...s.tabs, { tipo: 'secao', rota, titulo, icone }],
          active: chave,
        }))
        // Local apenas — seção nunca sincroniza (comentário no topo do arquivo).
      },

      fechar: (chave) => {
        const fechada = get().tabs.find((a) => chaveAba(a) === chave)
        if (!fechada) return
        set((s) => {
          const tabs = s.tabs.filter((a) => chaveAba(a) !== chave)
          const active = s.active === chave ? (tabs.length > 0 ? chaveAba(tabs[tabs.length - 1]!) : null) : s.active
          return { tabs, active, rascunhosGuardados: guardarRascunhos(s.rascunhosGuardados, [fechada]) }
        })
        // Fechar uma seção é local: o servidor não a conhece.
        if (ehTicket(fechada)) sincronizarComServidor()
      },

      fecharVarias: (chaves) => {
        if (chaves.length === 0) return
        const alvo = new Set(chaves)
        const fechouTicket = get().tabs.some((a) => ehTicket(a) && alvo.has(chaveAba(a)))
        set((s) => {
          const tabs = s.tabs.filter((a) => !alvo.has(chaveAba(a)))
          const active =
            s.active !== null && alvo.has(s.active)
              ? tabs.length > 0
                ? chaveAba(tabs[tabs.length - 1]!)
                : null
              : s.active
          const fechadas = s.tabs.filter((a) => alvo.has(chaveAba(a)))
          return { tabs, active, rascunhosGuardados: guardarRascunhos(s.rascunhosGuardados, fechadas) }
        })
        if (fechouTicket) sincronizarComServidor()
      },

      reordenar: (chaves) => {
        const antes = idsDeTicket(get().tabs).join(',')
        set((s) => {
          const porChave = new Map(s.tabs.map((a) => [chaveAba(a), a]))
          const ordenadas: Aba[] = []
          for (const chave of chaves) {
            const aba = porChave.get(chave)
            if (aba) {
              ordenadas.push(aba)
              porChave.delete(chave)
            }
          }
          // O que a lista não mencionou vai pro fim, na ordem antiga.
          return { tabs: [...ordenadas, ...porChave.values()] }
        })
        // A ordem dos tickets é parte do espelho (`ticket_ids` na ordem da
        // barra, docs/06): outra máquina abre na mesma ordem. Arrastar uma
        // seção de lugar não muda essa ordem, e então não vai ao servidor.
        if (idsDeTicket(get().tabs).join(',') !== antes) sincronizarComServidor()
      },

      definirAtiva: (chave) => {
        set({ active: chave })
        // O espelho guarda "qual ticket está ativo". Ativar uma seção não
        // mexe nisso (e não deve apagar o último ticket ativo no servidor).
        if (chave.startsWith(PREFIXO_TICKET)) sincronizarComServidor()
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
      atualizarResumo: (ticketId, resumo) => {
        const aba = get().tabs.find((a): a is AbaTicket => ehTicket(a) && a.ticketId === ticketId)
        if (!aba || resumosIguais(aba.resumo, resumo)) return
        set((s) => ({
          tabs: s.tabs.map((a) => (ehTicket(a) && a.ticketId === ticketId ? { ...a, resumo } : a)),
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

        const minhaGeracao = geracao
        const promessa: Promise<void> = (async () => {
          // NÃO capture `get().tabs` antes do await: abrirTicket()/fechar()
          // rodam enquanto o GET está em voo (é exatamente o que a Página de
          // Detalhe faz ao montar junto com a barra) e são locais e síncronos
          // por contrato (docs/06). Ler antes do await pegaria uma fotografia
          // velha e a resposta do servidor apagaria a aba que acabou de abrir
          // por cima dela.
          const servidor = await getTabsServidor()
          // Saiu da conta no meio: a resposta é de outra sessão.
          if (minhaGeracao !== geracao) return
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
          if (minhaGeracao !== geracao) return
          // "Enviados" para o filtro de fechados/abertos no voo são os que ESTE
          // aparelho tinha ao mandar, não a união: os tickets que só o servidor
          // conhecia não estão aqui e não foram "fechados" por ninguém.
          aplicarVerdadeDoServidor(
            respostaDoPut,
            locaisTicket.map((a) => a.ticketId),
          )
        })().finally(() => {
          if (reconciliacaoEmVoo === promessa) reconciliacaoEmVoo = null
        })
        reconciliacaoEmVoo = promessa
        return promessa
      },

      limparTudo: () => {
        clearTimeout(debounceHandle)
        debounceHandle = undefined
        reconciliacaoEmVoo = null
        geracao++
        set({ tabs: [], active: null, reconciliando: true, rascunhosGuardados: [] })
      },
    }),
    {
      name: 'resolv:tabs',
      // reconciliando nunca persiste — cada carga da página começa
      // reconciliando de novo, mesmo com abas já hidratadas do localStorage.
      partialize: (s) => ({ tabs: s.tabs, active: s.active, rascunhosGuardados: s.rascunhosGuardados }),
      // v1→v2: `Aba` ganhou `tipo` (união ticket/seção) e `active` deixou de
      // ser o ticketId cru para virar `chaveAba` (string). v2→v3: as abas de
      // seção voltaram a ser criadas e mostradas, e o que o v2 guardou tem de
      // ser aproveitado: a migração passou a preservá-las (antes só passavam
      // as de ticket) e a corrigir a rota que mudou de nome (/chamados virou
      // /tickets). Sem migração o zustand assumiria os formatos compatíveis e
      // a troca de contrato virava dado corrompido em silêncio.
      version: 3,
      migrate: (persisted) => migrarAbasPersistidas(persisted),
      // Vale para QUALQUER versão guardada, e não só quando a versão muda: um
      // `localStorage` já na v3 mas com um item inválido (edição à mão, bug de
      // outra versão) não pode derrubar o console a cada carga.
      merge: (persisted, atual) => ({
        ...atual,
        ...migrarAbasPersistidas(persisted),
        rascunhosGuardados: sanearRascunhosGuardados((persisted as { rascunhosGuardados?: unknown } | undefined)?.rascunhosGuardados),
      }),
    },
  ),
)
