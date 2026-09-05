import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../lib/cn'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medio transition-[background-color,color,box-shadow,filter] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-acento text-acento-sobre shadow-elevacao-1 hover:brightness-110',
        secondary: 'border border-divisoria bg-superficie text-tinta shadow-elevacao-1 hover:bg-navegacao',
        outline: 'border border-divisoria bg-transparent text-tinta hover:bg-navegacao',
        ghost: 'text-tinta-secundaria hover:bg-navegacao hover:text-tinta',
        destructive: 'bg-perigo text-white hover:brightness-110',
        link: 'h-auto px-0 text-acento underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 text-corpo',
        sm: 'h-8 px-3 text-pequeno',
        lg: 'h-11 px-6 text-corpo-lg',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
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
