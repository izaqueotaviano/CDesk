import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { IconFileText, IconPaperclip, IconUpload, IconX } from '@tabler/icons-react'
import { cn } from '../lib/cn'
import { tamanhoArquivo } from '../lib/formato'
import { Button } from '../ui/button'
import { arquivosArrastados, temArquivo, TIPOS_ACEITOS_PORTAL, type AnexoLocal } from './anexos'

/**
 * Área que aceita arquivo solto em cima. Envolve o formulário inteiro (e não
 * só um quadradinho "solte aqui"): quem arrasta um print mira o campo de
 * texto, e errar o alvo por alguns pixels não pode abrir o arquivo no
 * navegador e jogar fora o que estava escrito.
 *
 * O contador existe porque `dragenter`/`dragleave` disparam a cada filho
 * atravessado — sem ele a faixa piscaria ao passar por cima do texto.
 */
export function ZonaDeSoltar({
  onArquivos,
  children,
  className,
  desabilitada = false,
}: {
  onArquivos: (arquivos: File[]) => void
  children: ReactNode
  className?: string
  desabilitada?: boolean
}) {
  const [arrastando, setArrastando] = useState(false)
  const profundidade = useRef(0)

  function entrar(e: DragEvent) {
    if (desabilitada || !temArquivo(e.dataTransfer)) return
    e.preventDefault()
    profundidade.current += 1
    setArrastando(true)
  }
  function sobre(e: DragEvent) {
    if (desabilitada || !temArquivo(e.dataTransfer)) return
    // sem o preventDefault no dragover o navegador não deixa soltar
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  function sair(e: DragEvent) {
    if (desabilitada || !temArquivo(e.dataTransfer)) return
    profundidade.current = Math.max(0, profundidade.current - 1)
    if (profundidade.current === 0) setArrastando(false)
  }
  function soltar(e: DragEvent) {
    if (desabilitada || !temArquivo(e.dataTransfer)) return
    e.preventDefault()
    profundidade.current = 0
    setArrastando(false)
    onArquivos(arquivosArrastados(e.dataTransfer))
  }

  return (
    <div
      className={cn('relative', className)}
      onDragEnter={entrar}
      onDragOver={sobre}
      onDragLeave={sair}
      onDrop={soltar}
    >
      {children}
      {arrastando && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-md border border-dashed border-tinta-secundaria bg-superficie"
        >
          <span className="inline-flex items-center gap-2 text-corpo font-medio text-tinta">
            <IconUpload className="size-5" stroke={1.75} /> Solte para anexar
          </span>
        </div>
      )}
    </div>
  )
}

/** "Anexar" + o seletor do sistema, com o `accept` dos tipos do servidor. */
export function BotaoAnexar({ onArquivos, disabled }: { onArquivos: (arquivos: File[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={disabled}>
        <IconPaperclip /> Anexar
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={TIPOS_ACEITOS_PORTAL}
        aria-label="Escolher arquivos"
        onChange={(e) => {
          onArquivos(Array.from(e.target.files ?? []))
          // limpa para o mesmo arquivo poder ser escolhido de novo depois de removido
          e.target.value = ''
        }}
      />
    </>
  )
}

/** O que vai junto, antes de ir: miniatura de imagem, nome, tamanho, remover. */
export function ListaDeAnexos({ anexos, onRemover }: { anexos: AnexoLocal[]; onRemover: (id: string) => void }) {
  if (anexos.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Anexos a enviar">
      {anexos.map(({ id, arquivo, previa }) => (
        <li key={id} className="flex max-w-full items-center gap-2 rounded-sm bg-navegacao py-1 pl-1 pr-1.5">
          {previa ? (
            <img src={previa} alt="" className="size-10 shrink-0 rounded-sm object-cover" />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-superficie text-tinta-secundaria">
              <IconFileText className="size-5" stroke={1.75} aria-hidden="true" />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="max-w-[180px] truncate text-pequeno font-medio text-tinta" title={arquivo.name}>
              {arquivo.name}
            </span>
            <span className="text-legenda text-tinta-secundaria">{tamanhoArquivo(arquivo.size)}</span>
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remover ${arquivo.name}`}
            title="Remover"
            onClick={() => onRemover(id)}
          >
            <IconX />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** Por que um arquivo ficou de fora — um motivo por linha, com o número. */
export function RecusasDeAnexo({ recusas }: { recusas: string[] }) {
  if (recusas.length === 0) return null
  return (
    <ul role="alert" className="flex flex-col gap-0.5 text-pequeno text-perigo">
      {recusas.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  )
}
