import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Modal } from '@/cvz/components'
import { useAgentes } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { usePrefs } from '@/stores/prefs'
import { CONSULTA_TELA_PEQUENA, useConsultaDeMidia } from '../shell/useConsultaDeMidia'
import { mensagemDeErro } from './detalhe/linhaDoTempo'
import { BarraFiltros } from './BarraFiltros'
import { BarraLote } from './BarraLote'
import { CartoesTickets } from './CartoesTickets'
import {
  useAcoesEmLote,
  useFacetas,
  useStatusDoQuadro,
  useVisoesPessoais,
  type DadosEncerrarLote,
  type ResultadoLote,
} from './dados'
import type { MudancaDeFiltro } from './dimensoes'
import { EsqueletoLista } from './EsqueletoLista'
import {
  contarFiltros,
  filtrosParaApi,
  filtrosVazios,
  jsonParaRecorte,
  lerFiltros,
  recorteParaJson,
  recortesIguais,
} from './filtros'
import { FiltrosMobile } from './FiltrosMobile'
import { atualizadoHa, totalDeTickets } from './format'
import { resumirLote, type AcaoDeLote, type ResumoDoLote } from './lote'
import { ModalEncerrarLote } from './ModalEncerrarLote'
import { ModalSalvarVisao } from './ModalSalvarVisao'
import { ModalVisoes } from './ModalVisoes'
import { TicketsTable } from './TicketsTable'
import type { ColunaOrdenavel, ParamsListagem, Prioridade, VisaoPessoal } from './tipos'
import { useTecladoDaLista } from './useTecladoDaLista'
import { useTicketsList } from './useTicketsList'
import { ListaDeVisoes, ViewsPanel } from './ViewsPanel'
import { VISAO_INICIAL, visaoDoSistema, type Visualizacao } from './visoes'
import './lista.scss'

const LIMITE = 25
const ORDEM_PADRAO = '-criado'
/** Abaixo disto a coluna principal troca a tabela por cartões. Acima, a
 *  tabela vai escondendo colunas pela largura da coluna (lista.scss,
 *  `@container fila`); a mais enxuta (assunto, responsável, prioridade,
 *  status, SLA) precisa de uns 800px para o assunto não virar reticências. */
const LARGURA_MINIMA_TABELA = 800

/** O vazio de cada visão do sistema diz o que ele SIGNIFICA — "nada
 *  aguardando você" é uma boa notícia, não uma tela quebrada. */
const VAZIO_DA_VISAO: Record<string, string> = {
  'meus-nao-resolvidos': 'Você não tem tickets em aberto.',
  'aguardando-voce': 'Nada aguardando você agora.',
  'mencionam-voce': 'Ninguém mencionou você em tickets abertos.',
  prioritario: 'Nenhum ticket urgente em aberto.',
  'sem-atendimento': 'Todos os tickets abertos já tiveram uma primeira resposta.',
  'nao-atribuidos': 'Todos os tickets abertos têm responsável.',
}

/** Largura do conteúdo de um elemento, acompanhando redimensionamento.
 *  0 onde não há `ResizeObserver` (jsdom): a tela fica no modo largo. */
function useLarguraDoElemento(ref: RefObject<HTMLElement | null>): number {
  const [largura, setLargura] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada) setLargura(entrada.contentRect.width)
    })
    observador.observe(el)
    return () => observador.disconnect()
  }, [ref])
  return largura
}

/** "Agora" que anda sozinho a cada 30s — só para a dica "atualizado há N
 *  min" do botão de atualizar não congelar enquanto a tela fica aberta. */
function useAgoraPeriodico(): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  return agora
}

