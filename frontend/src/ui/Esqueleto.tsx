interface EsqueletoProps {
  variante?: 'texto' | 'bloco' | 'avatar'
  className?: string
}

// Nomes de variante seguem a recomendação de MIGRATION.md §"Duplicatas a
// fundir": "esqueleto--texto, esqueleto--bloco, esqueleto--avatar".
const CLASSES_POR_VARIANTE: Record<NonNullable<EsqueletoProps['variante']>, string> = {
  texto: 'h-[1em] rounded-sm',
  bloco: 'h-24 rounded-md',
  avatar: 'h-8 w-8 rounded-total',
}

export function Esqueleto({ variante = 'texto', className = '' }: EsqueletoProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block animate-pulse bg-esqueleto ${CLASSES_POR_VARIANTE[variante]} ${className}`}
    />
  )
}
