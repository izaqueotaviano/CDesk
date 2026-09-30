import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { IconCheck, IconEye, IconEyeOff } from '@tabler/icons-react'
import { cn } from '@/portal/lib/cn'
import { Input } from '@/portal/ui/input'
import type { RegraDaSenha } from './senha'

/** A lista que acende conforme a pessoa digita. Cor só para o estado
 *  (cumprida / pendente), e o ícone repete a informação para quem não
 *  distingue a cor. */
export function ListaDeRegras({ id, regras }: { id: string; regras: RegraDaSenha[] }) {
  return (
    <ul id={id} className="flex flex-col gap-1.5" aria-label="Requisitos da senha">
      {regras.map((r) => (
        <li key={r.id} className={cn('flex items-start gap-2 text-pequeno', r.ok ? 'text-ok' : 'text-tinta-secundaria')}>
          <span
            className={cn(
              'mt-px grid size-4 shrink-0 place-items-center rounded-total border',
              r.ok ? 'border-ok bg-ok text-superficie' : 'border-borda-campo',
            )}
            aria-hidden="true"
          >
            {r.ok && <IconCheck className="size-3" stroke={3} />}
          </span>
          <span>
            {r.texto}
            <span className="sr-only">{r.ok ? ': cumprido' : ': pendente'}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Campo de senha com o botão de mostrar/ocultar, na medida do login. */
export const CampoSenha = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function CampoSenha(
  { className, ...props },
  ref,
) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visivel ? 'text' : 'password'}
        className={cn('login-campo h-11 pr-11 text-corpo focus-visible:border-borda-campo', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisivel((v) => !v)}
        className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-tinta-secundaria hover:bg-navegacao hover:text-tinta"
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        aria-pressed={visivel}
      >
        {visivel ? <IconEyeOff className="size-4" aria-hidden="true" /> : <IconEye className="size-4" aria-hidden="true" />}
      </button>
    </div>
  )
})
