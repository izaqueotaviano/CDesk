import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { ROTULO_STATUS } from '../tickets/format'
import { useConsultaDeMidia } from '../shell/useConsultaDeMidia'
import { BarraDeFiltros } from './BarraDeFiltros'
import { ConteudoDoCartao } from './Cartao'
import { Coluna } from './Coluna'
import { EsqueletoQuadro } from './EsqueletoQuadro'
import { ModalFecharTicket } from './ModalFecharTicket'
import {
  useApagarLane,
  useCriarLane,
  useCriarQuadro,
  useDefinirLimite,
  useDefinirPrazo,
  useFecharTicket,
  usePlace,
  useQuadroMontado,
  useQuadros,
} from './dados'
import {
  FILTROS_VAZIOS,
  aplicarNaUrl,
  empresasDoQuadro,
  filtrarCartoes,
  filtrosDaUrl,
  responsaveisDoQuadro,
  temFiltroAtivo,
  type Filtros,
} from './filtros'
import { COR_DO_STATUS, type StatusDoCartao } from './formato'
import { TECLAS_DO_QUADRO, coordenadasPorColuna } from './teclado'
import type { Cartao as CartaoTipo, Coluna as ColunaTipo } from './tipos'
import './kanban.scss'

const AGRUPAR = 'status' as const // única lente hoje — ver nota no README da pasta

const idDoTicket = (id: string | number) => Number(String(id).replace('ticket-', ''))

/**
 * Anúncios em português para leitor de tela — o padrão do dnd-kit já
 * cobre pega/move/solta/cancela sozinho, só que em inglês; o resto do
 * app inteiro fala português, e isto é o que uma pessoa usando teclado +
 * leitor de tela de fato ouve a cada tecla.
 */
function anuncios(nomeDoCartao: (id: number) => string, nomeDaColuna: (key: string) => string) {
  return {
    onDragStart: ({ active }: { active: { id: string | number } }) =>
      `Pegou o ticket ${nomeDoCartao(idDoTicket(active.id))}. Setas para os lados mudam de coluna, espaço solta, Esc cancela.`,
    onDragOver: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `Ticket ${nomeDoCartao(idDoTicket(active.id))} sobre a coluna ${nomeDaColuna(String(over.id))}.`
        : `Ticket ${nomeDoCartao(idDoTicket(active.id))} fora de qualquer coluna.`,
    onDragEnd: ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) =>
      over
        ? `Ticket ${nomeDoCartao(idDoTicket(active.id))} solto na coluna ${nomeDaColuna(String(over.id))}.`
        : `Movimento cancelado. O ticket ${nomeDoCartao(idDoTicket(active.id))} voltou ao lugar.`,
    onDragCancel: ({ active }: { active: { id: string | number } }) =>
      `Movimento cancelado. O ticket ${nomeDoCartao(idDoTicket(active.id))} voltou ao lugar.`,
  }
}

/** O que o leitor de tela lê ao focar um cartão (o padrão do dnd-kit é em
 *  inglês e fala de "space bar" e "draggable item"). */
const INSTRUCOES = {
  draggable:
    'Enter abre o ticket. Para mover, aperte espaço, use as setas para os lados para escolher a coluna e espaço de novo para soltar. Esc cancela.',
}

function mensagemDoErro(err: unknown, padrao: string): string {
  return err instanceof ApiError ? (err.detail ?? padrao) : padrao
}

