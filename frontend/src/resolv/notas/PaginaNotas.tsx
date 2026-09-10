import { useEffect, useState } from 'react'
import {
  useAcoesNota,
  useEtiquetas,
  useNotas,
  type EstadoNota,
  type NotaResumo,
} from '@/api/notas'
import { tempoRelativo } from '../tickets/detalhe/linhaDoTempo'
import { EditorNota } from './EditorNota'
import './notas.scss'

/**
 * Notas pessoais — a tela cheia.
 *
 * Duas colunas: a lista à esquerda (recorte, busca, etiqueta) e o editor à
 * direita, com autosave. Só o dono lê as próprias notas; o backend recorta
 * por `owner` e nota de outra pessoa responde 404, então não há nada a
 * esconder aqui.
 *
 * "Nova nota" CRIA a nota no servidor antes de o editor abrir, com o título
 * "Sem título". É o que torna o autosave seguro: tudo o que ele faz é
 * atualizar. A alternativa — deixar o rascunho só na tela até virar digno de
 * ser salvo — perde o texto quando a pessoa troca de nota, e faz duas
 * requisições simultâneas criarem duas notas.
 */

const RECORTES: { id: EstadoNota; rotulo: string }[] = [
  { id: 'active', rotulo: 'Ativas' },
  { id: 'pinned', rotulo: 'Fixadas' },
  { id: 'archived', rotulo: 'Arquivadas' },
  { id: 'trash', rotulo: 'Lixeira' },
]

const TITULO_PADRAO = 'Sem título'

//: Página inicial da lista e o quanto "Carregar mais" soma por clique —
// mesmo tamanho do PAGE_SIZE do backend (config/settings/base.py), para o
// primeiro carregamento e cada clique seguinte pedirem exatamente uma
// "página" do jeito que o servidor já pagina por padrão.
const PASSO = 25

function LinhaNota({
  nota,
  ativa,
  agoraMs,
  onAbrir,
}: {
  nota: NotaResumo
  ativa: boolean
  agoraMs: number
  onAbrir: () => void
}) {
  return (
    <li>
      <button
        type="button"
        className={'notas-pg__linha' + (ativa ? ' notas-pg__linha--ativa' : '')}
        onClick={onAbrir}
        aria-current={ativa ? 'true' : undefined}
      >
        <span className="notas-pg__linha-topo">
          <span className="notas-pg__linha-titulo">
            {nota.is_pinned && <i className="ti ti-pin" aria-label="Fixada" />}
            {nota.title}
          </span>
          <span className="notas-pg__linha-quando">{tempoRelativo(nota.updated_at, agoraMs)}</span>
        </span>
        {nota.excerpt && <span className="notas-pg__linha-corpo">{nota.excerpt}</span>}
        {(nota.tags.length > 0 || nota.ticket_reference) && (
          <span className="notas-pg__linha-marcas">
            {nota.ticket_reference && (
              <span className="notas-pg__marca notas-pg__marca--chamado">
                {nota.ticket_reference}
              </span>
            )}
            {nota.tags.map((e) => (
              <span key={e.id} className="notas-pg__marca">
                {e.name}
              </span>
            ))}
          </span>
        )}
      </button>
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

  const filtro = {
    state: recorte,
    q: buscado || undefined,
    tag: etiqueta || undefined,
    limit: limite,
  }
  // `dataUpdatedAt` e não `Date.now()`: o "há 3 min" da lista é relativo ao
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

  // Nota fora do recorte corrente (arquivei, apaguei, ou mudei o filtro) some
  // do editor SOZINHA, porque `notaAberta` sai da lista — sem efeito
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

  return (
    <div className="notas-pg">
      <section className="notas-pg__lista" aria-label="Minhas notas">
        <header className="notas-pg__cabecalho">
          <h1 className="notas-pg__titulo">Notas</h1>
          <button type="button" className="notas-pg__botao notas-pg__botao--primario" onClick={novaNota} disabled={criar.isPending}>
            <i className="ti ti-plus" aria-hidden="true" />
            Nova nota
          </button>
        </header>

        <p className="notas-pg__aviso">Só você vê estas notas.</p>

        <input
          type="search"
          className="notas-pg__busca"
          aria-label="Buscar nas minhas notas"
          placeholder="Buscar por título ou texto…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <div className="notas-pg__recortes" role="tablist" aria-label="Recorte">
          {RECORTES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={recorte === r.id}
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
            <select value={etiqueta} onChange={(e) => mudarEtiqueta(e.target.value)} aria-label="Filtrar por etiqueta">
              <option value="">Todas</option>
              {(etiquetas ?? []).map((e) => (
                <option key={e.id} value={e.slug}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {erro && (
          <p className="notas-pg__erro" role="alert">
            {erro}
          </p>
        )}

        {isLoading && (
          <p className="notas-pg__estado" role="status">
            Carregando…
          </p>
        )}

        {isError && (
          <div className="notas-pg__estado" role="alert">
            <p>Não foi possível carregar suas notas.</p>
            <button type="button" className="notas-pg__link" onClick={() => refetch()}>
              Tentar de novo
            </button>
          </div>
        )}

        {!isLoading && !isError && notas.length === 0 && (
          <p className="notas-pg__estado">
            {buscado || etiqueta
              ? 'Nada encontrado com esse filtro.'
              : recorte === 'trash'
                ? 'A lixeira está vazia.'
                : 'Nenhuma nota por aqui ainda.'}
          </p>
        )}

        <ul className="notas-pg__linhas">
          {notas.map((n) => (
            <LinhaNota
              key={n.id}
              nota={n}
              ativa={n.id === aberta}
              agoraMs={dataUpdatedAt}
              onAbrir={() => setAberta(n.id)}
            />
          ))}
        </ul>

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

      <section className="notas-pg__editor" aria-label="Nota aberta">
        {notaAberta ? (
          <>
            <div className="notas-pg__cabecalho-editor">
              <p className="notas-pg__migalha">
                Notas
                <i className="ti ti-chevron-right" aria-hidden="true" />
                <span>{notaAberta.title || 'Sem título'}</span>
              </p>
              <div className="notas-pg__acoes">
                {notaAberta.is_deleted ? (
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
                )}
              </div>
            </div>
            <EditorNota notaId={notaAberta.id} />
          </>
        ) : (
          <p className="notas-pg__vazio">
            Escolha uma nota à esquerda, ou crie uma nova.
          </p>
        )}
      </section>
    </div>
  )
}
