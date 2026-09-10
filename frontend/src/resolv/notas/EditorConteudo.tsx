import { CKEditor } from '@ckeditor/ckeditor5-react'
import {
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  Heading,
  Italic,
  Link,
  List,
  Paragraph,
  Strikethrough,
  Underline,
} from 'ckeditor5'
import 'ckeditor5/ckeditor5.css'
import './editorConteudo.scss'

/**
 * O corpo da nota — editor de texto rico (CKEditor 5), produz HTML.
 *
 * Componente à parte porque tem DOIS lugares que editam o mesmo campo: o
 * editor de tela cheia (`EditorNota.tsx`) e o painel do chamado
 * (`PainelNotas.tsx`). Se cada um tivesse o seu, uma nota formatada num
 * lugar viraria HTML cru visível no outro — o mesmo `content` editado com
 * ferramentas diferentes corrompe, não só destoa.
 *
 * `licenseKey: 'GPL'` é a opção correta para self-hosted sob GPL (não é
 * trial nem chave comercial) — https://ckeditor.com/legal/ckeditor-licensing-options
 *
 * A barra de ferramentas é deliberadamente pequena: só o que
 * `apps.notes.serializers.NoteSerializer.validate_content` deixa passar
 * (o allowlist padrão do `nh3`, sem extensão nenhuma — ver a docstring de
 * lá). Adicionar um botão aqui sem adicionar a tag correspondente no
 * saneamento do backend faria a formatação sumir ao salvar.
 *
 * `data` é só o valor INICIAL — o CKEditor não é um componente controlado
 * (recriar o `data` a cada render não atualiza o texto nem reseta o
 * cursor); é por isso que `EditorNota.tsx` monta este componente com
 * `key={nota.id}`, para trocar de nota remontar do zero.
 */
export function EditorConteudo({
  valor,
  onMudar,
  placeholder,
}: {
  valor: string
  onMudar: (html: string) => void
  placeholder?: string
}) {
  return (
    <div className="editor-conteudo">
      <CKEditor
        editor={ClassicEditor}
        data={valor}
        config={{
          licenseKey: 'GPL',
          plugins: [
            Essentials,
            Paragraph,
            Heading,
            Bold,
            Italic,
            Underline,
            Strikethrough,
            List,
            Link,
            BlockQuote,
          ],
          toolbar: [
            'undo', 'redo', '|',
            'heading', '|',
            'bold', 'italic', 'underline', 'strikethrough', '|',
            'bulletedList', 'numberedList', '|',
            'link', 'blockQuote',
          ],
          placeholder,
        }}
        onChange={(_evento, editor) => onMudar(editor.getData())}
      />
    </div>
  )
}
