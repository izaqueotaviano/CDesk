import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { cn } from '../lib/cn'

/**
 * Campo de entrada do portal, calibrado pelo `field` do cvz: 34px, raio
 * único, e a linha PRÓPRIA de campo (`border-borda-campo`, bem mais escura
 * que a estrutural) sempre visível — "campo precisa se anunciar como
 * editável", e em tela de toque não existe hover pra escurecer depois. O
 * foco é o contorno global de tokens.css; aqui só a borda vira acento.
 */
const base =
  'w-full rounded-md border border-borda-campo bg-superficie text-[13px] text-tinta transition-[border-color] placeholder:text-tinta-terciaria hover:border-tinta-secundaria focus-visible:border-acento disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-perigo'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, 'h-[34px] px-3', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(base, 'min-h-[96px] resize-y px-3 py-2 leading-normal', className)} {...props} />
  },
)

/** `<select>` nativo com a mesma moldura — no celular abre o seletor do sistema. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <span className="relative block">
      <select ref={ref} className={cn(base, 'h-[34px] appearance-none pl-3 pr-9', className)} {...props}>
        {children}
      </select>
      <IconChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-tinta-secundaria"
        aria-hidden="true"
      />
    </span>
  )
})

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-pequeno font-medio text-tinta', className)} {...props} />
}

export function Ajuda({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-legenda text-tinta-secundaria', className)} {...props} />
}

export function ErroCampo({ id, children }: { id?: string; children?: React.ReactNode }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="text-legenda text-perigo">
      {children}
    </p>
  )
}
