import { useState } from 'react'
import { useAcoesNota, useNota, useNotas, type NotaResumo } from '@/api/notas'
import { EditorConteudo } from '../../notas/EditorConteudo'
import { tempoRelativo } from './linhaDoTempo'

/**
 * Notas pessoais sobre ESTE chamado.
 *
 * Rascunho de quem atende, não recado para a equipe: quem quer que o time
 * leia escreve uma nota interna na conversa (`TicketMessage.is_internal`).
 * O backend recorta por dono, então aqui não há nada a filtrar — o que a
 * lista traz já é só o de quem está logado.
 *
 * Sem autosave de propósito. O autosave é da tela `/notas`, onde a pessoa
 * senta para escrever; aqui a nota nasce no meio do atendimento, e um
 * "Salvar" explícito é o que evita rascunho pela metade virar registro.
 *
 * O corpo usa o mesmo `EditorConteudo` (CKEditor) da tela cheia — não um
 * `<textarea>` à parte. Os dois editam o mesmo campo HTML; se este painel
 * ainda fosse texto puro, abrir aqui uma nota formatada na tela cheia
 * mostraria as tags cruas, e salvar de volta corromperia a formatação.
 */

const TITULO_MAX = 200

/**
 * Editor de uma nota — nova (`notaId === null`) ou existente.
 *
 * Nota existente NÃO é aberta com o que a lista trouxe: a lista devolve
 * `excerpt`, um TRECHO de 180 caracteres, e salvar a partir dele gravaria a
 * nota truncada — perda de dado silenciosa, e justamente na nota longa, que é
 * a que custou mais para escrever. Por isso o formulário só aparece depois de
 * `useNota` trazer o corpo inteiro.
 */
function EditorDeNota({
  notaId,
  ticketId,
  onFim,
}: {
  notaId: number | null
  ticketId: number
  onFim: () => void
}) {
  const { data: nota, isLoading, isError } = useNota(notaId)

  if (notaId !== null) {
    if (isLoading) {
      return (
        <p className="notas__estado" role="status">
          Abrindo a nota…
        </p>
      )
    }
    if (isError || !nota) {
      return (
        <div className="notas__estado" role="alert">
          <p>Não foi possível abrir a nota.</p>
          <button type="button" className="notas__link" onClick={onFim}>
            Voltar
          </button>
        </div>
      )
    }
  }

  return (
    <FormularioDeNota
      notaId={notaId}
      ticketId={ticketId}
      inicial={nota ? { title: nota.title, content: nota.content } : { title: '', content: '' }}
      onFim={onFim}
    />
  )
}

/** O formulário em si. Recebe os valores iniciais JÁ carregados — quem semeia
 *  estado a partir de props precisa que eles cheguem prontos, senão viraria um
 *  `useEffect` sincronizando estado com props (cascata de render). */
