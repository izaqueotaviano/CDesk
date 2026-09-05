import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-total border px-2.5 py-0.5 text-legenda font-medio leading-normal',
  {
    variants: {
      variant: {
        neutro: 'border-transparent bg-navegacao text-tinta-secundaria',
        acento: 'border-transparent bg-acento-suave text-acento',
        ok: 'border-transparent bg-ok-suave text-ok',
        alerta: 'border-transparent bg-alerta-suave text-alerta',
        perigo: 'border-transparent bg-perigo-suave text-perigo',
        outline: 'border-divisoria bg-transparent text-tinta-secundaria',
      },
    },
    defaultVariants: { variant: 'neutro' },
  },
)

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** Bolinha colorida à esquerda (status). */
  ponto?: boolean
}

export function Badge({ className, variant, ponto, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {ponto && <span className="h-1.5 w-1.5 rounded-total bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
