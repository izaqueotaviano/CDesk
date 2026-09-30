import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type PointerSensorOptions,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as PointerEventDoReact,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type Aba, type AbaTicket } from '@/stores/tabs'
import { CHAVE_INICIO, abaDaRota, secaoPorRota, vizinhaAposFechar } from './abasDaRota'
import { MenuFlutuante, type ItemDoMenu } from './MenuFlutuante'
import './barra-de-abas.scss'

/**
 * Barra de abas do console: uma aba por ticket aberto e por página aberta,
 * como num navegador, na faixa superior do shell (NovoShell). Sem fundo e sem
 * linha própria: o plano continua uma peça só, e a aba ativa se destaca como
 * um cartão sobre ele (barra-de-abas.scss).
 *
 * Três espécies de aba, numa lista só, na ordem em que foram abertas (ou
 * arrastadas):
 *   - Início: FIXA, sempre a primeira, sem botão de fechar, não arrasta e não
 *     mora no store. Não é estado (não abre, não fecha, não reordena), e deixá-la
 *     fora evita ter de proteger o store contra "e se alguém fechar a Início":
 *     seria uma barra sem aba nenhuma e sem para onde voltar;
 *   - ticket: uma por ticket aberto (`stores/tabs.ts`), com a referência em
 *     tom discreto e o assunto. Quem a abre é `PaginaDetalheTicket`, quando os
 *     dados chegam (é de lá que vem o resumo do título); a barra só a mostra;
 *   - seção: uma por rota, por maior prefixo (`abasDaRota.ts`). Quem a abre é
 *     esta barra, ao observar a URL. Nunca vai para o servidor.
 *
 * As abas vêm da URL, e não só de cliques: navegar pela sidebar, pela busca,
 * por uma notificação, pelo voltar do navegador ou por um link direto acende
 * (e abre, se for seção) a aba certa. A aba ativa é DERIVADA da rota no
 * render, antes de qualquer efeito rodar; o store só a acompanha.
 *
 * Fechar a aba ativa navega como um navegador: para a aba da direita, ou da
 * esquerda se ela era a última, ou para o Início se não sobrou nenhuma. Fechar
 * uma aba inativa nunca navega. Rascunho não pergunta nada: fica no
 * `localStorage` enquanto a aba existe, e a aba mostra um ponto quando há um.
 *
 * Interações além do clique: clique do meio e Delete/Backspace fecham; botão
 * direito (ou a tecla de menu) abre o menu de contexto; arrastar reordena, só
 * com o ponteiro (com o teclado as setas já têm dono: mover o foco, padrão
 * WAI-ARIA de tabs, com Home/End nas pontas); o "+" depois da última aba abre
 * um ticket novo.
 *
 * Montada UMA vez pelo NovoShell (vive dentro da barra superior). Ao montar,
 * reconcilia as abas de ticket com o servidor, sem bloquear o desenho: mostra
 * o que já estava no `localStorage` e troca pelo que o servidor devolver.
 */

const NOVO_TICKET = '/tickets/novo'
const MARGEM_AO_REVELAR = 24

/** Uma aba na barra. `aba: null` é a Início (fixa, fora do store). */
interface ItemDaBarra {
  chave: string
  aba: Aba | null
  /** Rota para onde a aba leva. */
  destino: string
  /** Texto principal da aba. */
  titulo: string
  /** Só ticket: a referência (TD-00027), em tom discreto antes do assunto. */
  referencia?: string
  /** Só seção e Início: classe Tabler do ícone. */
  icone?: string
  /** Cor da etapa, só ticket. */
  corDaEtapa?: string | null
  rascunho: boolean
  /** Nome curto para leitor de tela ("Fechar aba TD-00027"). */
  nomeCurto: string
  /** Nome acessível completo da aba. */
  nome: string
  /** Texto do tooltip nativo (o texto inteiro que a aba pode ter cortado). */
  dica: string
}

const ITEM_INICIO: ItemDaBarra = {
  chave: CHAVE_INICIO,
  aba: null,
  destino: '/inicio',
  titulo: 'Início',
  icone: 'ti ti-home',
  rascunho: false,
  nomeCurto: 'Início',
  nome: 'Início',
  dica: 'Início',
}

