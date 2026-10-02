import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  useAcoesNota,
  useEtiquetas,
  useNotas,
  type EstadoNota,
  type NotaResumo,
} from '@/api/notas'
import { Esqueleto } from '@/ui/Esqueleto'
import { tempoRelativo } from '../tickets/detalhe/linhaDoTempo'
import { ModalNota } from './ModalNota'
import './notas.scss'

/**
 * Notas pessoais — a tela cheia.
 *
 * GRADE de cartões, não lista vertical: a nota é um objeto com título, um
 * pedaço de texto e uma data — cabe num cartão, e vinte cartões cabem numa
 * tela que a lista de uma coluna gastava em três rolagens. Abrir uma nota é
 * um MODAL sobre a grade (`ModalNota`), não uma segunda coluna fixa: o
 * desenho antigo cobrava metade da largura o tempo todo pra, na maior parte
 * do tempo, dizer "escolha uma nota à esquerda".
 *
 * Só o dono lê as próprias notas; o backend recorta por `owner` e nota de
 * outra pessoa responde 404, então não há nada a esconder aqui.
 *
 * "Nova nota" CRIA a nota no servidor antes de o editor abrir, com o título
 * "Sem título". É o que torna o autosave seguro: tudo o que ele faz é
 * atualizar. A alternativa — deixar o rascunho só na tela até virar digno de
 * ser salvo — perde o texto quando a pessoa troca de nota, e faz duas
 * requisições simultâneas criarem duas notas.
 */

/** Cada recorte tem o SEU vazio: "nenhuma fixada" pede outra coisa da pessoa
 *  do que "nenhuma nota", e a lixeira vazia é boa notícia, não convite a
 *  escrever. */
const RECORTES: { id: EstadoNota; rotulo: string; vazio: { icone: string; titulo: string; texto: string } }[] = [
  {
    id: 'active',
    rotulo: 'Ativas',
    vazio: {
      icone: 'ti ti-notes',
      titulo: 'Nenhuma nota por aqui ainda',
      texto: 'Guarde o passo a passo de um atendimento, um contato ou um lembrete. Só você vê.',
    },
  },
  {
    id: 'pinned',
    rotulo: 'Fixadas',
    vazio: {
      icone: 'ti ti-pin',
      titulo: 'Nenhuma nota fixada',
      texto: 'Abra uma nota e use Fixar para deixá-la sempre à mão.',
    },
  },
  {
    id: 'archived',
    rotulo: 'Arquivadas',
    vazio: {
      icone: 'ti ti-archive',
      titulo: 'Nenhuma nota arquivada',
      texto: 'Arquive o que não usa mais: sai da lista sem ir para a lixeira.',
    },
  },
  {
    id: 'trash',
    rotulo: 'Lixeira',
    vazio: {
      icone: 'ti ti-trash',
      titulo: 'A lixeira está vazia',
      texto: 'Notas excluídas ficam aqui até você restaurar.',
    },
  },
]

/** Quantos cartões fantasmas no carregamento: uma fileira e meia numa tela
 *  comum, o bastante para a grade não "pular" quando as notas chegam. */
const CARTOES_ESQUELETO = 6

const TITULO_PADRAO = 'Sem título'

//: Página inicial da lista e o quanto "Carregar mais" soma por clique —
// mesmo tamanho do PAGE_SIZE do backend (config/settings/base.py), para o
// primeiro carregamento e cada clique seguinte pedirem exatamente uma
// "página" do jeito que o servidor já pagina por padrão.
const PASSO = 25

/** O cartão de uma nota na grade.
 *
 *  A ordem de leitura é a mesma de qualquer fichário: de ONDE ela é (o
 *  chamado, ou "Nota pessoal"), o QUE é (título), um pedaço do texto, e
 *  QUANDO foi mexida — a data no rodapé do cartão, longe do título, porque
 *  é o dado que menos decide qual nota abrir e o que mais rouba atenção
 *  quando fica colado nele. */
