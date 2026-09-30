import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type Aba, type AbaTicket } from '@/stores/tabs'
import { MenuFlutuante, type ItemDoMenu } from './MenuFlutuante'
import './lista-trabalho.scss'

/**
 * "Trabalhando agora" — os tickets abertos, no desenho da lista de conversas
 * da sidebar da referência (Copilot): só texto, uma linha cada, o fechar
 * aparecendo no hover.
 *
 * Não se chama "Recentes" de propósito: não é histórico. Entra o ticket que
 * a pessoa abriu, fica até ela fechar, sem limite e sem expirar, na ordem em
 * que ela deixou (reabrir não move; arrastar reordena). É a mesa de trabalho
 * que ela monta — posição estável vale mais aqui do que "o mais recente no
 * topo". "Abertos" e "Em andamento" ficaram de fora porque já são status de
 * ticket.
 *
 * Substitui a barra de abas horizontal que ficava no topo do conteúdo. O
 * contrato do store não mudou (`stores/tabs.ts`, docs/06-abas-frontend.md):
 * as abas de ticket continuam espelhadas no servidor, com rascunho e
 * posição de rolagem, e quem as abre é `PaginaDetalheTicket`. O que mudou é
 * onde elas aparecem e o que deixou de aparecer:
 *
 *   - as abas de SEÇÃO (Tickets, Quadro, Configurações…) não são mostradas.
 *     Elas repetiam a navegação que está logo acima, na mesma sidebar;
 *   - a Início deixou de ser uma aba fixa: é um item da navegação.
 *
 * O resto veio junto: clique do meio e Delete fecham, fechar com rascunho
 * pergunta antes, o menu de contexto fecha em lote (com UMA pergunta pelo
 * conjunto), arrastar reordena, e as setas movem o foco (roving tabindex —
 * a lista entra na ordem de tabulação uma vez só, não uma vez por ticket).
 */

type AbaDeTicket = AbaTicket & { chave: string }

function ehTicket(aba: Aba): aba is AbaTicket {
  return aba.tipo === 'ticket'
}

/** O que a linha mostra: o assunto, como a referência mostra o título da
 *  conversa. Enquanto o servidor não hidratou o resumo, a referência. */
function tituloDe(aba: AbaTicket): string {
  return aba.resumo?.subject || aba.resumo?.reference || `#${aba.ticketId}`
}

function referenciaDe(aba: AbaTicket): string {
  return aba.resumo?.reference ?? `#${aba.ticketId}`
}

function temRascunho(aba: AbaTicket): boolean {
  return aba.draft.trim().length > 0
}

