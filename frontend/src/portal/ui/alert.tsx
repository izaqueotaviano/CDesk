import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '../lib/cn'

const alertVariants = cva('flex gap-3 rounded-xl border p-4 text-corpo [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0', {
  variants: {
    variant: {
      info: 'border-acento/20 bg-acento-suave text-tinta [&_svg]:text-acento',
      warning: 'border-alerta/30 bg-alerta-suave text-tinta [&_svg]:text-alerta',
      success: 'border-ok/30 bg-ok-suave text-tinta [&_svg]:text-ok',
      destructive: 'border-perigo/30 bg-perigo-suave text-tinta [&_svg]:text-perigo',
    },
  },
  defaultVariants: { variant: 'info' },
})

const ICONE = { info: Info, warning: AlertTriangle, success: CheckCircle2, destructive: XCircle }

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  titulo?: ReactNode
  /** Botão/link à direita (ou embaixo, no celular). */
  acao?: ReactNode
}

export function Alert({ className, variant, titulo, acao, children, ...props }: AlertProps) {
  const Icone = ICONE[variant ?? 'info']
  return (
    <div role={variant === 'destructive' || variant === 'warning' ? 'alert' : 'status'} className={cn(alertVariants({ variant }), className)} {...props}>
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