export function PaginaListaTickets() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const densidade = usePrefs((s) => s.densidade)
  const setDensidade = usePrefs((s) => s.setDensidade)
  const telaPequena = useConsultaDeMidia(CONSULTA_TELA_PEQUENA)
  const refMain = useRef<HTMLElement>(null)
  const larguraMain = useLarguraDoElemento(refMain)
  const modoCartoes = telaPequena || (larguraMain > 0 && larguraMain < LARGURA_MINIMA_TABELA)

  // Visão, filtros, busca, ordem e página vivem na URL (item 18): o link é
  // compartilhável, e abrir um chamado e voltar devolve a pessoa exatamente
  // ao recorte em que estava.
  const [searchParams, setSearchParams] = useSearchParams()
  const visaoSistema = visaoDoSistema(searchParams.get('view')) ?? visaoDoSistema(VISAO_INICIAL)!
  const ordering = searchParams.get('ordering') || ORDEM_PADRAO
  const offsetParam = Number(searchParams.get('offset') ?? 0)
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0
  // `q` é o termo já DEBOUNCED (o que de fato foi pedido ao servidor) — o
  // valor bruto de cada tecla mora só no estado local `busca`, abaixo.
  const q = searchParams.get('q') ?? ''
  const filtros = lerFiltros(searchParams)
  const pessoalId = Number(searchParams.get('pessoal')) || null

  const { data: visoesPessoais } = useVisoesPessoais()
  const visaoPessoal = (pessoalId && visoesPessoais?.find((v) => v.id === pessoalId)) || null

  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [resumoDoLote, setResumoDoLote] = useState<ResumoDoLote | null>(null)
  const [dialogo, setDialogo] = useState<
    'salvar' | 'gerenciar' | 'encerrar' | 'visoes' | 'filtros' | null
  >(null)

  const permissoes = me?.permissions ?? []
  const podeLote = permissoes.includes('ticket.bulk_actions')
  const podeEncerrar = podeLote && permissoes.includes('ticket.close')
  const { data: agentes } = useAgentes()
  const { data: statusDoQuadro } = useStatusDoQuadro(podeLote && selecionados.size > 0)
  const { atribuir, mudarPrioridade, mudarStatus, encerrar } = useAcoesEmLote()
  const lotePendente =
    atribuir.isPending || mudarPrioridade.isPending || mudarStatus.isPending || encerrar.isPending

  /** Aplica mudanças na URL preservando as demais chaves. `replace: true`
   *  porque cada clique aqui refina o mesmo recorte — sem isso, o "voltar"
   *  desfaria filtro por filtro em vez de sair da tela. Toda troca volta à
   *  página 1, a menos que `manterOffset` diga o contrário. */
  const definir = useCallback(
    (mudancas: Record<string, string | undefined>, opcoes: { manterOffset?: boolean } = {}) => {
      setSearchParams(
        (atual) => {
          const novo = new URLSearchParams(atual)
          for (const [k, v] of Object.entries(mudancas)) {
            if (v) novo.set(k, v)
            else novo.delete(k)
          }
          if (!opcoes.manterOffset) novo.delete('offset')
          return novo
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  /** Toda troca de RECORTE (visão, filtro, busca, ordem, página) zera a
   *  seleção: agir em lote sobre linha que saiu da tela é ação às cegas. O
   *  resumo da última ação vai junto, porque fala de linhas que sumiram. */
  function trocarRecorte(
    mudancas: Record<string, string | undefined>,
    opcoes?: { manterOffset?: boolean },
  ) {
    definir(mudancas, opcoes)
    setSelecionados(new Set())
    setResumoDoLote(null)
  }

  // Busca bruta (cada tecla) fica só no estado local; 300ms parado de
  // digitar antes de ir para a URL (e daí para o servidor).
  const [busca, setBusca] = useState(q)
  // `q` que muda por FORA da digitação (abrir uma visão pessoal com busca,
  // voltar/avançar do navegador) precisa chegar ao campo — senão o efeito
  // abaixo empurraria o texto velho de volta para a URL.
  const [qVisto, setQVisto] = useState(q)
  if (qVisto !== q) {
    setQVisto(q)
    if (busca.trim() !== q) setBusca(q)
  }
  useEffect(() => {
    const alvo = busca.trim()
    if (alvo === q) return
    const t = setTimeout(() => trocarRecorte({ q: alvo || undefined }), 300)
    return () => clearTimeout(t)
    // `trocarRecorte` só encapsula `definir` (estável) + setState (estável).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, q])

  // "Tickets prioritários" é `nao-resolvidos` + urgente; um filtro de
  // prioridade escolhido na barra manda mais que o implícito da visão.
  const consulta: ParamsListagem = {
    ...filtrosParaApi(filtros),
    view: visaoSistema.view,
    priority: filtros.priority ?? visaoSistema.prioridade,
    q,
    ordering,
    limit: LIMITE,
    offset,
  }

  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } =
    useTicketsList(consulta)
  const { data: facetas } = useFacetas(consulta, !telaPequena || dialogo === 'filtros')

  // Referência de "agora" para o tempo de espera: o instante do último fetch
  // (determinístico, vindo do cache) — não Date.now() em render.
  const agoraMs = dataUpdatedAt || 0
  const relogio = useAgoraPeriodico()

  const linhas = data?.results ?? []
  const total = data?.count ?? 0
  const inicio = total === 0 ? 0 : offset + 1
  const fim = Math.min(offset + LIMITE, total)
  const termoBuscaAplicado = q.length >= 3 ? q : ''
  const nFiltros = contarFiltros(filtros)

  // O recorte da tela como uma visão pessoal o guardaria. `view` e
  // `priority` já resolvidos (a pseudo-visão "prioritários" não existe no
  // servidor); ordem padrão fica de fora, como numa visão recém-criada.
  const recorteAtual = recorteParaJson({
    view: visaoSistema.view,
    q: q || undefined,
    ordering: ordering === ORDEM_PADRAO ? undefined : ordering,
    filtros: { ...filtros, priority: consulta.priority },
  })
  const recorteDaPessoal = visaoPessoal
    ? recorteParaJson({
        ...jsonParaRecorte(visaoPessoal.filters),
        view: visaoPessoal.filters.view || 'todos',
      })
    : null
  const pessoalAlterada =
    recorteDaPessoal != null && !recortesIguais(recorteAtual, recorteDaPessoal)
  const podeSalvar = (nFiltros > 0 || Boolean(q)) && (!visaoPessoal || pessoalAlterada)

  const titulo = visaoPessoal?.name ?? visaoSistema.label
  // Nome do solicitante filtrado: com `?solicitante=` toda linha é dele, então
  // a primeira já diz quem é — sem uma chamada só para o nome.
  const rotuloSolicitante = filtros.solicitante
    ? (linhas[0]?.requester_display ?? 'selecionado')
    : undefined

  // ---------------------------------------------------------------- seleção
  function alternarSelecao(id: number) {
    setSelecionados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function selecionarTodos(marcar: boolean) {
    setSelecionados(marcar ? new Set(linhas.map((l) => l.id)) : new Set())
  }

  // ---------------------------------------------------------------- teclado
  const refLista = useRef<HTMLDivElement>(null)
  const { indiceFocado, setIndiceFocado } = useTecladoDaLista({
    refContainer: refLista,
    quantidade: linhas.length,
    onAbrir: (i) => {
      const t = linhas[i]
      if (t) navigate(`/chamados/${t.id}`)
    },
    onAlternar: (i) => {
      const t = linhas[i]
      if (t) alternarSelecao(t.id)
    },
  })

  // ---------------------------------------------------------------- visões
  function selecionarVisao(v: Visualizacao) {
    // Visão do sistema é um ponto de partida limpo: os filtros da visão
    // anterior não vêm junto (senão "Não atribuídos" herdaria o "Equipe:
    // Financeiro" de outra gaveta sem ninguém perceber). Busca e ordem ficam.
    trocarRecorte({ view: v.id, pessoal: undefined, ...filtrosVazios() })
    setDialogo(null)
  }

  function selecionarPessoal(v: VisaoPessoal) {
    const r = jsonParaRecorte(v.filters)
    trocarRecorte({
      ...filtrosVazios(),
      ...r.filtros,
      pessoal: String(v.id),
      view: r.view || 'todos',
      q: r.q,
      ordering: r.ordering,
    })
    setDialogo(null)
  }

  function mudarFiltro(m: MudancaDeFiltro) {
    trocarRecorte(m)
  }

  function limparFiltros() {
    trocarRecorte(filtrosVazios())
  }

  function limparBusca() {
    setBusca('')
    trocarRecorte({ q: undefined })
  }

  // ---------------------------------------------------------------- lote
  // Resposta parcial (`updated`/`failed`): quem mudou sai da seleção, quem
  // foi ignorado FICA selecionado — é exatamente o grupo que a pessoa vai
  // querer olhar ou tentar de outro jeito.
  function tratarResultado(res: ResultadoLote, acao: AcaoDeLote) {
    setResumoDoLote(resumirLote(res, acao))
    const naTela = new Set(linhas.map((l) => l.id))
    setSelecionados(new Set(res.failed.map((f) => f.id).filter((id) => naTela.has(id))))
  }

  function tratarErro(err: unknown, padrao: string) {
    setResumoDoLote({ tipo: 'falha', texto: mensagemDeErro(err, padrao) })
  }

  const idsSelecionados = () => Array.from(selecionados)

  function atribuirEmLote(assigneeId: number | null) {
    setResumoDoLote(null)
    atribuir.mutate(
      { ticket_ids: idsSelecionados(), assignee_id: assigneeId },
      {
        onSuccess: (res) => tratarResultado(res, 'atribuir'),
        onError: (err) => tratarErro(err, 'Não foi possível atribuir os tickets.'),
      },
    )
  }

  function mudarPrioridadeEmLote(priority: Prioridade) {
    setResumoDoLote(null)
    mudarPrioridade.mutate(
      { ticket_ids: idsSelecionados(), priority },
      {
        onSuccess: (res) => tratarResultado(res, 'prioridade'),
        onError: (err) => tratarErro(err, 'Não foi possível mudar a prioridade.'),
      },
    )
  }

  function mudarStatusEmLote(stageId: number) {
    setResumoDoLote(null)
    mudarStatus.mutate(
      { ticket_ids: idsSelecionados(), stage_id: stageId },
      {
        onSuccess: (res) => tratarResultado(res, 'status'),
        onError: (err) => tratarErro(err, 'Não foi possível mudar o status.'),
      },
    )
  }

  function encerrarEmLote(dados: DadosEncerrarLote) {
    setResumoDoLote(null)
    encerrar.mutate(
      { ticket_ids: idsSelecionados(), ...dados },
      {
        onSuccess: (res) => {
          setDialogo(null)
          tratarResultado(res, 'encerrar')
        },
        onError: (err) => {
          setDialogo(null)
          tratarErro(err, 'Não foi possível encerrar os tickets.')
        },
      },
    )
  }

  // Abertura do mais novo entre os selecionados desta página — o piso do
  // "início da solução" no encerramento em lote.
  const criadoMaisRecente = linhas
    .filter((l) => selecionados.has(l.id))
    .reduce((maior, l) => (l.created_at > maior ? l.created_at : maior), '')

  function ordenar(chave: ColunaOrdenavel) {
    trocarRecorte({ ordering: ordering === chave ? `-${chave}` : chave })
  }

  function irParaOffset(novoOffset: number) {
    trocarRecorte(
      { offset: novoOffset > 0 ? String(novoOffset) : undefined },
      { manterOffset: true },
    )
  }

  // ---------------------------------------------------------------- render
  const propsVisoes = {
    ativa: visaoSistema.id,
    ativaPessoal: visaoPessoal?.id ?? null,
    onSelecionar: selecionarVisao,
    onSelecionarPessoal: selecionarPessoal,
    onPersonalizar: () => setDialogo('gerenciar'),
  }

  const botaoSalvar = podeSalvar && (
    <button
      type="button"
      className="lista-tickets__botao lista-tickets__botao--secundario"
      onClick={() => setDialogo('salvar')}
    >
      {pessoalAlterada ? 'Salvar alterações' : 'Salvar visão'}
    </button>
  )

  // A busca mora na linha dos filtros (é mais um recorte), não no
  // cabeçalho: lá ela disputava espaço com o título e empurrava "Novo
  // ticket" para uma segunda linha.
  const campoBusca = (
    <label className="lista-tickets__search">
      <i className="ti ti-search" aria-hidden="true" />
      {/* O aria-label diz o ESCOPO: `_busca_q` (apps/tickets/views.py) casa
          só referência, assunto e número do pedido. */}
      <input
        type="search"
        placeholder="Pesquisar"
        aria-label="Buscar por referência, assunto ou número do pedido"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
      />
    </label>
  )

  function corpo() {
    if (isError) {
      return (
        <div className="lista-tickets__estado lista-tickets__estado--erro" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <p>
            Não foi possível carregar os tickets
            {error instanceof ApiError ? ` (erro ${error.status})` : ''}.
          </p>
          <button
            type="button"
            className="lista-tickets__botao lista-tickets__botao--primario"
            onClick={() => refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )
    }
    if (isLoading) return <EsqueletoLista cartoes={modoCartoes} />
    if (linhas.length === 0) {
      // Três vazios diferentes, cada um com a saída que resolve o dele:
      // busca sem resultado, filtro apertado demais, visão realmente vazia.
      return (
        <div className="lista-tickets__estado">
          {termoBuscaAplicado ? (
            <>
              <i className="ti ti-search" aria-hidden="true" />
              <p>Nenhum resultado para "{termoBuscaAplicado}".</p>
              <button
                type="button"
                className="lista-tickets__botao lista-tickets__botao--secundario"
                onClick={limparBusca}
              >
                Limpar busca
              </button>
            </>
          ) : nFiltros > 0 ? (
            <>
              <i className="ti ti-filter" aria-hidden="true" />
              <p>Nenhum ticket com esses filtros.</p>
              <button
                type="button"
                className="lista-tickets__botao lista-tickets__botao--secundario"
                onClick={limparFiltros}
              >
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              <i className="ti ti-inbox" aria-hidden="true" />
              <p>
                {(!visaoPessoal && VAZIO_DA_VISAO[visaoSistema.id]) ||
                  'Nenhum ticket nesta visualização.'}
              </p>
              <button
                type="button"
                className="lista-tickets__botao lista-tickets__botao--secundario"
                onClick={() => navigate('/chamados/novo')}
              >
                <i className="ti ti-plus" aria-hidden="true" />
                Novo ticket
              </button>
            </>
          )}
        </div>
      )
    }
    return (
      <div ref={refLista} className="lista-tickets__lista">
        {modoCartoes ? (
          <CartoesTickets
            linhas={linhas}
            selecionados={selecionados}
            onSelecionar={alternarSelecao}
            onAbrir={(id) => navigate(`/chamados/${id}`)}
            indiceFocado={indiceFocado}
            onFocarLinha={setIndiceFocado}
          />
        ) : (
          <TicketsTable
            linhas={linhas}
            ordering={ordering}
            onOrdenar={ordenar}
            selecionados={selecionados}
            onSelecionar={alternarSelecao}
            onSelecionarTodos={selecionarTodos}
            onAbrir={(id) => navigate(`/chamados/${id}`)}
            agoraMs={agoraMs}
            indiceFocado={indiceFocado}
            onFocarLinha={setIndiceFocado}
          />
        )}
      </div>
    )
  }

  return (
    <div className="lista-tickets">
      {!telaPequena && <ViewsPanel {...propsVisoes} />}

      <section ref={refMain} className="lista-tickets__main" aria-labelledby="lista-tickets-titulo">
        {/* ---------- cabeçalho ---------- */}
        <header className="lista-tickets__header">
          <div className="lista-tickets__titulo-bloco">
            <h1 id="lista-tickets-titulo" className="lista-tickets__titulo">
              {titulo}
            </h1>
            <div className="lista-tickets__subtitulo">
              {/* Só o total: "exibindo de 1 até 8 de um total de 8
                  registro(s)" repetia a paginação, que já diz o intervalo
                  quando há mais de uma página. */}
              <span aria-live="polite">{isLoading ? 'Carregando…' : totalDeTickets(total)}</span>
              {pessoalAlterada && <span className="lista-tickets__alterada">Visão alterada</span>}
              <button
                type="button"
                className={'lista-tickets__refresh' + (isFetching ? ' is-loading' : '')}
                onClick={() => refetch()}
                aria-label={
                  agoraMs > 0
                    ? `Atualizar lista, ${atualizadoHa(agoraMs, relogio)}`
                    : 'Atualizar lista'
                }
                title={agoraMs > 0 ? `Atualizar (${atualizadoHa(agoraMs, relogio)})` : 'Atualizar'}
              >
                <i className="ti ti-refresh" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* No celular "Novo ticket" vai para a barra de visão/filtros, como
              ícone: sozinho numa linha ele gastava uma faixa inteira da tela. */}
          {!telaPequena && (
            <div className="lista-tickets__acoes">
              {!modoCartoes && (
                // Densidade (stores/prefs.ts): a mesma preferência do DataTable
                // do cvz. Some nos cartões, que não têm linha para espaçar.
                <div
                  className="lista-tickets__densidade"
                  role="group"
                  aria-label="Densidade da tabela"
                >
                  <button
                    type="button"
                    className="lista-tickets__densidade-btn"
                    aria-label="Tabela padrão"
                    title="Tabela padrão"
                    aria-pressed={densidade === 'compacta'}
                    onClick={() => setDensidade('compacta')}
                  >
                    <i className="ti ti-baseline-density-small" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="lista-tickets__densidade-btn"
                    aria-label="Tabela confortável (linhas mais espaçadas)"
                    title="Tabela confortável"
                    aria-pressed={densidade === 'confortavel'}
                    onClick={() => setDensidade('confortavel')}
                  >
                    <i className="ti ti-baseline-density-large" aria-hidden="true" />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="lista-tickets__botao lista-tickets__botao--primario"
                onClick={() => navigate('/chamados/novo')}
              >
                <i className="ti ti-plus" aria-hidden="true" />
                Novo ticket
              </button>
            </div>
          )}
        </header>

        {/* ---------- visões e filtros ---------- */}
        {telaPequena && campoBusca}
        {telaPequena ? (
          <div className="lista-tickets__barra-mobile">
            <button
              type="button"
              className="lista-tickets__seletor-visao"
              aria-haspopup="dialog"
              onClick={() => setDialogo('visoes')}
            >
              <span>{titulo}</span>
              <i className="ti ti-chevron-down" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={'lista-tickets__botao-filtros' + (nFiltros > 0 ? ' is-ativo' : '')}
              aria-haspopup="dialog"
              onClick={() => setDialogo('filtros')}
            >
              <i className="ti ti-adjustments-horizontal" aria-hidden="true" />
              Filtros
              {nFiltros > 0 && <span className="lista-tickets__contador">{nFiltros}</span>}
            </button>
            <button
              type="button"
              className="lista-tickets__botao lista-tickets__botao--primario lista-tickets__novo-icone"
              aria-label="Novo ticket"
              title="Novo ticket"
              onClick={() => navigate('/chamados/novo')}
            >
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <BarraFiltros
            inicio={campoBusca}
            rotuloSolicitante={rotuloSolicitante}
            filtros={filtros}
            facetas={facetas}
            meuId={me?.id}
            onMudar={mudarFiltro}
            onLimparTudo={limparFiltros}
            acoes={botaoSalvar || undefined}
          />
        )}
        {telaPequena && (nFiltros > 0 || botaoSalvar) && (
          <div className="lista-tickets__filtros-resumo">
            {nFiltros > 0 && (
              <button type="button" className="barra-filtros__limpar" onClick={limparFiltros}>
                Limpar filtros
              </button>
            )}
            {botaoSalvar}
          </div>
        )}

        {busca.length > 0 && busca.length < 3 && (
          <p className="lista-tickets__dica">Digite pelo menos 3 caracteres para buscar.</p>
        )}

        {/* ---------- seleção em lote ---------- */}
        {selecionados.size > 0 && (
          <BarraLote
            quantidade={selecionados.size}
            podeLote={podeLote}
            podeEncerrar={podeEncerrar}
            agentes={agentes ?? []}
            status={statusDoQuadro ?? []}
            pendente={lotePendente}
            onAtribuir={atribuirEmLote}
            onPrioridade={mudarPrioridadeEmLote}
            onStatus={mudarStatusEmLote}
            onEncerrar={() => setDialogo('encerrar')}
            onLimpar={() => {
              setSelecionados(new Set())
              setResumoDoLote(null)
            }}
          />
        )}

        {/* `alert` só quando NADA mudou; resultado com algum sucesso é
            `status` (não interrompe o leitor de tela). */}
        {resumoDoLote && (
          <div
            className={`lista-tickets__aviso lista-tickets__aviso--${resumoDoLote.tipo}`}
            role={resumoDoLote.tipo === 'falha' ? 'alert' : 'status'}
          >
            <i
              className={
                resumoDoLote.tipo === 'sucesso'
                  ? 'ti ti-circle-check'
                  : resumoDoLote.tipo === 'parcial'
                    ? 'ti ti-info-circle'
                    : 'ti ti-alert-triangle'
              }
              aria-hidden="true"
            />
            <span>{resumoDoLote.texto}</span>
            <button type="button" onClick={() => setResumoDoLote(null)} aria-label="Dispensar">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ---------- corpo ---------- */}
        {corpo()}

        {/* ---------- paginação ---------- */}
        {total > LIMITE && (
          <footer className="lista-tickets__paginacao">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => irParaOffset(Math.max(0, offset - LIMITE))}
            >
              <i className="ti ti-chevron-left" aria-hidden="true" />
              Anterior
            </button>
            <span>
              {inicio}–{fim} de {total}
            </span>
            <button
              type="button"
              disabled={fim >= total}
              onClick={() => irParaOffset(offset + LIMITE)}
            >
              Próxima
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          </footer>
        )}
      </section>

      {/* ---------- diálogos ---------- */}
      {dialogo === 'salvar' && (
        <ModalSalvarVisao
          recorte={recorteAtual}
          visaoAtiva={pessoalAlterada ? visaoPessoal : null}
          onFechar={() => setDialogo(null)}
          onSalva={(v) => {
            setDialogo(null)
            definir({ pessoal: String(v.id) }, { manterOffset: true })
          }}
        />
      )}
      {dialogo === 'gerenciar' && (
        <ModalVisoes
          onFechar={() => setDialogo(null)}
          onApagada={(id) => {
            if (id === pessoalId) definir({ pessoal: undefined }, { manterOffset: true })
          }}
        />
      )}
      {dialogo === 'encerrar' && criadoMaisRecente && (
        <ModalEncerrarLote
          quantidade={selecionados.size}
          criadoMaisRecente={criadoMaisRecente}
          enviando={encerrar.isPending}
          onEncerrar={encerrarEmLote}
          onCancelar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'visoes' && (
        <Modal open onClose={() => setDialogo(null)} title="Visualizações" size="sm">
          <FolhaDeVisoes {...propsVisoes} />
        </Modal>
      )}
      {dialogo === 'filtros' && (
        <Modal
          open
          onClose={() => setDialogo(null)}
          title="Filtros"
          size="sm"
          footer={
            <>
              {nFiltros > 0 && (
                <button
                  type="button"
                  className="lista-tickets__botao lista-tickets__botao--fantasma"
                  onClick={limparFiltros}
                >
                  Limpar filtros
                </button>
              )}
              <button
                type="button"
                className="lista-tickets__botao lista-tickets__botao--primario"
                onClick={() => setDialogo(null)}
              >
                {isFetching ? 'Ver tickets' : `Ver ${totalDeTickets(total)}`}
              </button>
            </>
          }
        >
          <FiltrosMobile
            rotuloSolicitante={rotuloSolicitante}
            filtros={filtros}
            facetas={facetas}
            meuId={me?.id}
            onMudar={mudarFiltro}
          />
        </Modal>
      )}
    </div>
  )
}

/** A lista de visões dentro da folha do celular: o mesmo miolo do painel
 *  lateral, com o próprio campo de filtro no topo. */
function FolhaDeVisoes(props: Omit<Parameters<typeof ListaDeVisoes>[0], 'filtro'>) {
  const [filtro, setFiltro] = useState('')
  return (
    <div className="folha-visoes">
      <label className="views-panel__busca views-panel__busca--folha">
        <i className="ti ti-search" aria-hidden="true" />
        <input
          type="search"
          placeholder="Filtrar visualizações"
          aria-label="Filtrar visualizações"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />
      </label>
      <ListaDeVisoes {...props} filtro={filtro} />
    </div>
  )
}
