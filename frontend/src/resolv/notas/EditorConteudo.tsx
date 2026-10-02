import { CKEditor } from '@ckeditor/ckeditor5-react'
import {
  Alignment,
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  FontColor,
  Heading,
  Highlight,
  Indent,
  IndentBlock,
  Italic,
  Link,
  List,
  Paragraph,
  RemoveFormat,
  Strikethrough,
  Subscript,
  Superscript,
  TodoList,
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
 * A barra tem uma régua: cada botão aqui tem uma tag/atributo correspondente
 * em `apps.notes.serializers.NoteSerializer.validate_content` (ver a
 * docstring de lá pro porquê de cada allowlist). Adicionar um botão sem
 * adicionar o correspondente no saneamento do backend faria a formatação
 * sumir ao salvar — e cada escolha abaixo tem uma razão pra NÃO estar na
 * lista de "tudo que o CKEditor sabe fazer":
 *
 * - Sem `FontFamily`/`FontSize`: a interface inteira tem escala fechada de
 *   fonte e tamanho (`$fs-*` em cvz/styles/_tokens.scss — "se um tamanho não
 *   está lá, ele não existe no produto"). Deixar a nota escolher fonte e
 *   tamanho livres quebraria essa disciplina bem no lugar onde a pessoa mais
 *   escreve texto corrido.
 * - `Alignment`/`IndentBlock` em CLASSE, não no `style` inline padrão do
 *   CKEditor (`alignment.options`/`indentBlock.classes` abaixo): uma classe
 *   fixa (`align-center`, `indent-2`) é allowlist enumerável no backend; um
 *   `style="text-align:â€¦"` livre exigiria confiar em toda sintaxe de CSS.
 * - `FontColor` usa uma paleta CURADA (as cores do próprio produto — accent,
 *   semânticas, identidade — não um seletor de cor livre): a paleta cita os
 *   tokens reais como `var(--accent)`, então o texto colorido continua
 *   coerente com o tema escuro sozinho, sem duplicar valor por tema.
 * - `Highlight` (marca-texto) em vez de `FontBackgroundColor`: as opções são
 *   uma lista fixa de classes (`marker-yellow` etc.) que o CKEditor já
 *   embute — de novo, allowlist fechada em vez de cor livre no fundo do
 *   texto.
 * - Sem `Image`: sem allowlist de host nem upload, um `<img src>` externo é
 *   pixel de rastreamento — quem abre a nota faz a requisição sem saber (ver
 *   `_TAGS_PERMITIDAS` no backend).
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
            Subscript,
            Superscript,
            RemoveFormat,
            FontColor,
            Highlight,
            List,
            TodoList,
            Alignment,
            Indent,
            IndentBlock,
            Link,
            BlockQuote,
          ],
          toolbar: [
            'undo', 'redo', '|',
            'heading', '|',
            'fontColor', 'highlight', '|',
            'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', '|',
            'removeFormat', '|',
            'bulletedList', 'numberedList', 'todoList', '|',
            'alignment', 'outdent', 'indent', '|',
            'link', 'blockQuote',
          ],
          // Classe fixa, não o `style="text-align:…"` padrão do plugin — ver
          // a nota de allowlist acima. "Definir `className` para uma opção
          // exige definir para todas" (doc do plugin): as quatro entram.
          alignment: {
            options: [
              { name: 'left', className: 'align-left' },
              { name: 'center', className: 'align-center' },
              { name: 'right', className: 'align-right' },
              { name: 'justify', className: 'align-justify' },
            ],
          },
          // Idem para recuo de parágrafo: `classes` troca o `margin-left`
          // livre por três degraus fixos (indent-1/2/3).
          indentBlock: { classes: ['indent-1', 'indent-2', 'indent-3'] },
          // Paleta curada com os tokens do PRÓPRIO produto — não o seletor
          // rgb livre do CKEditor. `var(--accent)` etc. sobrevive ao
          // saneamento (nh3 só valida que é uma declaração `color` bem
          // formada) e continua certo no tema escuro sozinho, porque quem
          // resolve a variável é o navegador de quem lê, não quem escreveu.
          fontColor: {
            colors: [
              { color: 'var(--text-primary)', label: 'Padrão' },
              { color: 'var(--text-secondary)', label: 'Secundário' },
              { color: 'var(--accent)', label: 'Azul' },
              { color: 'var(--danger)', label: 'Vermelho' },
              { color: 'var(--ok)', label: 'Verde' },
              { color: 'var(--away)', label: 'Âmbar' },
              { color: 'var(--identidade-1)', label: 'Violeta' },
              { color: 'var(--identidade-2)', label: 'Petróleo' },
              { color: 'var(--identidade-4)', label: 'Terracota' },
              { color: 'var(--identidade-6)', label: 'Magenta' },
            ],
            columns: 5,
            // Sem histórico de "cores usadas no documento": a paleta fixa
            // acima já É o catálogo — um histórico à parte duplicaria a
            // mesma escolha de dois jeitos diferentes na mesma barra.
            documentColors: 0,
          },
          placeholder,
        }}
        onChange={(_evento, editor) => onMudar(editor.getData())}
      />
    </div>
  )
}
