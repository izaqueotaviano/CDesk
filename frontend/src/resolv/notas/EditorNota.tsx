import { useState } from 'react'
import { useAcoesNota, useNota, type Nota } from '@/api/notas'
import { useAutosave, type EstadoSalvamento, type ValoresNota } from './autosave'
import { EditorConteudo } from './EditorConteudo'

const TITULO_MAX = 200

const RECADO: Record<EstadoSalvamento, string> = {
  ocioso: '',
  pendente: 'Alterações não salvas…',
  salvando: 'Salvando…',
  salvo: 'Salvo',
  erro: 'Não foi possível salvar',
}

/** "urgente, cliente" → ["urgente", "cliente"]. O vazio depois da última
 *  vírgula é descartado pelo backend, então digitar a vírgula e pensar no
 *  próximo nome não derruba o salvamento. */
function separar(texto: string): string[] {
  return texto.split(',').map((t) => t.trim()).filter(Boolean)
}

function Campos({ nota }: { nota: Nota }) {
  const [title, setTitle] = useState(nota.title)
  const [content, setContent] = useState(nota.content)
  const [etiquetas, setEtiquetas] = useState(nota.tags.map((t) => t.name).join(', '))

  const valores: ValoresNota = { title, content, tagNames: separar(etiquetas) }
  const inicial: ValoresNota = {
    title: nota.title,
    content: nota.content,
    tagNames: nota.tags.map((t) => t.name),
  }
  const { estado, salvarAgora } = useAutosave({ notaId: nota.id, valores, inicial })

  return (
    <div className="editor-nota">
      <input
        className="editor-nota__titulo"
        aria-label="Título da nota"
        placeholder="Sem título"
        maxLength={TITULO_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="editor-nota__meta">
        <label className="editor-nota__etiquetas">
          <span className="editor-nota__rotulo">Etiquetas</span>
          <input
            aria-label="Etiquetas da nota"
            placeholder="separadas por vírgula"
            value={etiquetas}
            onChange={(e) => setEtiquetas(e.target.value)}
          />
        </label>
        {nota.ticket_reference && (
          <a className="editor-nota__chamado" href={`/chamados/${nota.ticket}`}>
            <i className="ti ti-ticket" aria-hidden="true" />
            {nota.ticket_reference}
            {nota.ticket_subject ? ` — ${nota.ticket_subject}` : ''}
          </a>
        )}
      </div>

      <EditorConteudo valor={content} onMudar={setContent} placeholder="Escreva aqui." />

      <p
        className={'editor-nota__estado' + (estado === 'erro' ? ' editor-nota__estado--erro' : '')}
        role={estado === 'erro' ? 'alert' : 'status'}
      >
        {RECADO[estado]}
        {estado === 'erro' && (
          <button type="button" className="notas-pg__link" onClick={salvarAgora}>
            Tentar de novo
          </button>
        )}
      </p>
    </div>
  )
}

/**
 * Editor de uma nota, com autosave.
 *
 * `Campos` é um componente à parte, montado com `key={id}`, porque o texto é
 * estado LOCAL semeado pela nota carregada: sem a troca de key, abrir outra
 * nota manteria o texto da anterior na tela (e o autosave a gravaria na nota
 * errada). Trocar a key desmonta o anterior, o que também dispara a gravação
 * de saída do que ainda estava na janela do debounce.
 */
export function EditorNota({ notaId }: { notaId: number }) {
  const { data: nota, isLoading, isError, refetch } = useNota(notaId)
  const { restaurar } = useAcoesNota()

  if (isLoading) {
    return (
      <p className="notas-pg__estado" role="status">
        Abrindo a nota…
      </p>
    )
  }
  if (isError || !nota) {
    return (
      <div className="notas-pg__estado" role="alert">
        <p>Não foi possível abrir a nota.</p>
        <button type="button" className="notas-pg__link" onClick={() => refetch()}>
          Tentar de novo
        </button>
      </div>
    )
  }

  // Nota na lixeira é só leitura: editar o que a pessoa mandou apagar seria
  // ressuscitá-la pela porta dos fundos. Restaura primeiro, edita depois.
  if (nota.is_deleted) {
    return (
      <div className="editor-nota editor-nota--lixeira">
        <h2 className="editor-nota__titulo-lido">{nota.title}</h2>
        <p className="editor-nota__aviso">
          Esta nota está na lixeira. Restaure para poder editar.
          <button
            type="button"
            className="notas-pg__botao"
            onClick={() => restaurar.mutate(nota.id)}
            disabled={restaurar.isPending}
          >
            Restaurar
          </button>
        </p>
        {/* O corpo vem saneado do SERVIDOR (`nh3`, em
         *  `NoteSerializer.validate_content` — na ESCRITA, não na leitura,
         *  mas o resultado guardado já está limpo). Sanear de novo aqui
         *  seria uma segunda régua para discordar da primeira — mesmo
         *  raciocínio de `portal/ajuda/PaginaArtigo.tsx` para o artigo da
         *  central de ajuda. */}
        <div
          className="editor-nota__corpo-lido"
          dangerouslySetInnerHTML={{ __html: nota.content }}
        />
      </div>
    )
  }

  return <Campos key={nota.id} nota={nota} />
}
