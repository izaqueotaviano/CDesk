import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

/**
 * Selo do portal: cápsula de 22px (raio 999 — é pílula, não controle), fundo
 * em véu e texto na cor cheia, para o contraste não depender do ponto. Cor
 * só quando o selo diz ESTADO (ok, alerta, perigo); o resto é neutro.
 */
const badgeVariants = cva(
  'inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-total border border-transparent px-2 text-legenda font-medio leading-none',
  {
    variants: {
      variant: {
        neutro: 'bg-navegacao-ativo text-tinta-secundaria',
        acento: 'bg-acento-suave text-tinta',
        ok: 'bg-ok-suave text-ok',
        alerta: 'bg-alerta-suave text-alerta',
        perigo: 'bg-perigo-suave text-perigo',
        outline: 'border-borda-controle bg-transparent text-tinta-secundaria',
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