function itemDeTicket(aba: AbaTicket): ItemDaBarra {
  const resumo = aba.resumo
  const referencia = resumo?.reference?.trim() || undefined
  const assunto = resumo?.subject?.trim() || undefined
  const rascunho = aba.draft.trim().length > 0
  // Sem resumo (o servidor ainda não hidratou), o que se sabe é o número.
  const titulo = assunto ?? referencia ?? `Ticket #${aba.ticketId}`
  const linhas = [
    referencia && assunto ? `${referencia} · ${assunto}` : titulo,
    resumo?.company_name?.trim() || '',
    rascunho ? 'Rascunho não enviado' : '',
  ].filter(Boolean)
  return {
    chave: chaveAba(aba),
    aba,
    destino: `/tickets/${aba.ticketId}`,
    titulo,
    // Com o assunto na aba, a referência vem antes dele; sem assunto ela já é
    // o título e não se repete.
    referencia: assunto ? referencia : undefined,
    corDaEtapa: resumo?.stage_color,
    rascunho,
    nomeCurto: referencia ?? titulo,
    nome: (referencia && assunto ? `${referencia} ${assunto}` : titulo) + (rascunho ? ', rascunho não enviado' : ''),
    dica: linhas.join('\n'),
  }
}

/** `null` para seção de rota que a barra não conhece (aba herdada de uma
 *  versão antiga): não se mostra. */
function itemDe(aba: Aba): ItemDaBarra | null {
  if (aba.tipo === 'ticket') return itemDeTicket(aba)
  const definicao = secaoPorRota(aba.rota)
  if (!definicao) return null
  return {
    chave: chaveAba(aba),
    aba,
    destino: aba.rota,
    titulo: definicao.rotulo,
    icone: definicao.icone,
    rascunho: false,
    nomeCurto: definicao.rotulo,
    nome: definicao.rotulo,
    dica: definicao.rotulo,
  }
}

/** Sensor do arrasto: o ponteiro (mouse, caneta), a partir de 6px de
 *  movimento para o clique que ativa a aba nunca contar como pegar. Toque
 *  fica de fora de propósito: em tela de toque o gesto de arrastar sobre uma
 *  aba é ROLAR a faixa, e disputá-lo com o arrasto deixaria a faixa presa. */
class SensorDePonteiro extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: PointerEventDoReact, { onActivation }: PointerSensorOptions) => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return false
        onActivation?.({ event })
        return true
      },
    },
  ]
}

/** A aba arrastada acompanha o ponteiro só na horizontal. */
const somenteHorizontal: Modifier = ({ transform }) => ({ ...transform, y: 0 })

