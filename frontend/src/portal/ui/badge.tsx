import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

/**
 * Selo do portal, calibrado pelo `.tag` do cvz: 22px de altura, raio único
 * (a cápsula de 999px saiu — "cápsula ao lado de botão/campo quadrado
 * quebrava a leitura de mesma família", cvz/styles/_tokens.scss), fundo em
 * tint e texto na cor cheia, pra o contraste não depender do ponto.
 */
const badgeVariants = cva(
  'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-2 text-legenda font-medio leading-none',
  {
    variants: {
      variant: {
        neutro: 'border-divisoria bg-navegacao text-tinta-secundaria',
        acento: 'bg-acento-suave text-acento',
        ok: 'bg-ok-suave text-ok',
        alerta: 'bg-alerta-suave text-alerta',
        perigo: 'bg-perigo-suave text-perigo',
        outline: 'border-current bg-transparent text-tinta-secundaria',
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
      {ponto && <span className="h-1.5 w-1.5 shrink-0 rounded-total bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
