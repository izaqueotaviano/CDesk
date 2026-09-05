import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { TicketsTable } from './TicketsTable'
import { ViewsPanel, type Visualizacao } from './ViewsPanel'
import { useTicketsList } from './useTicketsList'
import type { ColunaOrdenavel, ParamsListagem } from './tipos'
import './lista.scss'

const LIMITE = 25
const VIEW_INICIAL = 'nao-resolvidos' // a mesma que está ativa no print

const ROTULO_VIEW: Record<string, string> = {
  'meus-nao-resolvidos': 'Meus tickets não resolvidos',
  todos: 'Todos os tickets',
  prioritario: 'Tickets Prioritário',
  'sem-atendimento': 'Tickets Sem Atendimento',
  'nao-resolvidos': 'Todos os tickets não resolvidos',
  'em-kanban': 'Todos os tickets - Kanban',
  'nao-atribuidos': 'Tickets não atribuídos',
  resolvidos: 'Tickets Resolvidos',
  internos: 'Tickets Internos',
}

export function PaginaListaTickets() {
  const navigate = useNavigate()
  const [viewAtiva, setViewAtiva] = useState(VIEW_INICIAL)
  const [busca, setBusca] = useState('')
  const [ordering, setOrdering] = useState('-criado')
  const [offset, setOffset] = useState(0)
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())

  const ehPrioritario = viewAtiva === 'prioritario'
  const params: ParamsListagem = {
    view: ehPrioritario ? undefined : viewAtiva,
    priority: ehPrioritario ? 'urgent' : undefined,
    q: busca,
    ordering,
    limit: LIMITE,
    offset,
  }

  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } =
    useTicketsList(params)

  // Referência de "agora" para o tempo de espera: o instante do último fetch
  // (determinístico, vindo do cache do Query) — não Date.now() em render, que
  // recalcularia a cada tecla e é impuro. Atualiza sozinho a cada refetch.
  const agoraMs = dataUpdatedAt || 0

  const linhas = data?.results ?? []
  const total = data?.count ?? 0
  const inicio = total === 0 ? 0 : offset + 1
  const fim = Math.min(offset + LIMITE, total)

  function selecionarView(v: Visualizacao) {
    setViewAtiva(v.id === 'prioritario' ? 'prioritario' : (v.view ?? v.id))
    setOffset(0)
    setSelecionados(new Set())
  }

  function ordenar(chave: ColunaOrdenavel) {
    setOrdering((atual) => (atual === chave ? `-${chave}` : chave))
    setOffset(0)
  }

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

  const titulo = ROTULO_VIEW[viewAtiva] ?? 'Tickets'

  return (
    <div className="lista-tickets">
      <ViewsPanel ativa={viewAtiva} onSelecionar={selecionarView} />

      <section className="lista-tickets__main">
        {/* ---------- cabeçalho ---------- */}
        <header className="lista-tickets__header">
          <div className="lista-tickets__titulo-bloco">
            <h1 className="lista-tickets__titulo">{titulo}</h1>
            <p className="lista-tickets__subtitulo">
              {total > 0
                ? `Exibindo de ${inicio} até ${fim} de um total de ${total} registro(s)`
                : isLoading
                  ? 'Carregando…'
                  : 'Nenhum registro'}
            </p>
          </div>

          <div className="lista-tickets__acoes">
            <button
              type="button"
              className="lista-tickets__novo"
              onClick={() => navigate('/chamados/novo')}
            >
              <i className="ti ti-plus" />
              Novo chamado
            </button>
            <button
              type="button"
              className={'lista-tickets__refresh' + (isFetching ? ' is-loading' : '')}
              onClick={() => refetch()}
              aria-label="Atualizar"
            >
              <i className="ti ti-refresh" />
            </button>
            <button type="button" className="lista-tickets__opcoes">
              <i className="ti ti-list-check" />
              Opções
            </button>
            <div className="lista-tickets__search">
              <i className="ti ti-search" />
              <input
                type="text"
                placeholder="Pesquisar"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setOffset(0)
                }}
              />
            </div>
          </div>
        </header>

        {busca.length > 0 && busca.length < 3 && (
          <p className="lista-tickets__dica">Digite pelo menos 3 caracteres para iniciar a busca.</p>
        )}

        {/* ---------- barra de seleção em lote ---------- */}
        {selecionados.size > 0 && (
          <div className="lista-tickets__lote">
            <strong>{selecionados.size}</strong> selecionado(s)
            <button type="button" onClick={() => setSelecionados(new Set())}>
              Limpar
            </button>
          </div>
        )}

        {/* ---------- corpo ---------- */}
        {isError ? (
          <div className="lista-tickets__estado lista-tickets__estado--erro">
            <i className="ti ti-alert-triangle" />
            <p>
              Não foi possível carregar os tickets
              {error instanceof ApiError ? ` (${error.status})` : ''}.
            </p>
            <button type="button" onClick={() => refetch()}>
              Tentar de novo
            </button>
          </div>
        ) : isLoading ? (
          <div className="lista-tickets__estado">
            <i className="ti ti-loader-2 lista-tickets__spin" />
            <p>Carregando tickets…</p>
          </div>
        ) : linhas.length === 0 ? (
          <div className="lista-tickets__estado">
            <i className="ti ti-inbox" />
            <p>Nenhum ticket nesta visualização.</p>
          </div>
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
          />
        )}

        {/* ---------- paginação ---------- */}
        {total > LIMITE && (
          <footer className="lista-tickets__paginacao">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - LIMITE))}
            >
              <i className="ti ti-chevron-left" />
              Anterior
            </button>
            <span>
              {inicio}–{fim} de {total}
            </span>
            <button
              type="button"
              disabled={fim >= total}
              onClick={() => setOffset(offset + LIMITE)}
            >
              Próxima
              <i className="ti ti-chevron-right" />
            </button>
          </footer>
        )}
      </section>
    </div>
  )
}
