import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * `cn` do shadcn/ui, com o tailwind-merge ensinado sobre a escala de tipo
 * do design system: sem isto, `text-corpo` (tamanho) e `text-tinta` (cor)
 * seriam tratados como duas cores e um deles cairia fora da classe final.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['micro', 'legenda', 'pequeno', 'corpo', 'corpo-lg', 'titulo-sm', 'titulo', 'titulo-lg', 'display'],
        },
      ],
      'font-weight': [{ font: ['normal', 'medio', 'forte'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