function FormularioDeNota({
  notaId,
  ticketId,
  inicial,
  onFim,
}: {
  notaId: number | null
  ticketId: number
  inicial: { title: string; content: string }
  onFim: () => void
}) {
  const { criar, salvar } = useAcoesNota()
  const [rascunho, setRascunho] = useState(inicial)
  const [erro, setErro] = useState<string | null>(null)
  const salvando = criar.isPending || salvar.isPending

  async function gravar() {
    setErro(null)
    try {
      if (notaId === null) {
        // o vínculo é o ponto do painel: a nota já nasce presa ao chamado
        await criar.mutateAsync({ ...rascunho, ticket: ticketId })
      } else {
        await salvar.mutateAsync({ id: notaId, ...rascunho })
      }
      onFim()
    } catch {
      setErro('Não foi possível salvar a nota. Tente de novo.')
    }
  }

  return (
    <form
      className="notas__editor"
      onSubmit={(e) => {
        e.preventDefault()
        void gravar()
      }}
    >
      <input
        className="notas__titulo-campo"
        placeholder="Título da nota"
        aria-label="Título da nota"
        maxLength={TITULO_MAX}
        autoFocus
        value={rascunho.title}
        onChange={(e) => setRascunho({ ...rascunho, title: e.target.value })}
      />
      <EditorConteudo
        valor={rascunho.content}
        onMudar={(content) => setRascunho((r) => ({ ...r, content }))}
        placeholder="O que você precisa lembrar sobre este chamado…"
      />
      {erro && (
        <p className="notas__erro" role="alert">
          {erro}
        </p>
      )}
      <div className="notas__editor-acoes">
        <button
          type="submit"
          className="notas__botao notas__botao--primario"
          disabled={salvando || !rascunho.title.trim()}
        >
          {salvando ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" className="notas__botao" onClick={onFim} disabled={salvando}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

function Cartao({
  nota,
  agoraMs,
  onEditar,
  onExcluir,
}: {
  nota: NotaResumo
  agoraMs: number
  onEditar: () => void
  onExcluir: () => void
}) {
  return (
    <li className="notas__item">
      <div className="notas__item-topo">
        <h3 className="notas__item-titulo">{nota.title}</h3>
        <span className="notas__item-quando">{tempoRelativo(nota.updated_at, agoraMs)}</span>
      </div>
      {/* `excerpt` é o corpo SEM marcação (o backend já tira as tags para a
       *  prévia — `apps.notes.serializers._texto_simples`); ainda é texto
       *  puro, renderizado como nó de texto, mesmo com `content` sendo HTML. */}
      {nota.excerpt && <p className="notas__item-corpo">{nota.excerpt}</p>}
      {nota.tags.length > 0 && (
        <ul className="notas__etiquetas">
          {nota.tags.map((e) => (
            <li key={e.id} className="notas__etiqueta">
              {e.name}
            </li>
          ))}
        </ul>
      )}
      <div className="notas__item-acoes">
        <button type="button" className="notas__link" onClick={onEditar}>
          <i className="ti ti-pencil" aria-hidden="true" /> Editar
        </button>
        <button type="button" className="notas__link" onClick={onExcluir}>
          <i className="ti ti-trash" aria-hidden="true" /> Excluir
        </button>
      </div>
    </li>
  )
}

export function PainelNotas({
  ticketId,
  agoraMs,
  onFechar,
}: {
  ticketId: number
  agoraMs: number
  onFechar: () => void
}) {
  const { data, isLoading, isError, refetch } = useNotas({ ticket: ticketId })
  const { excluir, restaurar } = useAcoesNota()
  /** `null` = ninguém editando; `{id:null}` = nota nova; `{id:n}` = editando n. */
  const [editando, setEditando] = useState<{ id: number | null } | null>(null)
  /** Última nota mandada para a lixeira — enquanto está aqui, dá para desfazer. */
  const [desfazivel, setDesfazivel] = useState<number | null>(null)

  const notas = data?.results ?? []

  return (
    <aside className="notas" aria-label="Minhas notas sobre este chamado">
      <header className="notas__cabecalho">
        <h2 className="notas__cabecalho-titulo">
          <i className="ti ti-notes" aria-hidden="true" />
          Minhas notas
        </h2>
        <button
          type="button"
          className="notas__fechar"
          onClick={onFechar}
          aria-label="Fechar notas"
        >
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      </header>

      <p className="notas__aviso">Só você vê estas notas.</p>

      {editando ? (
        <EditorDeNota
          key={editando.id ?? 'nova'}
          notaId={editando.id}
          ticketId={ticketId}
          onFim={() => setEditando(null)}
        />
      ) : (
        <button
          type="button"
          className="notas__botao notas__botao--primario notas__nova"
          onClick={() => setEditando({ id: null })}
        >
          <i className="ti ti-plus" aria-hidden="true" /> Nova nota
        </button>
      )}

      {desfazivel !== null && (
        <p className="notas__desfazer" role="status">
          Nota movida para a lixeira.
          <button
            type="button"
            className="notas__link"
            onClick={async () => {
              await restaurar.mutateAsync(desfazivel)
              setDesfazivel(null)
            }}
          >
            Desfazer
          </button>
        </p>
      )}

      {isLoading && (
        <p className="notas__estado" role="status">
          Carregando…
        </p>
      )}

      {isError && (
        <div className="notas__estado" role="alert">
          <p>Não foi possível carregar suas notas.</p>
          <button type="button" className="notas__link" onClick={() => refetch()}>
            Tentar de novo
          </button>
        </div>
      )}

      {!isLoading && !isError && notas.length === 0 && !editando && (
        <p className="notas__estado">Nenhuma nota sobre este chamado ainda.</p>
      )}

      {notas.length > 0 && (
        <ul className="notas__lista">
          {notas.map((n) => (
            <Cartao
              key={n.id}
              nota={n}
              agoraMs={agoraMs}
              onEditar={() => setEditando({ id: n.id })}
              onExcluir={async () => {
                await excluir.mutateAsync(n.id)
                setDesfazivel(n.id)
              }}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}