function CartaoNota({
  nota,
  agoraMs,
  onAbrir,
}: {
  nota: NotaResumo
  agoraMs: number
  onAbrir: () => void
}) {
  return (
    <li>
      <button type="button" className="cartao-nota" onClick={onAbrir}>
        <span className="cartao-nota__origem">
          {nota.is_pinned && <i className="ti ti-pin" aria-label="Fixada" />}
          {nota.ticket_reference ?? 'Nota pessoal'}
        </span>

        <span className="cartao-nota__titulo">{nota.title}</span>

        {nota.excerpt && <span className="cartao-nota__corpo">{nota.excerpt}</span>}

        <span className="cartao-nota__rodape">
          {nota.tags.length > 0 && (
            <span className="cartao-nota__marcas">
              {nota.tags.slice(0, 2).map((e) => (
                <span key={e.id} className="cartao-nota__marca">
                  {e.name}
                </span>
              ))}
              {nota.tags.length > 2 && (
                <span className="cartao-nota__marca">+{nota.tags.length - 2}</span>
              )}
            </span>
          )}
          <span className="cartao-nota__quando">{tempoRelativo(nota.updated_at, agoraMs)}</span>
        </span>
      </button>
    </li>
  )
}

/** O cartão enquanto a lista não chega: a mesma altura e as mesmas linhas
 *  (origem, título, texto, rodapé) do cartão de verdade. */
function CartaoEsqueleto() {
  return (
    <li aria-hidden="true">
      <div className="cartao-nota cartao-nota--esqueleto">
        <Esqueleto className="w-1/3" />
        <Esqueleto className="w-4/5" />
        <Esqueleto className="w-full" />
        <Esqueleto className="w-3/5" />
        <span className="cartao-nota__rodape">
          <Esqueleto className="w-1/4" />
        </span>
      </div>
    </li>
  )
}

