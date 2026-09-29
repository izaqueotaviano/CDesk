import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle, type Icon } from '@tabler/icons-react'
import { cn } from '../lib/cn'

const alertVariants = cva(
  'flex gap-3 rounded-md border border-l-2 bg-superficie p-4 text-corpo [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        info: ' border-l-acento [&_svg]:text-acento',
        warning: ' border-l-alerta [&_svg]:text-alerta',
        success: ' border-l-ok [&_svg]:text-ok',
        destructive: ' border-l-perigo [&_svg]:text-perigo',
      },
    },
    defaultVariants: { variant: 'info' },
  },
)

const ICONE: Record<NonNullable<AlertProps['variant']>, Icon> = {
  info: IconInfoCircle,
  warning: IconAlertTriangle,
  success: IconCircleCheck,
  destructive: IconCircleX,
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  titulo?: ReactNode
  /** Botão/link à direita (ou embaixo, no celular). */
  acao?: ReactNode
  /** Troca o ícone padrão da variante (ex.: calendário num aviso de feriado). */
  icone?: Icon
  /**
   * `alert` interrompe o leitor de tela; é o certo pra erro e pra aviso que
   * exige ação, não pra informação de fundo (feriado, férias) — essas ficam
   * em `status`. Padrão: `alert` só em `destructive`/`warning`.
   */
  papel?: 'alert' | 'status'
}

/**
 * Faixa de aviso, no desenho do `.aviso` do console: superfície branca com
 * a linha estrutural e uma barra de 2px na esquerda dizendo o tom — sem
 * fundo colorido inteiro, que pesava ao lado dos cartões.
 */
export function Alert({ className, variant, titulo, acao, icone, papel, children, ...props }: AlertProps) {
  const Icone = icone ?? ICONE[variant ?? 'info']
  const role = papel ?? (variant === 'destructive' || variant === 'warning' ? 'alert' : 'status')
  return (
    <div role={role} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icone aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          {titulo && <p className="font-medio">{titulo}</p>}
          {children && <div className="text-pequeno text-tinta-secundaria">{children}</div>}
        </div>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
    </div>
  )
}
