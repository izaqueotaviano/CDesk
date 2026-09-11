import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAgentes } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useMe } from '@/api/queries/useMe'
import { usePrefs } from '@/stores/prefs'
import { mensagemDeErro } from './detalhe/linhaDoTempo'
import { useAcoesEmLote, type ResultadoLote } from './dados'
import { ROTULO_PRIORIDADE } from './format'
import { TicketsTable } from './TicketsTable'
import { ViewsPanel, type Visualizacao } from './ViewsPanel'
import { useTicketsList } from './useTicketsList'
import type { ColunaOrdenavel, ParamsListagem, Prioridade } from './tipos'
import './lista.scss'

const PRIORIDADES: Prioridade[] = ['low', 'normal', 'high', 'urgent']

/** Resumo da resposta parcial (`updated`/`failed`) no padrão da casa: o que
 *  deu certo + o motivo do que não deu, não um genérico "algo falhou". */
function resumoLote(res: ResultadoLote, verbo: string): string | null {
  if (res.failed.length === 0) return null
  const okTrecho = res.updated.length > 0 ? `${res.updated.length} ${verbo} certo. ` : ''
  const motivo = res.failed[0]?.detail ?? 'Motivo não informado.'
  const resto = res.failed.length > 1 ? ` (e mais ${res.failed.length - 1})` : ''
  return `${okTrecho}${res.failed.length} não pôde ser alterado: ${motivo}${resto}`
}

/** Item (rodada 3): o caminho feliz da ação em lote não dizia NADA — só
 *  `resumoLote` acima tinha voz, e só quando algo dava errado. Reatribuir 20
 *  chamados de uma vez e a tela ficar muda é indistinguível, pra quem clicou,
 *  de "o clique não saiu". Mesmo fragmento "N verbo certo." que já existia
 *  dentro de `resumoLote`, só que sozinho — a frase de sucesso continua
 *  falando a mesma língua da de erro parcial. */
function resumoSucessoLote(res: ResultadoLote, verbo: string): string | null {
  if (res.updated.length === 0) return null
  return `${res.updated.length} ${verbo} certo.`
}

/** "15:51" a partir de epoch ms — `dataUpdatedAt` do React Query, não ISO.
 *  Mesma leitura de `horaCurta` (detalhe/linhaDoTempo.ts), que recebe string;
 *  aqui o `Date` já está pronto e não vale ir e voltar de ISO só pra reusar
 *  aquela função. */