export function PaginaNotas() {
  const [recorte, setRecorte] = useState<EstadoNota>('active')
  const [busca, setBusca] = useState('')
  const [buscado, setBuscado] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [limite, setLimite] = useState(PASSO)
  const [aberta, setAberta] = useState<number | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const abasRef = useRef<HTMLDivElement>(null)

  // Mesmo debounce da busca global (BuscaComando): digitar não vira uma
  // requisição por tecla. `setLimite` aqui dentro (não num efeito à parte
  // reagindo a `buscado`) porque os dois têm de mudar JUNTOS: se o limite
  // resetasse um render depois do termo, o resultado antigo (com o limite
  // novo) apareceria por um instante antes do resultado da busca chegar.
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscado(busca)
      setLimite(PASSO)
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  /** Troca de recorte ou de etiqueta é troca de LISTA — carregar mais numa
   *  aba não pode vazar para a próxima; cada filtro recomeça do zero. */
  function mudarRecorte(novo: EstadoNota) {
    setRecorte(novo)
    setLimite(PASSO)
  }
  function mudarEtiqueta(novo: string) {
    setEtiqueta(novo)
    setLimite(PASSO)
  }
  function limparFiltros() {
    setBusca('')
    setBuscado('')
    mudarEtiqueta('')
  }

  /** Setas entre os recortes, como em qualquer grupo de abas: só o recorte
   *  ativo fica na ordem do Tab (`tabIndex`), e esquerda/direita, Home e End
   *  andam entre eles já trocando a lista. */
  function aoTeclarNosRecortes(e: KeyboardEvent<HTMLDivElement>) {
    const atual = RECORTES.findIndex((r) => r.id === recorte)
    const destino =
      e.key === 'ArrowRight'
        ? (atual + 1) % RECORTES.length
        : e.key === 'ArrowLeft'
          ? (atual - 1 + RECORTES.length) % RECORTES.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? RECORTES.length - 1
              : null
    if (destino === null) return
    e.preventDefault()
    mudarRecorte(RECORTES[destino].id)
    abasRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus()
  }

  const filtro = {
    state: recorte,
    q: buscado || undefined,
    tag: etiqueta || undefined,
    limit: limite,
  }
  // `dataUpdatedAt` e não `Date.now()`: o "há 3 min" do cartão é relativo ao
  // último fetch, determinístico e sem chamada impura em render — mesmo
  // padrão do detalhe do chamado.
  const { data, isLoading, isFetching, isError, refetch, dataUpdatedAt } = useNotas(filtro)
  const { data: etiquetas } = useEtiquetas()
  const { criar, salvar, excluir, restaurar } = useAcoesNota()

  const notas = data?.results ?? []
  // `count` é o total no recorte inteiro, não só o que já chegou — a
  // diferença é quanto ainda falta pedir.
  const restantes = Math.max(0, (data?.count ?? 0) - notas.length)
  const notaAberta = notas.find((n) => n.id === aberta) ?? null

  // Nota fora do recorte corrente (arquivei, apaguei, ou mudei o filtro) FECHA
  // o modal sozinha, porque `notaAberta` sai da lista — sem efeito
  // sincronizando estado. E `aberta` guarda o id: voltando o recorte, a nota
  // reabre onde estava.

  async function novaNota() {
    setErro(null)
    try {
      const nota = await criar.mutateAsync({ title: TITULO_PADRAO, content: '' })
      mudarRecorte('active')
      setAberta(nota.id)
    } catch {
      setErro('Não foi possível criar a nota.')
    }
  }

  const recorteAtual = RECORTES.find((r) => r.id === recorte) ?? RECORTES[0]
  const vazia = !isLoading && !isError && notas.length === 0
  const filtrando = Boolean(buscado || etiqueta)

  return (
    <div className="notas-pg">
      <header className="notas-pg__topo">
        <div className="notas-pg__titulos">
          <h1 className="notas-pg__titulo">Notas</h1>
          <p className="notas-pg__aviso">Só você vê estas notas.</p>
        </div>
        <button
          type="button"
          className="notas-pg__nova"
          onClick={novaNota}
          disabled={criar.isPending}
        >
          <i className="ti ti-plus" aria-hidden="true" />
          Nova nota
        </button>
      </header>

      <div className="notas-pg__filtros">
        <label className="notas-pg__busca">
          <i className="ti ti-search" aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar nas minhas notas"
            placeholder="Buscar por título ou texto"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>

        <div
          className="notas-pg__recortes"
          role="tablist"
          aria-label="Recorte"
          ref={abasRef}
          onKeyDown={aoTeclarNosRecortes}
        >
          {RECORTES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              id={`notas-recorte-${r.id}`}
              aria-selected={recorte === r.id}
              aria-controls="notas-lista"
              tabIndex={recorte === r.id ? 0 : -1}
              className={'notas-pg__recorte' + (recorte === r.id ? ' notas-pg__recorte--ativo' : '')}
              onClick={() => mudarRecorte(r.id)}
            >
              {r.rotulo}
            </button>
          ))}
        </div>

        {(etiquetas ?? []).length > 0 && (
          <label className="notas-pg__filtro-etiqueta">
            <span className="notas-pg__rotulo">Etiqueta</span>
            <span className="notas-pg__select">
              <select
                value={etiqueta}
                onChange={(e) => mudarEtiqueta(e.target.value)}
                aria-label="Filtrar por etiqueta"
              >
                <option value="">Todas</option>
                {(etiquetas ?? []).map((e) => (
                  <option key={e.id} value={e.slug}>
                    {e.name}
                  </option>
                ))}
              </select>
              <i className="ti ti-chevron-down" aria-hidden="true" />
            </span>
          </label>
        )}
      </div>

      {erro && (
        <p className="notas-pg__erro" role="alert">
          {erro}
        </p>
      )}

      <section
        className="notas-pg__secao"
        id="notas-lista"
        role="tabpanel"
        aria-labelledby={`notas-recorte-${recorte}`}
        aria-busy={isLoading || undefined}
      >
        {isLoading && (
          <>
            <p className="sr-only" role="status">
              Carregando notas
            </p>
            <ul className="notas-pg__grade">
              {Array.from({ length: CARTOES_ESQUELETO }, (_, i) => (
                <CartaoEsqueleto key={i} />
              ))}
            </ul>
          </>
        )}

        {isError && (
          <div className="notas-pg__vazio" role="alert">
            <i className="ti ti-alert-circle notas-pg__vazio-icone" aria-hidden="true" />
            <p className="notas-pg__vazio-titulo">Não foi possível carregar suas notas.</p>
            <p className="notas-pg__vazio-texto">Pode ter sido a conexão. Suas notas continuam salvas.</p>
            <button type="button" className="notas-pg__botao" onClick={() => refetch()}>
              <i className="ti ti-refresh" aria-hidden="true" /> Tentar de novo
            </button>
          </div>
        )}

        {vazia &&
          (filtrando ? (
            <div className="notas-pg__vazio">
              <i className="ti ti-search notas-pg__vazio-icone" aria-hidden="true" />
              <p className="notas-pg__vazio-titulo">Nada encontrado com esse filtro.</p>
              <p className="notas-pg__vazio-texto">Tente outra palavra ou limpe os filtros para ver todas.</p>
              <button type="button" className="notas-pg__botao" onClick={limparFiltros}>
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="notas-pg__vazio">
              <i className={`${recorteAtual.vazio.icone} notas-pg__vazio-icone`} aria-hidden="true" />
              <p className="notas-pg__vazio-titulo">{recorteAtual.vazio.titulo}</p>
              <p className="notas-pg__vazio-texto">{recorteAtual.vazio.texto}</p>
              {/* A ação do vazio muda com o recorte: nas ativas é escrever a
               *  primeira; em Fixadas e Arquivadas é voltar para onde as notas
               *  estão; na lixeira não há o que oferecer (lixeira vazia é o
               *  estado bom, não um convite a escrever). */}
              {recorte === 'active' && (
                <button
                  type="button"
                  className="notas-pg__nova"
                  onClick={novaNota}
                  disabled={criar.isPending}
                >
                  Escrever a primeira nota
                </button>
              )}
              {(recorte === 'pinned' || recorte === 'archived') && (
                <button type="button" className="notas-pg__botao" onClick={() => mudarRecorte('active')}>
                  Ver notas ativas
                </button>
              )}
            </div>
          ))}

        {!isError && notas.length > 0 && (
          <ul className="notas-pg__grade">
            {notas.map((n) => (
              <CartaoNota
                key={n.id}
                nota={n}
                agoraMs={dataUpdatedAt}
                onAbrir={() => setAberta(n.id)}
              />
            ))}
          </ul>
        )}

        {restantes > 0 && (
          <button
            type="button"
            className="notas-pg__botao notas-pg__carregar-mais"
            onClick={() => setLimite((l) => l + PASSO)}
            disabled={isFetching}
          >
            {isFetching ? 'Carregando…' : `Carregar mais (${restantes} restantes)`}
          </button>
        )}
      </section>

      {notaAberta && (
        <ModalNota
          nota={notaAberta}
          onFechar={() => setAberta(null)}
          acoes={
            notaAberta.is_deleted ? (
              <button
                type="button"
                className="notas-pg__botao"
                onClick={() => restaurar.mutate(notaAberta.id)}
              >
                <i className="ti ti-arrow-back-up" aria-hidden="true" /> Restaurar
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="notas-pg__botao"
                  aria-pressed={notaAberta.is_pinned}
                  onClick={() =>
                    salvar.mutate({ id: notaAberta.id, is_pinned: !notaAberta.is_pinned })
                  }
                >
                  <i className="ti ti-pin" aria-hidden="true" />
                  {notaAberta.is_pinned ? 'Desafixar' : 'Fixar'}
                </button>
                <button
                  type="button"
                  className="notas-pg__botao"
                  aria-pressed={notaAberta.is_archived}
                  onClick={() =>
                    salvar.mutate({ id: notaAberta.id, is_archived: !notaAberta.is_archived })
                  }
                >
                  <i className="ti ti-archive" aria-hidden="true" />
                  {notaAberta.is_archived ? 'Desarquivar' : 'Arquivar'}
                </button>
                <button
                  type="button"
                  className="notas-pg__botao"
                  onClick={() => excluir.mutate(notaAberta.id)}
                >
                  <i className="ti ti-trash" aria-hidden="true" /> Excluir
                </button>
              </>
            )
          }
        />
      )}
    </div>
  )
}