export function PaginaKanban() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const { data: quadros, isLoading: carregandoQuadros } = useQuadros()
  const [boardId, setBoardId] = useState<number | null>(null)
  const quadroAtivo = boardId ?? quadros?.[0]?.id ?? null

  const { data: quadro, isLoading, isError, refetch, dataUpdatedAt } = useQuadroMontado(quadroAtivo, AGRUPAR)
  const place = usePlace(AGRUPAR)
  const definirPrazo = useDefinirPrazo(AGRUPAR)
  const definirLimite = useDefinirLimite(AGRUPAR)
  const criarLane = useCriarLane(quadroAtivo, AGRUPAR)
  const apagarLane = useApagarLane(quadroAtivo, AGRUPAR)
  const fecharTicket = useFecharTicket(quadroAtivo, AGRUPAR)
  const criarQuadro = useCriarQuadro()
  const semAnimacao = useConsultaDeMidia('(prefers-reduced-motion: reduce)')

  const [arrastandoId, setArrastandoId] = useState<number | null>(null)
  const [paraFechar, setParaFechar] = useState<CartaoTipo | null>(null)
  const [novaColuna, setNovaColuna] = useState(false)
  const [nomeNovaColuna, setNomeNovaColuna] = useState('')
  const [nomeNovoQuadro, setNomeNovoQuadro] = useState('')
  // Este diretório não tem toast — um banner local e dispensável é o que as
  // outras telas do resolv/ já usam para erro de mutação. Sem ele, mover/
  // criar/apagar coluna ou definir prazo falhava em silêncio e o card/coluna
  // só "voltava" sem explicação.
  const [avisoErro, setAvisoErro] = useState<string | null>(null)
  // arraste que começou pelo teclado: ao terminar, o foco volta para o
  // cartão na coluna nova (ele remonta lá, e o foco cairia no <body>)
  const arrastePorTeclado = useRef(false)

  // ---- Filtros: na URL, como a fila de chamados (ver filtros.ts) ----
  const [searchParams, setSearchParams] = useSearchParams()
  const filtrosUrl = filtrosDaUrl(searchParams)
  // A busca bruta (cada tecla) filtra na hora, mas só vai para a URL depois
  // de uma pausa: escrever a URL a cada tecla re-renderiza o roteador inteiro
  // à toa. As outras escolhas (um clique cada) vão direto.
  const [busca, setBusca] = useState(filtrosUrl.busca)
  const filtros: Filtros = { ...filtrosUrl, busca }
  useEffect(() => {
    if (busca.trim() === filtrosUrl.busca) return
    const t = setTimeout(() => setSearchParams((atual) => aplicarNaUrl(atual, { busca }), { replace: true }), 250)
    return () => clearTimeout(t)
  }, [busca, filtrosUrl.busca, setSearchParams])

  function mudarFiltros(mudancas: Partial<Filtros>) {
    const { busca: novaBusca, ...resto } = mudancas
    if (novaBusca !== undefined) setBusca(novaBusca)
    // `replace`: cada escolha refina o mesmo recorte; "voltar" sai da tela
    // em vez de desfazer filtro por filtro
    if (Object.keys(resto).length) setSearchParams((atual) => aplicarNaUrl(atual, resto), { replace: true })
  }

  function limparFiltros() {
    setBusca('')
    setSearchParams((atual) => aplicarNaUrl(atual, FILTROS_VAZIOS), { replace: true })
  }

  const filtrando = temFiltroAtivo(filtros)
  const entradas = useMemo(() => quadro?.entries ?? [], [quadro])
  // O status DE VERDADE de cada cartão (nome e cor). Numa coluna de status é a
  // própria coluna; numa coluna de organização (lane) a coluna não diz nada
  // sobre o status, então a faixa e o selo do cartão vêm daqui.
  const statusPorStage = useMemo(() => {
    const m = new Map<number, StatusDoCartao>()
    for (const c of quadro?.columns ?? []) {
      if (c.kind === 'stage' && c.stage != null) m.set(c.stage, { nome: c.name, cor: c.color })
    }
    return m
  }, [quadro])
  const statusDe = (c: CartaoTipo): StatusDoCartao =>
    (c.stage != null ? statusPorStage.get(c.stage) : undefined) ?? {
      nome: ROTULO_STATUS[c.ticket_status],
      cor: COR_DO_STATUS[c.ticket_status],
    }
  const visiveis = useMemo(
    () => (filtrando ? filtrarCartoes(entradas, filtros, me?.id ?? null) : entradas),
    // `filtros` é recriado a cada render; as partes dele é que importam
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entradas, filtrando, filtros.busca, filtros.responsavel, filtros.prioridade, filtros.empresa, filtros.atrasados, me?.id],
  )
  const responsaveis = useMemo(() => responsaveisDoQuadro(entradas), [entradas])
  const empresas = useMemo(() => empresasDoQuadro(entradas), [entradas])

  const { visiveisPorColuna, totalPorColuna } = useMemo(() => {
    const porColuna = (lista: CartaoTipo[]) => {
      const mapa = new Map<string, CartaoTipo[]>()
      for (const c of lista) {
        const doGrupo = mapa.get(c.column) ?? []
        doGrupo.push(c)
        mapa.set(c.column, doGrupo)
      }
      return mapa
    }
    const totais = new Map<string, number>()
    for (const [chave, lista] of porColuna(entradas)) totais.set(chave, lista.length)
    return { visiveisPorColuna: porColuna(visiveis), totalPorColuna: totais }
  }, [entradas, visiveis])

  // "Agora" do prazo: o instante do último fetch (determinístico, vem do
  // cache), não Date.now() no render — mesma decisão da fila de chamados.
  const agoraMs = dataUpdatedAt || 0

  const sensors = useSensors(
    // Mouse: distância mínima antes de virar arraste, senão todo clique no
    // cartão (o que abre o chamado) seria um drag de zero pixels.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Toque: segurar para pegar. Com o PointerSensor de antes o cartão
    // precisava de `touch-action: none`, e no celular deslizar o dedo sobre
    // um cartão não rolava nem a coluna nem o quadro.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { keyboardCodes: TECLAS_DO_QUADRO, coordinateGetter: coordenadasPorColuna }),
  )

  const cartaoArrastando = entradas.find((c) => c.ticket === arrastandoId) ?? null

  function nomeDoCartao(ticketId: number): string {
    return entradas.find((c) => c.ticket === ticketId)?.ticket_reference ?? `#${ticketId}`
  }

  function nomeDaColuna(key: string): string {
    return quadro?.columns.find((c) => c.key === key)?.name ?? key
  }

  function onDragStart(e: DragStartEvent) {
    arrastePorTeclado.current = e.activatorEvent instanceof KeyboardEvent
    setArrastandoId(idDoTicket(e.active.id))
  }

  function focarCartao(ticketId: number) {
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-ticket="${ticketId}"]`)
      if (el && (document.activeElement == null || document.activeElement === document.body)) el.focus()
    })
  }

  async function onDragEnd(e: DragEndEvent) {
    setArrastandoId(null)
    const { active, over } = e
    const porTeclado = arrastePorTeclado.current
    arrastePorTeclado.current = false
    if (!over || quadroAtivo == null) return

    const ticketId = idDoTicket(active.id)
    const cartao = entradas.find((c) => c.ticket === ticketId)
    if (!cartao || cartao.column === over.id) return // soltou na mesma coluna: nada a fazer

    const coluna = quadro?.columns.find((c) => c.key === over.id)
    if (!coluna) return

    setAvisoErro(null)
    try {
      await place.mutateAsync({
        boardId: quadroAtivo,
        ticket_id: ticketId,
        ...(coluna.kind === 'lane' ? { lane_id: coluna.lane! } : { stage_id: coluna.stage! }),
        // a coluna de conclusão NÃO move otimista: ela sempre responde 409
        // pedindo as datas, e o cartão iria e voltaria na frente da pessoa
        colunaDestino: coluna.concludes ? undefined : coluna.key,
      })
      if (porTeclado) focarCartao(ticketId)
    } catch (err) {
      // 409 + close_dialog_required: a coluna de destino fecha o chamado, e
      // fechar exige as datas de solução (D4) — o quadro nunca fecha
      // sozinho, então abre o formulário em vez de aceitar o arraste.
      if (err instanceof ApiError && err.status === 409 && err.code === 'close_dialog_required') {
        setParaFechar(cartao)
        return
      }
      // qualquer outra recusa (equipe interna, coluna de outro quadro etc.)
      // — o card volta pro lugar, e agora com o motivo à vista
      setAvisoErro(mensagemDoErro(err, 'Não foi possível mover o ticket.'))
      if (porTeclado) focarCartao(ticketId)
    }
  }

  async function confirmarFechamento(dados: { resolution_started_at: string; resolution_ended_at: string; note: string }) {
    if (!paraFechar) return
    await fecharTicket.mutateAsync({ ticketId: paraFechar.ticket, ...dados })
    setParaFechar(null)
  }

  function criarColuna() {
    if (!nomeNovaColuna.trim()) return
    setAvisoErro(null)
    criarLane.mutate(nomeNovaColuna.trim(), {
      onSuccess: () => {
        setNomeNovaColuna('')
        setNovaColuna(false)
      },
      onError: (err) => setAvisoErro(mensagemDoErro(err, 'Não foi possível criar a coluna.')),
    })
  }

  async function salvarLimite(coluna: ColunaTipo, limite: number | null) {
    if (quadroAtivo == null) return
    setAvisoErro(null)
    try {
      await definirLimite.mutateAsync({ boardId: quadroAtivo, coluna: coluna.key, wip_limit: limite })
    } catch (err) {
      setAvisoErro(mensagemDoErro(err, 'Não foi possível salvar o limite da coluna.'))
      throw err
    }
  }

  if (carregandoQuadros || (quadroAtivo != null && isLoading)) {
    return <EsqueletoQuadro />
  }

  if (!carregandoQuadros && quadros?.length === 0) {
    return (
      <div className="kb-pagina kb-pagina--estado">
        <i className="ti ti-layout-grid" aria-hidden="true" />
        <h1 className="kb-estado__titulo">Nenhum quadro ainda</h1>
        {me?.is_admin ? (
          <>
            <p>Crie o primeiro quadro. Ele mostra os tickets não resolvidos por status.</p>
            <form
              className="kb-estado__form"
              onSubmit={(e) => {
                e.preventDefault()
                const nome = nomeNovoQuadro.trim()
                if (!nome) return
                criarQuadro.mutate(nome, {
                  onError: (err) => setAvisoErro(mensagemDoErro(err, 'Não foi possível criar o quadro.')),
                })
              }}
            >
              <input
                type="text"
                aria-label="Nome do quadro"
                placeholder="Nome do quadro"
                value={nomeNovoQuadro}
                onChange={(e) => setNomeNovoQuadro(e.target.value)}
              />
              <button type="submit" className="kb-botao kb-botao--primario" disabled={criarQuadro.isPending || !nomeNovoQuadro.trim()}>
                Criar quadro
              </button>
            </form>
            {avisoErro && (
              <p className="kb-estado__erro" role="alert">
                {avisoErro}
              </p>
            )}
          </>
        ) : (
          <p>Peça a um administrador para criar o primeiro quadro.</p>
        )}
      </div>
    )
  }

  if (isError || !quadro) {
    return (
      <div className="kb-pagina kb-pagina--estado" role="alert">
        <i className="ti ti-alert-triangle" aria-hidden="true" />
        <h1 className="kb-estado__titulo">Não foi possível carregar o quadro</h1>
        <p>Verifique a conexão e tente de novo.</p>
        <button type="button" className="kb-botao" onClick={() => refetch()}>
          <i className="ti ti-refresh" aria-hidden="true" />
          Tentar de novo
        </button>
      </div>
    )
  }

  return (
    <div className="kb-pagina">
      <header className="kb-pagina__header">
        <div className="kb-pagina__titulo-bloco">
          <h1 className="kb-pagina__titulo">Quadro</h1>
          <p className="kb-pagina__subtitulo">
            {entradas.length === 1 ? '1 ticket' : `${entradas.length} tickets`} no quadro. Arraste um cartão para mudar o status.
          </p>
        </div>
        {quadros && quadros.length > 1 && (
          <div className="kb-filtro kb-filtro--quadro">
            <i className="ti ti-layout-grid" aria-hidden="true" />
            <span className="kb-filtro__texto" aria-hidden="true">
              {quadros.find((q) => q.id === quadroAtivo)?.name ?? 'Quadro'}
            </span>
            <i className="ti ti-chevron-down kb-filtro__seta" aria-hidden="true" />
            <select value={quadroAtivo ?? ''} onChange={(e) => setBoardId(Number(e.target.value))} aria-label="Quadro">
              {quadros.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </header>

      <BarraDeFiltros
        filtros={filtros}
        onMudar={mudarFiltros}
        onLimpar={limparFiltros}
        responsaveis={responsaveis}
        empresas={empresas}
        ativo={filtrando}
        visiveis={visiveis.length}
        total={entradas.length}
      />

      {avisoErro && (
        <div className="kb-aviso-erro" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>{avisoErro}</span>
          <button type="button" onClick={() => setAvisoErro(null)} aria-label="Dispensar">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setArrastandoId(null)
          arrastePorTeclado.current = false
        }}
        accessibility={{
          announcements: anuncios(nomeDoCartao, nomeDaColuna),
          screenReaderInstructions: INSTRUCOES,
        }}
      >
        <div className="kb-pagina__colunas">
          {quadro.columns.map((coluna) => (
            <Coluna
              key={coluna.key}
              coluna={coluna}
              cartoes={visiveisPorColuna.get(coluna.key) ?? []}
              total={totalPorColuna.get(coluna.key) ?? 0}
              filtrando={filtrando}
              agoraMs={agoraMs}
              statusDe={statusDe}
              onAbrirTicket={(id) => navigate(`/tickets/${id}`)}
              onDefinirPrazo={(ticketId, iso) =>
                quadroAtivo != null &&
                definirPrazo.mutate(
                  { boardId: quadroAtivo, ticketId, due_at: iso },
                  { onError: (err) => setAvisoErro(mensagemDoErro(err, 'Não foi possível definir o prazo.')) },
                )
              }
              onDefinirLimite={salvarLimite}
              salvandoLimite={definirLimite.isPending}
              onApagarLane={(laneId) => {
                if (window.confirm('Apagar esta coluna? Os tickets fixados nela voltam para a coluna do status. Nenhum é apagado.')) {
                  apagarLane.mutate(laneId, {
                    onError: (err) => setAvisoErro(mensagemDoErro(err, 'Não foi possível apagar a coluna.')),
                  })
                }
              }}
            />
          ))}

          <div className="kb-coluna kb-coluna--nova">
            {novaColuna ? (
              <form
                className="kb-coluna__form-nova"
                onSubmit={(e) => {
                  e.preventDefault()
                  criarColuna()
                }}
              >
                <label htmlFor="kb-nova-coluna">Nova coluna de organização</label>
                <input
                  id="kb-nova-coluna"
                  autoFocus
                  type="text"
                  placeholder="Ex.: Depende do gestor"
                  value={nomeNovaColuna}
                  onChange={(e) => setNomeNovaColuna(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setNovaColuna(false)
                  }}
                  aria-describedby="kb-nova-coluna-ajuda"
                />
                <p id="kb-nova-coluna-ajuda" className="kb-coluna__form-ajuda">
                  Só agrupa os cartões. O status do ticket não muda.
                </p>
                <div className="kb-coluna__form-nova-acoes">
                  <button type="submit" className="kb-botao kb-botao--primario" disabled={criarLane.isPending || !nomeNovaColuna.trim()}>
                    Criar coluna
                  </button>
                  <button type="button" className="kb-botao" onClick={() => setNovaColuna(false)}>
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="kb-coluna__nova-botao" onClick={() => setNovaColuna(true)}>
                <i className="ti ti-plus" aria-hidden="true" />
                Nova coluna
              </button>
            )}
          </div>
        </div>

        <DragOverlay dropAnimation={semAnimacao ? null : undefined}>
          {cartaoArrastando && (
            <div
              className="kb-cartao kb-cartao--flutuando"
              style={{ '--kb-cor': statusDe(cartaoArrastando).cor } as CSSProperties}
            >
              <ConteudoDoCartao cartao={cartaoArrastando} agoraMs={agoraMs} status={statusDe(cartaoArrastando)} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ModalFecharTicket
        // Força remontagem a cada ticket diferente: o modal só monta de
        // verdade quando `paraFechar` já existe (fica `null` a maior parte
        // do tempo), e o `useState` de inicialização preguiçosa lá dentro
        // (data de início = criação do ticket) só roda no PRIMEIRO mount —
        // sem a `key` mudando, o segundo fechamento reaproveitaria o estado
        // do primeiro ticket, ou pior, o estado vazio de quando `cartao`
        // ainda era `null`.
        key={paraFechar?.ticket}
        cartao={paraFechar}
        enviando={fecharTicket.isPending}
        onFechar={confirmarFechamento}
        onCancelar={() => setParaFechar(null)}
      />
    </div>
  )
}
