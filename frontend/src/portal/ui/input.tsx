import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../lib/cn'

const base =
  'w-full rounded-lg border border-divisoria bg-superficie text-corpo text-tinta shadow-elevacao-1 transition-[border-color,box-shadow] placeholder:text-tinta-terciaria hover:border-borda-controle focus-visible:border-acento focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/30 disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-perigo aria-[invalid=true]:focus-visible:ring-perigo/30'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(base, 'h-10 px-3', className)} {...props} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(base, 'min-h-[96px] resize-y px-3 py-2.5 leading-normal', className)} {...props} />
  },
)

/** `<select>` nativo com a mesma moldura — no celular abre o seletor do sistema. */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <span className="relative block">
      <select ref={ref} className={cn(base, 'h-10 appearance-none pl-3 pr-9', className)} {...props}>
        {children}
      </select>
      <ChevronDown
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
