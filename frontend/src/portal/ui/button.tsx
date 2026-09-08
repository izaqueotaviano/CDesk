import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

/**
 * Botão do portal, calibrado pelo `.btn` do cvz (cvz/components/Button):
 * 34px de altura (28 no `sm`, 40 no `lg`), raio único, sem sombra, texto de
 * 13px em peso 500. O foco é o contorno global de tokens.css — nada aqui
 * desenha anel próprio.
 *
 * Variantes casam com as do console: `default` é o primário (azul de ação,
 * escurece no hover em vez de clarear), `secondary` é o terciário do cvz
 * (superfície + linha), `inverse` é o botão de enviar do composer (pinta com
 * o token de texto, escreve com o de superfície — `.cc-composer__enviar`).
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medio transition-[background-color,color,border-color] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-acento text-acento-sobre hover:bg-acento-hover',
        secondary: 'border-divisoria bg-superficie text-tinta hover:border-tinta-terciaria hover:bg-navegacao',
        outline: 'border-divisoria bg-transparent text-tinta hover:bg-navegacao',
        ghost: 'text-tinta-secundaria hover:bg-navegacao hover:text-tinta',
        inverse: 'bg-tinta text-superficie hover:opacity-90',
        destructive: 'bg-perigo text-white hover:brightness-90',
        link: 'text-acento underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-[34px] px-3 text-[13px]',
        sm: 'h-7 px-2 text-pequeno',
        lg: 'h-10 px-4 text-corpo',
        icon: 'h-[34px] w-[34px]',
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
