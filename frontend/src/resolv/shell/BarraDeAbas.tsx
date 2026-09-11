import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type Aba } from '@/stores/tabs'
import { MenuFlutuante, type ItemDoMenu } from './MenuFlutuante'
import { NAV } from './Sidebar'
import './barra-de-abas.scss'
import { Icone } from './Icone'

/**
 * Barra de abas do shell — abas de NAVEGADOR: a ativa tem os cantos de cima
 * arredondados e se funde, sem linha, com o painel de conteúdo logo abaixo
 * (shell.scss); as outras são só texto sobre o cromo, separadas por um traço.
 * Mostra as duas espécies de aba do store (`stores/tabs.ts`) numa lista só,
 * na ordem em que foram abertas (ou arrastadas): tickets (várias por vez) e
 * seções (uma por rota, dedup por prefixo).
 *
 * Início é a exceção deliberada: é aba FIXA, sempre a primeira, sem botão de
 * fechar, não arrasta — e não mora no store. Não está lá porque nada nela é
 * estado: não abre, não fecha, não reordena. Deixá-la fora evita ter que
 * proteger o store inteiro contra "e se alguém fechar a Início" (o caso em
 * que a barra ficaria sem nenhuma aba e sem para onde voltar).
 *
 * Interações, além do clique: clique do meio e Delete/Backspace fecham;
 * botão direito abre o menu de contexto (fechar as outras / as da direita /
 * as da esquerda); arrastar reordena (só com o ponteiro — com o teclado as
 * setas já têm dono: mover o foco, padrão WAI-ARIA de tabs); o "+" abre um
 * ticket novo no clique e, no hover, a lista de seções pra abrir rápido; o
 * "…" do fim fecha todas de uma vez.
 *
 * Esta barra monta UMA vez em NovoShell, não uma por página — quem decide o
 * que está aberto é a ROTA atual, observada aqui. Ticket é exceção:
 * `PaginaDetalheTicket` chama `abrirTicket()` ao carregar os dados (é de lá
 * que vem o resumo pro título da aba); a barra só decide qual fica ativa.
 */

const SECOES = NAV.filter((n) => n.enabled && n.id !== 'inicio')

/** Chave da aba fixa. Não colide com as do store (`ticket:`/`secao:`). */
const CHAVE_INICIO = 'inicio'

function secaoDaRota(pathname: string) {
  return SECOES.find((s) => pathname === s.route || pathname.startsWith(`${s.route}/`))
}

/** Deriva a aba que DEVERIA estar em destaque a partir da URL, não do store:
 *  assim a aba certa acende num link direto ou no voltar do navegador, antes
 *  de qualquer efeito rodar. */
function chaveAtivaDaRota(pathname: string): string | null {
  if (pathname === '/inicio') return CHAVE_INICIO
  const ticket = pathname.match(/^\/chamados\/(\d+)$/)
  if (ticket) return `ticket:${ticket[1]}`
  const secao = secaoDaRota(pathname)
  return secao ? `secao:${secao.route}` : null
}

function destinoDaAba(aba: Aba): string {
  return aba.tipo === 'ticket' ? `/chamados/${aba.ticketId}` : aba.rota
}

/** Uma linha da barra. `aba: null` é a Início — fixa, sem fechar. */
type ItemDaBarra = { chave: string; aba: Aba | null }

interface Props {
  /** Só em tela pequena: abre a sidebar como gaveta. Sem a prop, o botão de
   *  menu não existe (a barra montada sozinha, como nos testes, não tem
   *  sidebar pra abrir). */
  onAbrirNavegacao?: () => void
}

