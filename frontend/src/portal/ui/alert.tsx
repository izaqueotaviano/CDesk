import type { HTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconInfoCircle, type Icon } from '@tabler/icons-react'
import { cn } from '../lib/cn'

/**
 * Fundo pelo tom — e só quando o tom É estado: aviso, erro e sucesso se
 * anunciam no véu da própria cor; informação fica na superfície branca, como
 * um cartão. Sem barra lateral: a borda grossa à esquerda era enfeite, e o
 * ícone colorido já diz o tom.
 */
const alertVariants = cva('flex gap-3 rounded-md p-4 text-corpo', {
  variants: {
    variant: {
      info: 'bg-superficie',
      warning: 'bg-alerta-suave',
      success: 'bg-ok-suave',
      destructive: 'bg-perigo-suave',
    },
  },
  defaultVariants: { variant: 'info' },
})

const COR_ICONE: Record<NonNullable<AlertProps['variant']>, string> = {
  info: 'text-tinta-secundaria',
  warning: 'text-alerta',
  success: 'text-ok',
  destructive: 'text-perigo',
}

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
  /** Botão de fechar (o "×"): fica sempre no canto de cima, também no
   *  celular, em vez de descer para baixo do texto como a `acao`. */
  fechar?: ReactNode
}

/**
 * Faixa de aviso. O ícone recebe a cor DIRETO na própria classe: o seletor
 * `[&_svg]` que estava na faixa alcançava também os ícones dos botões da
 * `acao` — e pintava o "+" do "Abrir ticket" com a cor do fundo do botão.
 */
export function Alert({ className, variant, titulo, acao, fechar, icone, papel, children, ...props }: AlertProps) {
  const Icone = icone ?? ICONE[variant ?? 'info']
  const role = papel ?? (variant === 'destructive' || variant === 'warning' ? 'alert' : 'status')
  return (
    <div role={role} className={cn(alertVariants({ variant }), className)} {...props}>
      <Icone className={cn('mt-0.5 size-5 shrink-0', COR_ICONE[variant ?? 'info'])} stroke={1.75} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          {titulo && <p className="font-medio">{titulo}</p>}
          {children && <div className="text-corpo text-tinta-secundaria">{children}</div>}
        </div>
        {acao && <div className="shrink-0">{acao}</div>}
      </div>
      {fechar && <div className="-my-1 -mr-1 shrink-0 self-start">{fechar}</div>}
    </div>
  )
}