function reduzirMovimento(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function BarraDeAbas() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const abas = useTabs((s) => s.tabs)
  const definirAtiva = useTabs((s) => s.definirAtiva)
  const fechar = useTabs((s) => s.fechar)
  const fecharVarias = useTabs((s) => s.fecharVarias)
  const reordenar = useTabs((s) => s.reordenar)

  // A aba em destaque sai da URL, no render: acende num link direto ou no
  // voltar do navegador antes de qualquer efeito rodar.
  const daRota = abaDaRota(pathname)
  const chaveAtiva = daRota?.chave ?? null
  const rotaDaSecao = daRota?.secao?.rota ?? null

  const itens = useMemo(
    () => [ITEM_INICIO, ...abas.flatMap((aba) => itemDe(aba) ?? [])],
    [abas],
  )
  const chavesDoStore = useMemo(() => itens.slice(1).map((i) => i.chave), [itens])
  const ativaPresente = chaveAtiva !== null && itens.some((i) => i.chave === chaveAtiva)

  // ── Store: reconciliar, limpar herança, abrir a seção da rota ────────────
  useEffect(() => {
    // Melhor esforço: sem rede na primeira carga, segue com o que já estava no
    // localStorage. Duas chamadas seguidas (StrictMode) dividem a mesma
    // requisição, o store devolve a que está em voo.
    useTabs
      .getState()
      .reconciliar()
      .catch(() => {})
    // Aba de seção herdada de uma rota que não existe mais não tem para onde
    // levar. Só seção: fechar seção não chega ao servidor.
    const orfas = useTabs
      .getState()
      .tabs.filter((a) => a.tipo === 'secao' && !secaoPorRota(a.rota))
      .map(chaveAba)
    if (orfas.length > 0) useTabs.getState().fecharVarias(orfas)
  }, [])

  useEffect(() => {
    if (!rotaDaSecao) return
    const secao = secaoPorRota(rotaDaSecao)
    if (!secao) return
    const { tabs, active, abrirSecao, definirAtiva: ativar } = useTabs.getState()
    const chave = `secao:${secao.rota}`
    if (!tabs.some((a) => a.tipo === 'secao' && a.rota === secao.rota)) {
      abrirSecao(secao.rota, secao.rotulo, secao.icone)
    } else if (active !== chave) {
      ativar(chave)
    }
  }, [rotaDaSecao])

  // ── Foco: roving tabindex (padrão WAI-ARIA de tabs) ──────────────────────
  // Só UM `role="tab"` do grupo tem tabIndex 0 por vez: Tab entra e sai do
  // grupo de uma vez, e as setas movem o FOCO sem ativar. A Início entra na
  // roda como qualquer outra.
  const [chaveComFoco, setChaveComFoco] = useState<string | null>(chaveAtiva)
  const [ativaVista, setAtivaVista] = useState(chaveAtiva)
  if (ativaVista !== chaveAtiva) {
    setAtivaVista(chaveAtiva)
    setChaveComFoco(chaveAtiva)
  }
  const chaveFocavel = itens.some((i) => i.chave === chaveComFoco)
    ? chaveComFoco
    : ativaPresente
      ? chaveAtiva
      : CHAVE_INICIO

  const botoes = useRef(new Map<string, HTMLButtonElement>())
  const raizRef = useRef<HTMLDivElement>(null)
  const rolagemRef = useRef<HTMLDivElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)
  // Depois de fechar por teclado ou pelo menu a aba que tinha o foco, ele
  // segue para a vizinha em vez de se perder no <body>. Objeto novo a cada
  // pedido, para pedir a mesma aba duas vezes seguidas também disparar o efeito.
  const [pedidoDeFoco, setPedidoDeFoco] = useState<{ chave: string } | null>(null)
  useEffect(() => {
    if (pedidoDeFoco) botoes.current.get(pedidoDeFoco.chave)?.focus()
  }, [pedidoDeFoco])

  function moverFoco(indice: number, para: number | 'anterior' | 'proxima') {
    const alvo =
      para === 'anterior'
        ? (indice - 1 + itens.length) % itens.length
        : para === 'proxima'
          ? (indice + 1) % itens.length
          : para
    const item = itens[alvo]
    if (!item) return
    setChaveComFoco(item.chave)
    botoes.current.get(item.chave)?.focus()
  }

  // ── Rolagem: a aba ativa entra na área visível ───────────────────────────
  function revelar(chave: string) {
    const faixa = rolagemRef.current
    const aba = botoes.current.get(chave)?.parentElement
    if (!faixa || !aba) return
    const esquerda = aba.offsetLeft
    const direita = esquerda + aba.offsetWidth
    let alvo = faixa.scrollLeft
    if (esquerda - MARGEM_AO_REVELAR < faixa.scrollLeft) {
      alvo = Math.max(0, esquerda - MARGEM_AO_REVELAR)
    } else if (direita + MARGEM_AO_REVELAR > faixa.scrollLeft + faixa.clientWidth) {
      alvo = direita + MARGEM_AO_REVELAR - faixa.clientWidth
    }
    if (alvo === faixa.scrollLeft) return
    if (typeof faixa.scrollTo === 'function') {
      faixa.scrollTo({ left: alvo, behavior: reduzirMovimento() ? 'auto' : 'smooth' })
    } else {
      faixa.scrollLeft = alvo
    }
  }

  useEffect(() => {
    // Com muitas abas abertas, a que acabou de abrir nasce fora da barra.
    // `ativaPresente` entra porque a aba do ticket só existe quando os dados
    // dele chegam, depois de a rota já ter mudado.
    if (chaveAtiva && ativaPresente) revelar(chaveAtiva)
    // `revelar` só lê refs e a chave.
  }, [chaveAtiva, ativaPresente])

  // Esmaecido nas pontas onde a faixa continua além do que se vê.
  const [bordas, setBordas] = useState({ esquerda: false, direita: false })
  function medirBordas() {
    const faixa = rolagemRef.current
    if (!faixa) return
    const esquerda = faixa.scrollLeft > 1
    const direita = faixa.scrollLeft + faixa.clientWidth < faixa.scrollWidth - 1
    setBordas((b) => (b.esquerda === esquerda && b.direita === direita ? b : { esquerda, direita }))
  }
  useEffect(() => {
    const faixa = rolagemRef.current
    if (!faixa || typeof ResizeObserver === 'undefined') return
    // O observador mede na primeira observação e a cada mudança de tamanho
    // (janela, aba nova, aba fechada), então não há medição avulsa aqui.
    const observador = new ResizeObserver(() => medirBordas())
    observador.observe(faixa)
    if (listaRef.current) observador.observe(listaRef.current)
    return () => observador.disconnect()
  }, [])

  // A roda do mouse rola a faixa na horizontal (o trackpad já rola). Ouvinte
  // nativo e não passivo: o do React é passivo e não deixaria segurar a página.
  useEffect(() => {
    const faixa = rolagemRef.current
    if (!faixa) return
    const aoGirar = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || faixa.scrollWidth <= faixa.clientWidth) return
      e.preventDefault()
      faixa.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY
    }
    faixa.addEventListener('wheel', aoGirar, { passive: false })
    return () => faixa.removeEventListener('wheel', aoGirar)
  }, [])

  // ── Abrir, fechar ────────────────────────────────────────────────────────
  function ativar(item: ItemDaBarra) {
    setChaveComFoco(item.chave)
    // Clicar na aba em que a pessoa já está não faz nada (como num navegador):
    // navegar de novo tiraria dela a subpágina, o filtro e o ?aba= em que está.
    if (item.chave === chaveAtiva) return
    if (item.aba) definirAtiva(item.chave)
    navigate(item.destino)
  }

  /** Fecha as abas e, se a ativa estava entre elas, navega para a vizinha.
   *  `origem` é a aba que pediu (a do clique, da tecla, do menu): o foco
   *  volta para ela, ou para a vizinha dela se também fechou. */
  function fecharChaves(chaves: string[], origem: string, opcoes: { moverFoco: boolean }) {
    const alvo = new Set(chaves.filter((c) => itens.some((i) => i.chave === c && i.aba !== null)))
    if (alvo.size === 0) return
    const todas = itens.map((i) => i.chave)
    const eraAtiva = chaveAtiva !== null && alvo.has(chaveAtiva)
    const vizinha = eraAtiva ? vizinhaAposFechar(todas, alvo, chaveAtiva) : null
    const paraOndeIr = itens.find((i) => i.chave === vizinha)

    if (alvo.size === 1) fechar([...alvo][0]!)
    else fecharVarias([...alvo])

    if (eraAtiva) {
      if (paraOndeIr?.aba) definirAtiva(paraOndeIr.chave)
      navigate(paraOndeIr?.destino ?? '/inicio')
    }
    if (opcoes.moverFoco) {
      const foco = alvo.has(origem) ? vizinhaAposFechar(todas, alvo, origem) : origem
      const chaveDoFoco = foco ?? CHAVE_INICIO
      setChaveComFoco(chaveDoFoco)
      setPedidoDeFoco({ chave: chaveDoFoco })
    }
  }

  function aoTeclarNaAba(e: KeyboardEvent<HTMLButtonElement>, indice: number, item: ItemDaBarra) {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault()
        moverFoco(indice, 'proxima')
        break
      case 'ArrowLeft':
        e.preventDefault()
        moverFoco(indice, 'anterior')
        break
      case 'Home':
        e.preventDefault()
        moverFoco(indice, 0)
        break
      case 'End':
        e.preventDefault()
        moverFoco(indice, itens.length - 1)
        break
      case 'Delete':
      case 'Backspace':
        // O atalho de um navegador com a aba focada. A Início ignora: não
        // fecha por caminho nenhum.
        if (item.aba) {
          e.preventDefault()
          fecharChaves([item.chave], item.chave, { moverFoco: true })
        }
        break
    }
  }

  // ── Menu de contexto ─────────────────────────────────────────────────────
  const [menu, setMenu] = useState<{ chave: string; x: number; y: number } | null>(null)

  function abrirMenu(e: MouseEvent<HTMLElement>, chave: string) {
    e.preventDefault()
    // Pela tecla de menu (ou Shift+F10) o evento chega em 0,0 e o menu abriria
    // no canto da tela: aí ele nasce sob a aba.
    const r = e.currentTarget.getBoundingClientRect()
    const peloTeclado = e.clientX === 0 && e.clientY === 0
    setMenu({ chave, x: peloTeclado ? r.left + 12 : e.clientX, y: peloTeclado ? r.bottom : e.clientY })
  }

  function itensDoMenu(chave: string): ItemDoMenu[] {
    const indice = itens.findIndex((i) => i.chave === chave)
    if (indice < 0) return []
    const fechaveis = (lista: ItemDaBarra[]) => lista.filter((i) => i.aba !== null).map((i) => i.chave)
    const outras = fechaveis(itens.filter((_, j) => j !== indice))
    const aDireita = fechaveis(itens.slice(indice + 1))
    const aEsquerda = fechaveis(itens.slice(0, indice))
    const todas = fechaveis(itens)
    const fecharEssas = (chaves: string[]) => () => fecharChaves(chaves, chave, { moverFoco: true })
    return [
      {
        rotulo: 'Fechar',
        desabilitado: itens[indice]!.aba === null,
        onSelecionar: fecharEssas([chave]),
      },
      { tipo: 'separador' },
      { rotulo: 'Fechar as outras', desabilitado: outras.length === 0, onSelecionar: fecharEssas(outras) },
      { rotulo: 'Fechar as da direita', desabilitado: aDireita.length === 0, onSelecionar: fecharEssas(aDireita) },
      { rotulo: 'Fechar as da esquerda', desabilitado: aEsquerda.length === 0, onSelecionar: fecharEssas(aEsquerda) },
      { tipo: 'separador' },
      { rotulo: 'Fechar todas', desabilitado: todas.length === 0, onSelecionar: fecharEssas(todas) },
    ]
  }

  // ── Arrastar e soltar ────────────────────────────────────────────────────
  const sensores = useSensors(useSensor(SensorDePonteiro, { activationConstraint: { distance: 6 } }))

  function aoSoltar({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const de = chavesDoStore.indexOf(String(active.id))
    const para = chavesDoStore.indexOf(String(over.id))
    if (de < 0 || para < 0) return
    reordenar(arrayMove(chavesDoStore, de, para))
  }

  const anuncios: Announcements = {
    onDragStart: () => 'Aba levantada. Solte sobre outra posição para reordenar.',
    onDragOver: ({ over }) =>
      over ? `Aba sobre a posição ${chavesDoStore.indexOf(String(over.id)) + 1} de ${chavesDoStore.length}.` : undefined,
    onDragEnd: ({ over }) =>
      over ? `Aba movida para a posição ${chavesDoStore.indexOf(String(over.id)) + 1} de ${chavesDoStore.length}.` : 'Aba solta no mesmo lugar.',
    onDragCancel: () => 'Movimento cancelado.',
  }

  return (
    <div className="barra-de-abas" ref={raizRef}>
      <div
        ref={rolagemRef}
        className="barra-de-abas__rolagem"
        data-borda-esquerda={bordas.esquerda || undefined}
        data-borda-direita={bordas.direita || undefined}
        onScroll={medirBordas}
      >
        <DndContext
          sensors={sensores}
          collisionDetection={closestCenter}
          modifiers={[somenteHorizontal]}
          onDragEnd={aoSoltar}
          accessibility={{
            announcements: anuncios,
            screenReaderInstructions: { draggable: 'Arraste com o mouse para reordenar as abas.' },
          }}
        >
          <SortableContext items={chavesDoStore} strategy={horizontalListSortingStrategy}>
            {/* tablist só em volta das abas: o "+" é uma ação, não uma aba, e
                fica fora do grupo e do roving tabindex (o Tab normal chega nele). */}
            <div ref={listaRef} className="barra-de-abas__lista" role="tablist" aria-label="Abas abertas">
              {itens.map((item, indice) => (
                <Aba
                  key={item.chave}
                  item={item}
                  ativa={item.chave === chaveAtiva}
                  tabIndex={item.chave === chaveFocavel ? 0 : -1}
                  registrar={(el) => {
                    if (el) botoes.current.set(item.chave, el)
                    else botoes.current.delete(item.chave)
                  }}
                  onAtivar={() => ativar(item)}
                  onFechar={() => fecharChaves([item.chave], item.chave, { moverFoco: false })}
                  onTeclar={(e) => aoTeclarNaAba(e, indice, item)}
                  onMenu={(e) => abrirMenu(e, item.chave)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      {/* Fora da rolagem: com a faixa cheia, o "+" fica colado à direita dela
          em vez de sumir junto com as abas que passam. Com poucas abas, é o
          que vem logo depois da última, onde a próxima apareceria. */}
      <button
        type="button"
        className="barra-de-abas__novo"
        aria-label="Novo ticket"
        title="Novo ticket"
        onClick={() => navigate(NOVO_TICKET)}
      >
        <i className="ti ti-plus" aria-hidden="true" />
      </button>

      <MenuFlutuante
        aberto={menu !== null}
        onFechar={() => setMenu(null)}
        itens={menu ? itensDoMenu(menu.chave) : []}
        rotulo="Ações da aba"
        posicao={menu}
        obterAncora={() => (menu ? (botoes.current.get(menu.chave) ?? null) : null)}
      />
    </div>
  )
}

// ── Uma aba ─────────────────────────────────────────────────────────────────

interface PropsAba {
  item: ItemDaBarra
  ativa: boolean
  tabIndex: 0 | -1
  registrar: (el: HTMLButtonElement | null) => void
  onAtivar: () => void
  onFechar: () => void
  onTeclar: (e: KeyboardEvent<HTMLButtonElement>) => void
  onMenu: (e: MouseEvent<HTMLElement>) => void
}

function Aba({ item, ativa, tabIndex, registrar, onAtivar, onFechar, onTeclar, onMenu }: PropsAba) {
  const fixa = item.aba === null
  // A Início não entra no arrasto (`disabled`): é a primeira por definição.
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id: item.chave, disabled: fixa })
  const estilo: CSSProperties = { transform: CSS.Translate.toString(transform), transition }
  const ehTicket = item.aba?.tipo === 'ticket'

  return (
    <div
      ref={setNodeRef}
      style={estilo}
      className={
        'barra-de-abas__aba' +
        (ehTicket ? ' barra-de-abas__aba--ticket' : '') +
        (fixa ? ' barra-de-abas__aba--fixa' : '') +
        (ativa ? ' barra-de-abas__aba--ativa' : '') +
        (isDragging ? ' barra-de-abas__aba--arrastando' : '')
      }
      onContextMenu={onMenu}
    >
      <button
        type="button"
        role="tab"
        ref={registrar}
        className="barra-de-abas__abrir"
        aria-selected={ativa}
        aria-label={item.nome}
        aria-keyshortcuts={fixa ? undefined : 'Delete'}
        tabIndex={tabIndex}
        title={item.dica}
        // Só os `listeners` do dnd-kit, não os `attributes`: estes trariam
        // role/tabIndex/aria próprios de "sortable" por cima do `role="tab"` e
        // do roving tabindex (e o teclado aqui já tem dono).
        {...listeners}
        onKeyDown={onTeclar}
        onClick={onAtivar}
        onMouseDown={(e) => {
          // O botão do meio, no Windows, inicia a rolagem automática: aqui ele
          // fecha a aba.
          if (e.button === 1) e.preventDefault()
        }}
        onAuxClick={(e) => {
          if (e.button === 1 && !fixa) {
            e.preventDefault()
            onFechar()
          }
        }}
      >
        {item.icone && <i className={item.icone} aria-hidden="true" />}
        {ehTicket && item.corDaEtapa && (
          <span className="barra-de-abas__etapa" style={{ background: item.corDaEtapa }} aria-hidden="true" />
        )}
        {item.referencia && <span className="barra-de-abas__ref">{item.referencia}</span>}
        <span className="barra-de-abas__titulo">{item.titulo}</span>
        {item.rascunho && <span className="barra-de-abas__rascunho" aria-hidden="true" />}
      </button>
      {/* A Início não fecha: é o destino de fallback de todas as outras. Sem
          botão em vez de botão desabilitado: desabilitado sugere "dá para
          fechar, só não agora", e não é o caso. Fora do Tab (o Delete fecha a
          aba focada); é irmão do `role="tab"`, nunca filho dele. */}
      {!fixa && (
        <button
          type="button"
          className="barra-de-abas__fechar"
          aria-label={`Fechar aba ${item.nomeCurto}`}
          title="Fechar aba"
          tabIndex={-1}
          onClick={onFechar}
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
