import { IconHistory } from '@tabler/icons-react'
import { cn } from '../lib/cn'

/**
 * "Rascunho restaurado" — discreto de propósito: é informação, não alerta.
 * A pessoa precisa saber que o texto ali não surgiu do nada, e ter como
 * jogá-lo fora com um clique; mais que isso seria barulho.
 */
export function AvisoDeRascunho({ onDescartar, className }: { onDescartar: () => void; className?: string }) {
  return (
    <p role="status" className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-pequeno text-tinta-secundaria', className)}>
      <IconHistory className="size-4 shrink-0" stroke={1.75} aria-hidden="true" />
      <span>Rascunho restaurado.</span>
      <button
        type="button"
        onClick={onDescartar}
        className="rounded-sm font-medio text-tinta underline decoration-borda-controle underline-offset-2 hover:decoration-current"
      >
        Descartar
      </button>
    </p>
  )
}