function horaCurtaDoEpoch(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

const LIMITE = 25
const VIEW_INICIAL = 'nao-resolvidos' // a mesma que está ativa no print

const ROTULO_VIEW: Record<string, string> = {
  'meus-nao-resolvidos': 'Meus tickets não resolvidos',
  'aguardando-voce': 'Aguardando você',
  todos: 'Todos os tickets',
  prioritario: 'Tickets Prioritário',
  'sem-atendimento': 'Tickets Sem Atendimento',
  'nao-resolvidos': 'Todos os tickets não resolvidos',
  // Item 24: mesmo rótulo e mesmo motivo de ViewsPanel.tsx — o filtro real
  // é "tem prazo interno anotado no quadro", não "está no kanban".
  'em-kanban': 'Com prazo no quadro',
  'nao-atribuidos': 'Tickets não atribuídos',
  resolvidos: 'Tickets Resolvidos',
  internos: 'Tickets Internos',
}

export function PaginaListaTickets() {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const densidade = usePrefs((s) => s.densidade)
  const setDensidade = usePrefs((s) => s.setDensidade)

  // Item 18: view/busca/ordering/offset vivem na URL, não em useState solto —
  // mesmo padrão de cvz/configuracoes, portal/chat, portal/historico e
  // resolv/chat/PaginaChat.tsx (`useSearchParams` + um `definir()` que
  // aplica mudanças preservando o resto da query). Sem isso, triar na
  // página 4 de "Não atribuídos" com busca ativa, abrir um chamado e voltar
  // jogava a pessoa de volta na página 1 da view padrão.
  const [searchParams, setSearchParams] = useSearchParams()

  const viewParam = searchParams.get('view')
  const viewAtiva =
    viewParam && Object.prototype.hasOwnProperty.call(ROTULO_VIEW, viewParam) ? viewParam : VIEW_INICIAL
  const ordering = searchParams.get('ordering') || '-criado'
  const offsetParam = Number(searchParams.get('offset') ?? 0)
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0
  // `q` é o termo já DEBOUNCED (o que de fato foi pedido ao servidor) — o
  // valor bruto de cada tecla mora só no estado local `busca`, abaixo.
  const q = searchParams.get('q') ?? ''

  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [avisoLote, setAvisoLote] = useState<string | null>(null)
  const [avisoSucessoLote, setAvisoSucessoLote] = useState<string | null>(null)

  const podeLote = (me?.permissions ?? []).includes('ticket.bulk_actions')
  const { data: agentes } = useAgentes()
  const { atribuir, mudarPrioridade } = useAcoesEmLote()

  /** Aplica mudanças na URL preservando as demais chaves (mesmo formato de
   *  `definir` em portal/tickets/PaginaTickets.tsx). `replace: true` porque
   *  cada tecla ou clique aqui é um refinamento do mesmo recorte, não uma
   *  parada nova de histórico — sem isso, apertar "voltar" desfaria filtro
   *  por filtro em vez de sair da tela. Toda troca reseta `offset` (página 1)
   *  a menos que `manterOffset` diga o contrário — é assim que a paginação
   *  consegue setar o offset sem se autoderrubar. */
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

  /** Toda troca de RECORTE (visão, busca, ordenação, página) zera a seleção:
   *  agir em lote sobre uma linha que saiu da tela é ação às cegas — a
   *  pessoa marca 3 na página 1, vira a página e a barra continua dizendo "3
   *  selecionado(s)" de chamados que ela não vê mais. O aviso da última
   *  tentativa parcial vai junto, porque ele fala dos ids que acabaram de
   *  sair de vista. */
  function trocarRecorte(mudancas: Record<string, string | undefined>, opcoes?: { manterOffset?: boolean }) {
    definir(mudancas, opcoes)
    setSelecionados(new Set())
    setAvisoLote(null)
    setAvisoSucessoLote(null)
  }

  // Busca bruta (cada tecla) fica só no estado local — nunca vai direto pra
  // URL. 300ms parado de digitar antes de sincronizar com a URL (e daí com o
  // servidor): escrever a cada tecla enchia o histórico e fazia a resposta
  // de uma tecla anterior "desfazer" a busca mais recente na tela. Só troca
  // o recorte (e zera a seleção) no momento em que o termo debounced muda de
  // verdade — não a cada tecla bruta.
  const [busca, setBusca] = useState(q)
  useEffect(() => {
    const alvo = busca.trim()
    if (alvo === q) return
    const t = setTimeout(() => trocarRecorte({ q: alvo || undefined }), 300)
    return () => clearTimeout(t)
    // `trocarRecorte` fica de fora de propósito: ela só encapsula `definir`
    // (estável via useCallback) + dois `setState`, também estáveis — incluí-
    // la aqui só forçaria o efeito a rodar de novo a cada render à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busca, q])

  function limparBusca() {
    setBusca('')
    trocarRecorte({ q: undefined })
  }

  // "Tickets Prioritário" = urgente E ainda não resolvido. Sem o recorte de
  // status a gaveta trazia todo chamado urgente da história (o queryset base
  // não filtra status — selectors.visible_tickets), e o contador do subtítulo
  // inflava junto: quem abre isto pergunta "o que eu ataco agora", não "o que
  // já foi urgente algum dia". O nome fica como está — "Tickets Sem
  // Atendimento" também é recortado por não-resolvido sem dizer no rótulo
  // (SAVED_VIEWS em apps/tickets/views.py); é o padrão da lateral, não uma
  // exceção deste item.
  const ehPrioritario = viewAtiva === 'prioritario'
  const consulta: ParamsListagem = {
    view: ehPrioritario ? 'nao-resolvidos' : viewAtiva,
    priority: ehPrioritario ? 'urgent' : undefined,
    q,
    ordering,
    limit: LIMITE,
    offset,
  }

  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } =
    useTicketsList(consulta)

  // Referência de "agora" para o tempo de espera: o instante do último fetch
  // (determinístico, vindo do cache do Query) — não Date.now() em render, que
  // recalcularia a cada tecla e é impuro. Atualiza sozinho a cada refetch.
  const agoraMs = dataUpdatedAt || 0

  const linhas = data?.results ?? []
  const total = data?.count ?? 0
  const inicio = total === 0 ? 0 : offset + 1
  const fim = Math.min(offset + LIMITE, total)

  // Item 15: `useTicketsList`/`montarQuery` só manda `q=` ao servidor com 3+
  // caracteres (mesma regra de `_busca_q`, apps/tickets/views.py) — com
  // menos que isso, `q` chega até aqui mas nenhum filtro foi de fato
  // aplicado. Um resultado vazio só é "sem resultado da busca" quando o
  // termo realmente foi pro servidor; do contrário é a view mesmo que está
  // vazia, e são dois avisos diferentes.
  const termoBuscaAplicado = q.length >= 3 ? q : ''

  function selecionarView(v: Visualizacao) {
    trocarRecorte({ view: v.id === 'prioritario' ? 'prioritario' : (v.view ?? v.id) })
  }

  // Resposta parcial (`updated`/`failed`): sem falhas, limpa a seleção e diz
  // que deu certo (item desta rodada — antes o sucesso total ficava mudo);
  // com alguma falha, mantém os selecionados (a pessoa pode tentar de novo ou
  // olhar a tabela) e mostra o motivo, sem sobrepor com o aviso de sucesso.
  function tratarResultadoLote(res: ResultadoLote, verbo: string) {
    const falha = resumoLote(res, verbo)
    if (falha) {
      setAvisoLote(falha)
      setAvisoSucessoLote(null)
    } else {
      setSelecionados(new Set())
      setAvisoLote(null)
      setAvisoSucessoLote(resumoSucessoLote(res, verbo))
    }
  }

  function atribuirEmLote(assigneeId: number | null) {
    setAvisoLote(null)
    setAvisoSucessoLote(null)
    atribuir.mutate(
      { ticket_ids: Array.from(selecionados), assignee_id: assigneeId },
      {
        onSuccess: (res) => tratarResultadoLote(res, 'atribuídos'),
        onError: (err) => setAvisoLote(mensagemDeErro(err, 'Não foi possível atribuir os chamados.')),
      },
    )
  }

  function mudarPrioridadeEmLote(priority: Prioridade) {
    setAvisoLote(null)
    setAvisoSucessoLote(null)
    mudarPrioridade.mutate(
      { ticket_ids: Array.from(selecionados), priority },
      {
        onSuccess: (res) => tratarResultadoLote(res, 'atualizados'),
        onError: (err) => setAvisoLote(mensagemDeErro(err, 'Não foi possível mudar a prioridade.')),
      },
    )
  }

  function ordenar(chave: ColunaOrdenavel) {
    // Reordenar mantém o mesmo conjunto, mas troca QUEM está nesta página —
    // as marcadas escorregam para outra e a barra passaria a falar de linhas
    // que ninguém vê. Mesma razão de virar página: `trocarRecorte` zera a
    // seleção e volta pra página 1 junto.
    trocarRecorte({ ordering: ordering === chave ? `-${chave}` : chave })
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

  function irParaOffset(novoOffset: number) {
    trocarRecorte({ offset: novoOffset > 0 ? String(novoOffset) : undefined }, { manterOffset: true })
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
              {/* Item (rodada 3): sem `refetchInterval` (useTicketsList.ts) a
                  fila só atualizava em ação própria ou socket — e nada dizia
                  QUANDO é o dado na tela. `agoraMs` é `dataUpdatedAt` do
                  próprio React Query (0 antes do primeiro fetch terminar, daí
                  o `> 0` escondendo isto no carregamento inicial). */}
              {agoraMs > 0 && (
                <span className="lista-tickets__atualizado"> · Atualizado às {horaCurtaDoEpoch(agoraMs)}</span>
              )}
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
            {/* Densidade (stores/prefs.ts): a mesma preferência que o
                DataTable do cvz já expõe — uma tabela só, um alternador só,
                a escolha vale nas duas telas. 'compacta' é o que esta tabela
                já mostrava antes de existir alternador nenhum (lista.scss). */}
            <div className="lista-tickets__densidade" role="group" aria-label="Densidade da tabela">
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
            <div className="lista-tickets__search">
              <i className="ti ti-search" />
              {/* Item 15: só tinha `placeholder` — some assim que a pessoa
                  digita, e um placeholder nunca é nome acessível confiável
                  (leitor de tela não anuncia com o campo já preenchido em
                  todo navegador). O aria-label também diz o ESCOPO: `_busca_q`
                  (apps/tickets/views.py) casa só referência, assunto e número
                  do pedido — sem isso, alguém digitava um nome de cliente,
                  não achava nada e desconfiava da tela errada. */}
              <input
                type="text"
                placeholder="Pesquisar"
                aria-label="Buscar por referência, assunto ou número do pedido"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
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
            {podeLote && (
              <>
                <select
                  className="lista-tickets__lote-select"
                  value=""
                  disabled={atribuir.isPending}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    atribuirEmLote(v === 'ninguem' ? null : Number(v))
                  }}
                >
                  <option value="">Atribuir a…</option>
                  <option value="ninguem">Ninguém</option>
                  {(agentes ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name}
                    </option>
                  ))}
                </select>
                <select
                  className="lista-tickets__lote-select"
                  value=""
                  disabled={mudarPrioridade.isPending}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v) return
                    mudarPrioridadeEmLote(v as Prioridade)
                  }}
                >
                  <option value="">Mudar prioridade…</option>
                  {PRIORIDADES.map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PRIORIDADE[p]}
                    </option>
                  ))}
                </select>
                {(atribuir.isPending || mudarPrioridade.isPending) && (
                  <i className="ti ti-loader-2 lista-tickets__spin" aria-hidden="true" />
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setSelecionados(new Set())
                setAvisoLote(null)
                setAvisoSucessoLote(null)
              }}
            >
              Limpar
            </button>
          </div>
        )}

        {avisoLote && (
          <div className="lista-tickets__aviso-erro" role="alert">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            <span>{avisoLote}</span>
            <button type="button" onClick={() => setAvisoLote(null)} aria-label="Dispensar">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Item (rodada 3): caminho feliz da ação em lote sem voz nenhuma —
            `role="status"` (não `alert`): é uma confirmação, não precisa
            interromper leitor de tela como o erro acima interrompe. */}
        {avisoSucessoLote && (
          <div className="lista-tickets__aviso-sucesso" role="status">
            <i className="ti ti-circle-check" aria-hidden="true" />
            <span>{avisoSucessoLote}</span>
            <button type="button" onClick={() => setAvisoSucessoLote(null)} aria-label="Dispensar">
              <i className="ti ti-x" aria-hidden="true" />
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
            {/* Item 15: o vazio de "não achei o que você buscou" (com saída
                pra tentar de novo) é um problema diferente do vazio de "esta
                view não tem nada" — confundir os dois faz quem busca "Acme"
                numa view com 40 chamados da Acme culpar a view errada,
                trocar de view, repetir, e concluir que o chamado não
                existe. */}
            {termoBuscaAplicado ? (
              <>
                <i className="ti ti-search" />
                <p>Nenhum resultado para "{termoBuscaAplicado}".</p>
                <button type="button" onClick={limparBusca}>
                  Limpar busca
                </button>
              </>
            ) : (
              <>
                <i className="ti ti-inbox" />
                <p>Nenhum ticket nesta visualização.</p>
              </>
            )}
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
              onClick={() => irParaOffset(Math.max(0, offset - LIMITE))}
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
              onClick={() => irParaOffset(offset + LIMITE)}
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