export function ListaTrabalho() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const todas = useTabs((s) => s.tabs)
  const fechar = useTabs((s) => s.fechar)
  const fecharVarias = useTabs((s) => s.fecharVarias)
  const reordenar = useTabs((s) => s.reordenar)
  const definirAtiva = useTabs((s) => s.definirAtiva)

  const tickets: AbaDeTicket[] = todas.filter(ehTicket).map((a) => ({ ...a, chave: chaveAba(a) }))
  const ativa = pathname.match(/^\/tickets\/(\d+)$/)?.[1]
  const chaveAtiva = ativa ? `ticket:${ativa}` : null

  // Roving tabindex: um item da lista por vez recebe o Tab; as setas movem.
  const [chaveComFoco, setChaveComFoco] = useState<string | null>(null)
  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const [menu, setMenu] = useState<{ chave: string; x: number; y: number } | null>(null)
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  if (tickets.length === 0) return null

  const focavel =
    tickets.find((t) => t.chave === chaveComFoco)?.chave ??
    tickets.find((t) => t.chave === chaveAtiva)?.chave ??
    tickets[0]!.chave

  /** Para onde ir quando a aba na tela fechou: o último ticket que sobrou,
   *  e sem nenhum, a lista de tickets — que é de onde a pessoa veio. */
  function sairSeFoiAAtiva(fechadas: Set<string>) {
    if (!chaveAtiva || !fechadas.has(chaveAtiva)) return
    const sobrou = tickets.filter((t) => !fechadas.has(t.chave)).at(-1)
    navigate(sobrou ? `/tickets/${sobrou.ticketId}` : '/tickets')
  }

  /** Rascunho é local por contrato (docs/06: nunca vai ao servidor), então
   *  fechar sem perguntar apaga de vez. A pergunta só aparece quando há
   *  rascunho: confirmar todo fechamento viraria ruído. */
  function fecharUm(aba: AbaDeTicket) {
    if (
      temRascunho(aba) &&
      !window.confirm(`O ticket ${referenciaDe(aba)} tem um rascunho não enviado. Fechar descarta esse texto.`)
    ) {
      return
    }
    fechar(aba.chave)
    sairSeFoiAAtiva(new Set([aba.chave]))
  }

  /** Em lote, UMA pergunta pelo conjunto — N perguntas seguidas seria pior
   *  do que não perguntar. */
  function fecharConjunto(chaves: string[]) {
    if (chaves.length === 0) return
    const alvo = new Set(chaves)
    const comRascunho = tickets.filter((t) => alvo.has(t.chave) && temRascunho(t)).length
    if (comRascunho > 0) {
      const aviso =
        comRascunho === 1
          ? 'Um dos tickets tem um rascunho não enviado. Fechar descarta esse texto.'
          : `${comRascunho} tickets têm rascunho não enviado. Fechar descarta esses textos.`
      if (!window.confirm(aviso)) return
    }
    fecharVarias(chaves)
    sairSeFoiAAtiva(alvo)
  }

  function abrir(aba: AbaDeTicket) {
    setChaveComFoco(aba.chave)
    definirAtiva(aba.chave)
    navigate(`/tickets/${aba.ticketId}`)
  }

  function moverFoco(indice: number, direcao: 1 | -1) {
    const proximo = tickets[(indice + direcao + tickets.length) % tickets.length]!
    setChaveComFoco(proximo.chave)
    botoes.current.get(proximo.chave)?.focus()
  }

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>, indice: number, aba: AbaDeTicket) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moverFoco(indice, 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moverFoco(indice, -1)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      fecharUm(aba)
    }
  }

  function aoArrastar({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const chaves = tickets.map((t) => t.chave)
    const de = chaves.indexOf(String(active.id))
    const para = chaves.indexOf(String(over.id))
    if (de < 0 || para < 0) return
    // Só as chaves de ticket: o store manda para o fim quem faltar na lista,
    // então abas de seção antigas que ainda estejam no localStorage não se
    // perdem — só não aparecem.
    reordenar(arrayMove(chaves, de, para))
  }

  const itensDoMenu: ItemDoMenu[] = menu
    ? [
        {
          rotulo: 'Fechar',
          icone: 'ti ti-x',
          onSelecionar: () => {
            const aba = tickets.find((t) => t.chave === menu.chave)
            if (aba) fecharUm(aba)
          },
        },
        {
          rotulo: 'Fechar os outros',
          onSelecionar: () => fecharConjunto(tickets.filter((t) => t.chave !== menu.chave).map((t) => t.chave)),
          desabilitado: tickets.length < 2,
        },
        {
          rotulo: 'Fechar todos',
          onSelecionar: () => fecharConjunto(tickets.map((t) => t.chave)),
        },
      ]
    : []

  return (
    <section className="trabalho" aria-labelledby="trabalho-titulo">
      <h2 id="trabalho-titulo" className="trabalho__titulo">
        Trabalhando agora
      </h2>
      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoArrastar}>
        <SortableContext items={tickets.map((t) => t.chave)} strategy={verticalListSortingStrategy}>
          <ul className="trabalho__lista">
            {tickets.map((aba, i) => (
              <ItemRecente
                key={aba.chave}
                aba={aba}
                ativa={aba.chave === chaveAtiva}
                tabIndex={aba.chave === focavel ? 0 : -1}
                registrar={(el) => {
                  if (el) botoes.current.set(aba.chave, el)
                  else botoes.current.delete(aba.chave)
                }}
                onAbrir={() => abrir(aba)}
                onFechar={() => fecharUm(aba)}
                onTeclar={(e) => aoTeclar(e, i, aba)}
                onMenu={(e) => {
                  e.preventDefault()
                  // Pela tecla de menu (ou Shift+F10) o evento chega em 0,0 —
                  // abriria no canto da tela. Aí o menu nasce sob o item.
                  const r = e.currentTarget.getBoundingClientRect()
                  const peloTeclado = e.clientX === 0 && e.clientY === 0
                  setMenu({
                    chave: aba.chave,
                    x: peloTeclado ? r.left + 12 : e.clientX,
                    y: peloTeclado ? r.bottom : e.clientY,
                  })
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <MenuFlutuante
        aberto={menu !== null}
        onFechar={() => setMenu(null)}
        itens={itensDoMenu}
        rotulo="Ações do ticket"
        posicao={menu ? { x: menu.x, y: menu.y } : null}
      />
    </section>
  )
}

interface ItemProps {
  aba: AbaDeTicket
  ativa: boolean
  tabIndex: number
  registrar: (el: HTMLButtonElement | null) => void
  onAbrir: () => void
  onFechar: () => void
  onTeclar: (e: KeyboardEvent<HTMLButtonElement>) => void
  onMenu: (e: MouseEvent<HTMLLIElement>) => void
}

function ItemRecente({ aba, ativa, tabIndex, registrar, onAbrir, onFechar, onTeclar, onMenu }: ItemProps) {
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id: aba.chave })
  const estilo: CSSProperties = { transform: CSS.Translate.toString(transform), transition }

  const titulo = tituloDe(aba)
  const ref = referenciaDe(aba)
  const rascunho = temRascunho(aba)
  // O nome acessível leva o que a linha não mostra: a referência (que
  // agente usa para falar do ticket) e o aviso de rascunho.
  const nome = `${ref} · ${titulo}${rascunho ? ' (rascunho não enviado)' : ''}`
  const dica =
    (aba.resumo?.company_name ? `${ref} · ${aba.resumo.company_name}\n${titulo}` : `${ref} · ${titulo}`) +
    '\nDelete fecha'

  return (
    <li
      ref={setNodeRef}
      style={estilo}
      className={
        'trabalho__item' +
        (ativa ? ' trabalho__item--ativo' : '') +
        (isDragging ? ' trabalho__item--arrastando' : '')
      }
      onContextMenu={onMenu}
    >
      <button
        type="button"
        ref={registrar}
        className="trabalho__abrir"
        aria-label={nome}
        aria-current={ativa ? 'page' : undefined}
        aria-keyshortcuts="Delete"
        title={dica}
        tabIndex={tabIndex}
        // Só os `listeners` do dnd-kit, não os `attributes`: estes trariam
        // role/tabIndex próprios de "sortable" por cima do roving tabindex.
        {...listeners}
        onKeyDown={onTeclar}
        onClick={onAbrir}
        onAuxClick={(e) => {
          // Clique do meio fecha, como numa aba de navegador.
          if (e.button === 1) {
            e.preventDefault()
            onFechar()
          }
        }}
      >
        <span className="trabalho__texto">{titulo}</span>
        {rascunho && <span className="trabalho__rascunho" aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="trabalho__fechar"
        aria-label={`Fechar ${ref}`}
        title="Fechar"
        tabIndex={-1}
        onClick={onFechar}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </li>
  )
}
