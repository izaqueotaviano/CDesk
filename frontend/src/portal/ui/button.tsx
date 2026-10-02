import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

/**
 * Botão do portal, na linguagem do produto (a referência é o Copilot): raio
 * de 8px (controle), 36px de altura (28 no `sm`, 40 no `lg`), texto de 14px
 * em peso 500, sem sombra. O foco é o contorno global de tokens.css — nada
 * aqui desenha anel próprio.
 *
 * Os ícones são dimensionados só quando são FILHOS DIRETOS (`[&>svg]`), não
 * qualquer svg lá dentro: o seletor de descendente era o que deixava um
 * componente-pai (a faixa de aviso) repintar o ícone do botão — o "+" do
 * "Abrir ticket" sumia porque saía com a cor do próprio fundo.
 *
 * Variantes: `default` é o primário (carvão no claro, claro no escuro — o
 * ÚNICO acento do produto); `secondary`/`outline` são o degrau abaixo, sem
 * fundo e com a linha de campo (3:1 nos dois temas: o contorno é o que diz
 * "isto é um botão"), que se lê tanto sobre o plano quanto
 * dentro de um cartão branco; `ghost` é ação de apoio; `inverse` é o enviar
 * do composer; `destructive` pinta com o tom de perigo e escreve com a
 * superfície (branco no claro, grafite no escuro — o vermelho claro do tema
 * escuro não aguenta texto branco).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-transparent font-medio transition-[background-color,color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primario text-primario-sobre hover:bg-primario-hover',
        secondary: 'border-borda-campo bg-transparent text-tinta hover:bg-[var(--fundo-hover)]',
        outline: 'border-borda-campo bg-transparent text-tinta hover:bg-[var(--fundo-hover)]',
        ghost: 'text-tinta-secundaria hover:bg-[var(--fundo-hover)] hover:text-tinta',
        inverse: 'bg-tinta text-superficie hover:opacity-90',
        destructive: 'bg-perigo text-superficie hover:brightness-95',
        link: 'text-tinta underline decoration-borda-controle underline-offset-2 hover:decoration-current',
      },
      size: {
        default: 'h-[36px] px-3.5 text-corpo',
        sm: 'h-7 px-2.5 text-pequeno',
        lg: 'h-10 px-4 text-corpo',
        icon: 'h-[36px] w-[36px]',
        'icon-sm': 'h-7 w-7',
      },
    },
    // `link` é texto inline: nenhum tamanho pode lhe dar caixa de botão.
    // Antes `size` vinha DEPOIS na string e o tailwind-merge fazia h-8/px-3
    // vencerem o h-auto/px-0 do variant (achado da auditoria).
    compoundVariants: [{ variant: 'link', className: 'h-auto border-0 px-0' }],
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
})

export { buttonVariants }
