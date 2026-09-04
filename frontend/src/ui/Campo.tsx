import { type InputHTMLAttributes, forwardRef, useId } from 'react'

interface CampoProps extends InputHTMLAttributes<HTMLInputElement> {
  rotulo: string
  erro?: string
  ajuda?: string
}

/**
 * Erro real via `aria-invalid` + `shadow-erro` (token), não uma classe
 * `.campo--erro` simulada — MIGRATION.md §4.4 pede estado ligado ao
 * atributo. `<label>` de verdade: os protótipos tinham zero <form>/<label>
 * (MIGRATION.md §4.4), e isso é lacuna a corrigir na implementação, não a
 * reproduzir.
 */
export const Campo = forwardRef<HTMLInputElement, CampoProps>(function Campo(
  { rotulo, erro, ajuda, id, className = '', ...props },
  ref,
) {
  const idGerado = useId()
  const inputId = id ?? idGerado
  const ajudaId = ajuda ? `${inputId}-ajuda` : undefined
  const erroId = erro ? `${inputId}-erro` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-pequeno font-medio text-tinta-secundaria">
        {rotulo}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={erro ? true : undefined}
        aria-describedby={[ajudaId, erroId].filter(Boolean).join(' ') || undefined}
        className={`min-h-controle rounded-md border border-borda-controle bg-superficie px-3
          text-corpo text-tinta outline-none transition-shadow duration-padrao ease-padrao
          placeholder:text-tinta-terciaria focus-visible:shadow-foco
          aria-[invalid=true]:border-perigo aria-[invalid=true]:shadow-erro ${className}`}
        {...props}
      />
      {erro ? (
        <p id={erroId} className="text-pequeno text-perigo">
          {erro}
        </p>
      ) : ajuda ? (
        <p id={ajudaId} className="text-pequeno text-tinta-terciaria">
          {ajuda}
        </p>
      ) : null}
    </div>
  )
})