export function BarraDeAbas({ onAbrirNavegacao }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const tabs = useTabs((s) => s.tabs)
  const abrirSecao = useTabs((s) => s.abrirSecao)
  const definirAtiva = useTabs((s) => s.definirAtiva)
  const fechar = useTabs((s) => s.fechar)
  const fecharVarias = useTabs((s) => s.fecharVarias)
  const reordenar = useTabs((s) => s.reordenar)

  const chaveDaRota = chaveAtivaDaRota(location.pathname)

  // Garante que a rota atual tem aba — só para SEÇÃO; ticket é o
  // `PaginaDetalheTicket` que abre (comentário no topo do arquivo).
  useEffect(() => {
    if (!chaveDaRota || !chaveDaRota.startsWith('secao:')) return
    const rota = chaveDaRota.slice('secao:'.length)
    const jaExiste = useTabs.getState().tabs.some((a) => a.tipo === 'secao' && a.rota === rota)
    if (jaExiste) {
      if (useTabs.getState().active !== chaveDaRota) definirAtiva(chaveDaRota)
      return
    }
    const secao = SECOES.find((s) => s.route === rota)
    if (secao) abrirSecao(secao.route, secao.label, secao.icon)
    // Só quando a ROTA muda — abrirSecao/definirAtiva são estáveis (zustand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaRota])

  const itens: ItemDaBarra[] = [
    { chave: CHAVE_INICIO, aba: null },
    ...tabs.map((aba) => ({ chave: chaveAba(aba), aba })),
  ]
  const chavesDoStore = tabs.map(chaveAba)

  const idAtivo = chaveDaRota ?? useTabs.getState().active

  // Roving tabindex (padrão WAI-ARIA de tabs): só UM `role="tab"` do grupo tem
  // tabIndex 0 por vez, Tab entra/sai do grupo inteiro de uma vez, setas movem
  // o FOCO sem ativar. A Início entra na roda como qualquer outra — ser fixa
  // não é motivo para ficar fora do teclado.
  const [chaveComFoco, setChaveComFoco] = useState<string | null>(idAtivo)
  const botoesRef = useRef(new Map<string, HTMLButtonElement>())

  const [idAtivoVisto, setIdAtivoVisto] = useState(idAtivo)
  if (idAtivoVisto !== idAtivo) {
    setIdAtivoVisto(idAtivo)
    setChaveComFoco(idAtivo)
  }

  // A aba que acendeu entra na área visível — com muitas abas abertas, a que
  // acabou de abrir nasce fora da barra (rolagem horizontal).
  useEffect(() => {
    if (!idAtivo) return
    botoesRef.current.get(idAtivo)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [idAtivo])

  const chaveComFocoValida = itens.some((i) => i.chave === chaveComFoco)
    ? chaveComFoco
    : CHAVE_INICIO

  function moverFoco(indiceAtual: number, direcao: 1 | -1) {
    const proximo = itens[(indiceAtual + direcao + itens.length) % itens.length]!
    setChaveComFoco(proximo.chave)
    botoesRef.current.get(proximo.chave)?.focus()
  }

  /** Confirma antes de descartar rascunho e navega pra quem sobrou quando a
   *  ativa fechou. A pergunta só aparece quando há rascunho: confirmar toda
   *  troca de aba viraria ruído. O rascunho é local por contrato (docs/06:
   *  nunca vai para o servidor), então fechar sem perguntar apaga de vez. */
  function fecharAba(aba: Aba, chave: string, ativa: boolean) {
    if (aba.tipo === 'ticket') {
      const rascunho = aba.draft.trim().length > 0
      const ref = aba.resumo?.reference ?? `#${aba.ticketId}`
      if (rascunho && !window.confirm(`A aba ${ref} tem um rascunho não enviado. Fechar descarta esse texto.`)) {
        return
      }
    }
    const restantes = tabs.filter((a) => chaveAba(a) !== chave)
    fechar(chave)
    // Fechar a aba ativa cai na última que sobrou; sem nenhuma, no Início —
    // que está sempre ali, então nunca existe o estado "sem aba nenhuma".
    if (ativa) {
      const proxima = restantes.at(-1)
      navigate(proxima ? destinoDaAba(proxima) : '/inicio')
    }
  }

  /** Versão em lote (menu de contexto e "fechar todas"): UMA pergunta pelo
   *  conjunto, contando quantas têm rascunho — N perguntas seguidas seria
   *  pior do que não perguntar. */
  function fecharConjunto(chaves: string[]) {
    if (chaves.length === 0) return
    const alvo = new Set(chaves)
    const comRascunho = tabs.filter((a) => alvo.has(chaveAba(a)) && a.tipo === 'ticket' && a.draft.trim().length > 0).length
    if (comRascunho > 0) {
      const aviso =
        comRascunho === 1
          ? 'Uma das abas tem um rascunho não enviado. Fechar descarta esse texto.'
          : `${comRascunho} abas têm rascunho não enviado. Fechar descarta esses textos.`
      if (!window.confirm(aviso)) return
    }
    const restantes = tabs.filter((a) => !alvo.has(chaveAba(a)))
    fecharVarias(chaves)
    if (idAtivo && alvo.has(idAtivo)) {
      const proxima = restantes.at(-1)
      navigate(proxima ? destinoDaAba(proxima) : '/inicio')
    }
  }

  function aoTeclarNaAba(e: KeyboardEvent<HTMLButtonElement>, indice: number, item: ItemDaBarra, ativa: boolean) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moverFoco(indice, 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moverFoco(indice, -1)
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && item.aba) {
      // Mesmo atalho de um navegador com a aba focada. A Início ignora — não
      // fecha por nenhum caminho.
      e.preventDefault()
      fecharAba(item.aba, item.chave, ativa)
    }
  }

  function ativar(item: ItemDaBarra) {
    setChaveComFoco(item.chave)
    if (!item.aba) {
      navigate('/inicio')
      return
    }
    definirAtiva(item.chave)
    navigate(destinoDaAba(item.aba))
  }

  // ── Menus ────────────────────────────────────────────────────────────────
  const [menuContexto, setMenuContexto] = useState<{ chave: string; x: number; y: number } | null>(null)
  const [abrirRapido, setAbrirRapido] = useState(false)
  const [menuMais, setMenuMais] = useState(false)
  const novoRef = useRef<HTMLButtonElement>(null)
  const maisRef = useRef<HTMLButtonElement>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function itensDoMenuDeContexto(chave: string): ItemDoMenu[] {
    const indice = itens.findIndex((i) => i.chave === chave)
    const item = itens[indice]
    if (!item) return []
    const outras = chavesDoStore.filter((c) => c !== chave)
    // Início é o índice 0 e não está no store — "à esquerda" só conta as que
    // fecham de verdade.
    const aDireita = itens.slice(indice + 1).map((i) => i.chave)
    const aEsquerda = itens
      .slice(0, indice)
      .map((i) => i.chave)
      .filter((c) => c !== CHAVE_INICIO)
    const ativa = chave === idAtivo
    return [
      {
        rotulo: 'Fechar aba',
        icone: 'ti ti-x',
        desabilitado: item.aba === null,
        onSelecionar: () => item.aba && fecharAba(item.aba, chave, ativa),
      },
      { tipo: 'separador' },
      {
        rotulo: 'Fechar as outras abas',
        desabilitado: outras.length === 0,
        onSelecionar: () => fecharConjunto(outras),
      },
      {
        rotulo: 'Fechar as abas à direita',
        icone: 'ti ti-chevron-right',
        desabilitado: aDireita.length === 0,
        onSelecionar: () => fecharConjunto(aDireita),
      },
      {
        rotulo: 'Fechar as abas à esquerda',
        icone: 'ti ti-chevron-left',
        desabilitado: aEsquerda.length === 0,
        onSelecionar: () => fecharConjunto(aEsquerda),
      },
    ]
  }

  const itensAbrirRapido: ItemDoMenu[] = SECOES.map((s) => ({
    rotulo: s.label,
    icone: s.icon,
    onSelecionar: () => navigate(s.route),
  }))

  const itensMais: ItemDoMenu[] = [
    { rotulo: 'Novo ticket', icone: 'ti ti-plus', onSelecionar: () => navigate('/chamados/novo') },
    { tipo: 'separador' },
    {
      rotulo: 'Fechar todas as abas',
      icone: 'ti ti-trash',
      perigo: true,
      desabilitado: chavesDoStore.length === 0,
      onSelecionar: () => fecharConjunto(chavesDoStore),
    },
  ]

  function agendarAbrirRapido(abrir: boolean) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    // Abre com uma pausa (passar o mouse a caminho de outra aba não abre) e
    // fecha com outra, menor (dá pra atravessar a fresta entre botão e menu).
    hoverTimer.current = setTimeout(() => setAbrirRapido(abrir), abrir ? 200 : 150)
  }
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
  }, [])

  // ── Arrastar e soltar ────────────────────────────────────────────────────
  // Distância mínima antes de virar arrasto: sem ela o clique que ativa a aba
  // já contaria como pegar.
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  function aoSoltar(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const de = chavesDoStore.indexOf(String(active.id))
    const para = chavesDoStore.indexOf(String(over.id))
    if (de < 0 || para < 0) return
    reordenar(arrayMove(chavesDoStore, de, para))
  }

  const abaAtivaEhAInicio = idAtivo === CHAVE_INICIO

  return (
    <div className="barra-de-abas">
      {onAbrirNavegacao && (
        <button
          type="button"
          className="barra-de-abas__menu-mobile"
          aria-label="Abrir menu de navegação"
          title="Menu"
          onClick={onAbrirNavegacao}
        >
          <Icone nome="ti ti-menu-2" tamanho={16} />
        </button>
      )}

      <div className="barra-de-abas__rolagem">
        <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={aoSoltar}>
          <SortableContext items={chavesDoStore} strategy={horizontalListSortingStrategy}>
            {/* tablist só em volta das abas: o "+" e o "…" são ações, não abas —
                ficam fora do grupo e do roving tabindex (Tab normal alcança). */}
            <div
              className={'barra-de-abas__lista' + (abaAtivaEhAInicio ? ' barra-de-abas__lista--inicio-ativa' : '')}
              role="tablist"
              aria-label="Abas abertas"
            >
              {itens.map((item, indice) => (
                <Aba
                  key={item.chave}
                  item={item}
                  indice={indice}
                  ativa={item.chave === idAtivo}
                  // A separação some ao lado da ativa: a curva dela já separa.
                  antesDaAtiva={itens[indice + 1]?.chave === idAtivo}
                  tabIndex={item.chave === chaveComFocoValida ? 0 : -1}
                  registrar={(el) => {
                    if (el) botoesRef.current.set(item.chave, el)
                    else botoesRef.current.delete(item.chave)
                  }}
                  onAtivar={() => ativar(item)}
                  onFechar={() => item.aba && fecharAba(item.aba, item.chave, item.chave === idAtivo)}
                  onTeclar={(e) => aoTeclarNaAba(e, indice, item, item.chave === idAtivo)}
                  onMenuDeContexto={(e) => {
                    e.preventDefault()
                    setMenuContexto({ chave: item.chave, x: e.clientX, y: e.clientY })
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* "+" logo depois da última aba, onde a próxima apareceria: abrir
            ticket novo é a ação que mais nasce daqui. No hover, a lista de
            seções — o atalho de "abrir rápido" de um navegador. */}
        <div
          className="barra-de-abas__novo-grupo"
          onMouseEnter={() => agendarAbrirRapido(true)}
          onMouseLeave={() => agendarAbrirRapido(false)}
        >
          <button
            ref={novoRef}
            type="button"
            className="barra-de-abas__novo"
            aria-label="Abrir novo ticket"
            title="Abrir novo ticket"
            aria-haspopup="menu"
            aria-expanded={abrirRapido}
            onClick={() => navigate('/chamados/novo')}
            onKeyDown={(e) => {
              // Sem mouse, a lista de abertura rápida vem pela seta.
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setAbrirRapido(true)
              }
            }}
          >
            <Icone nome="ti ti-plus" tamanho={16} />
          </button>
          <MenuFlutuante
            aberto={abrirRapido}
            onFechar={() => setAbrirRapido(false)}
            itens={itensAbrirRapido}
            rotulo="Abrir rápido"
            cabecalho="Abrir rápido"
            obterAncora={() => novoRef.current}
          />
        </div>
      </div>

      <button
        ref={maisRef}
        type="button"
        className="barra-de-abas__mais"
        aria-label="Mais ações das abas"
        title="Mais ações"
        aria-haspopup="menu"
        aria-expanded={menuMais}
        onClick={() => setMenuMais((v) => !v)}
      >
        <Icone nome="ti ti-dots" tamanho={16} />
      </button>
      <MenuFlutuante
        aberto={menuMais}
        onFechar={() => setMenuMais(false)}
        itens={itensMais}
        rotulo="Mais ações das abas"
        obterAncora={() => maisRef.current}
        alinhar="fim"
      />

      <MenuFlutuante
        aberto={menuContexto !== null}
        onFechar={() => setMenuContexto(null)}
        itens={menuContexto ? itensDoMenuDeContexto(menuContexto.chave) : []}
        rotulo="Ações da aba"
        posicao={menuContexto}
        obterAncora={() => (menuContexto ? (botoesRef.current.get(menuContexto.chave) ?? null) : null)}
      />
    </div>
  )
}

// ── Uma aba ─────────────────────────────────────────────────────────────────

interface PropsAba {
  item: ItemDaBarra
  indice: number
  ativa: boolean
  antesDaAtiva: boolean
  tabIndex: 0 | -1
  registrar: (el: HTMLButtonElement | null) => void
  onAtivar: () => void
  onFechar: () => void
  onTeclar: (e: KeyboardEvent<HTMLButtonElement>) => void
  onMenuDeContexto: (e: MouseEvent<HTMLElement>) => void
}

function Aba({ item, ativa, antesDaAtiva, tabIndex, registrar, onAtivar, onFechar, onTeclar, onMenuDeContexto }: PropsAba) {
  const { chave, aba } = item
  const fixa = aba === null
  // A Início não entra no arrasto (`disabled`): é a primeira por definição.
  const { setNodeRef, transform, transition, isDragging, listeners } = useSortable({ id: chave, disabled: fixa })

  const estilo: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const titulo = fixa
    ? 'Início'
    : aba.tipo === 'ticket'
      ? aba.resumo?.company_name || aba.resumo?.subject || 'Ticket'
      : aba.titulo
  const ref = !fixa && aba.tipo === 'ticket' ? (aba.resumo?.reference ?? `#${aba.ticketId}`) : null
  const rascunho = !fixa && aba.tipo === 'ticket' && aba.draft.trim().length > 0

  return (
    <div
      ref={setNodeRef}
      style={estilo}
      className={
        'barra-de-abas__tab' +
        (ativa ? ' barra-de-abas__tab--ativa' : '') +
        (fixa ? ' barra-de-abas__tab--fixa' : '') +
        (antesDaAtiva ? ' barra-de-abas__tab--antes-da-ativa' : '') +
        (isDragging ? ' barra-de-abas__tab--arrastando' : '')
      }
      onContextMenu={onMenuDeContexto}
    >
      {/* As duas junções côncavas com o painel — só a ativa tem, porque só
          ela toca o painel. Elementos, não pseudo: o ::after da aba já é o
          traço separador. */}
      {ativa && (
        <>
          <span className="barra-de-abas__junta barra-de-abas__junta--esq" aria-hidden="true" />
          <span className="barra-de-abas__junta barra-de-abas__junta--dir" aria-hidden="true" />
        </>
      )}
      <button
        type="button"
        role="tab"
        // id/aria-controls só faz sentido pra ticket: é o único tipo de aba
        // com um tabpanel de verdade do outro lado (PaginaDetalheTicket.tsx,
        // id="detalhe-painel-ticket"). Aba de seção e Início trocam a página
        // inteira ao ativar — não há painel parceiro pra apontar.
        id={!fixa && aba.tipo === 'ticket' ? `aba-tab-${aba.ticketId}` : undefined}
        aria-controls={!fixa && aba.tipo === 'ticket' ? 'detalhe-painel-ticket' : undefined}
        aria-selected={ativa}
        tabIndex={tabIndex}
        ref={registrar}
        className="barra-de-abas__abrir"
        title={!fixa && aba.tipo === 'ticket' && aba.resumo?.subject ? `${ref} · ${aba.resumo.subject}` : titulo}
        // Só os `listeners` do dnd-kit, não os `attributes`: estes trariam
        // role/tabIndex/aria próprios de "sortable" por cima do `role="tab"` e
        // do roving tabindex — e o teclado aqui já tem dono.
        {...listeners}
        onKeyDown={onTeclar}
        onClick={onAtivar}
        onAuxClick={(e) => {
          // Clique do meio fecha, como no navegador.
          if (e.button === 1 && !fixa) {
            e.preventDefault()
            onFechar()
          }
        }}
      >
        <span className="barra-de-abas__titulo">
          {fixa && <Icone nome="ti ti-home" tamanho={16} />}
          {!fixa && aba.tipo === 'ticket' && aba.resumo?.stage_color && (
            <span
              className="barra-de-abas__etapa"
              style={{ background: aba.resumo.stage_color }}
              aria-hidden="true"
            />
          )}
          {!fixa && aba.tipo === 'secao' && <Icone nome={aba.icone} tamanho={16} />}
          {titulo}
        </span>
        {ref && (
          <span className="barra-de-abas__num">
            {ref}
            {rascunho && (
              <span className="barra-de-abas__rascunho" title="Rascunho não enviado">
                · rascunho
              </span>
            )}
          </span>
        )}
      </button>
      {/* A Início não fecha: é o destino de fallback de todas as outras.
          Sem botão em vez de botão desabilitado — desabilitado sugere
          "dá para fechar, só não agora", e não é o caso. */}
      {!fixa && (
        <button
          type="button"
          className="barra-de-abas__fechar"
          aria-label={`Fechar aba ${titulo}`}
          title="Fechar aba"
          onClick={onFechar}
        >
          <Icone nome="ti ti-x" tamanho={16} />
        </button>
      )}
    </div>
  )
}
