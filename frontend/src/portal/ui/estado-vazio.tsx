import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'

interface Props {
  icone: LucideIcon
  titulo: string
  descricao?: ReactNode
  acao?: ReactNode
  className?: string
}

/** Vazio com nome: por que não há nada aqui e o que a pessoa pode fazer. */
export function EstadoVazio({ icone: Icone, titulo, descricao, acao, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      <span className="grid size-12 place-items-center rounded-total bg-navegacao text-tinta-secundaria">
        <Icone className="size-6" aria-hidden="true" />
      </span>
      <p className="text-corpo-lg font-forte text-tinta">{titulo}</p>
      {descricao && <p className="max-w-md text-pequeno text-tinta-secundaria">{descricao}</p>}
      {acao && <div className="mt-1">{acao}</div>}
    </div>
  )
}
