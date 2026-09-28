import { type ButtonHTMLAttributes, forwardRef } from 'react'

type Variante = 'primario' | 'secundario' | 'fantasma' | 'perigo'

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante
}

// Elevação é cor de superfície, não sombra (PROMPT-IMPLEMENTACAO.md) — nenhum
// destes tem box-shadow de repouso; só o anel de foco (`shadow-foco`, do
// tailwind.config.cjs) usa sombra, e só em :focus-visible.
const CLASSES_POR_VARIANTE: Record<Variante, string> = {
  primario: 'bg-primario text-primario-sobre hover:bg-primario-hover active:brightness-95',
  secundario:
    'bg-superficie text-tinta border border-borda-controle hover:bg-hover active:bg-ativo',
  fantasma: 'bg-transparent text-tinta hover:bg-hover active:bg-ativo',
  perigo: 'bg-perigo text-acento-sobre hover:brightness-95 active:brightness-90',
}

/**
 * Verbo no infinitivo, sem ponto final (DESIGN_SYSTEM.md §7 — voz e tom).
 * `disabled` é o atributo NATIVO do <button> — não uma classe simulada
 * (MIGRATION.md §6: "um <button disabled> real não vai receber a classe").
 */
export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = 'primario', className = '', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex min-h-controle items-center justify-center gap-2 rounded-md
        px-4 text-corpo font-medio transition-[filter,background-color] duration-padrao
        ease-padrao disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:shadow-foco ${CLASSES_POR_VARIANTE[variante]} ${className}`}
      {...props}
    />
  )
})
