import { Toaster as Sonner, toast } from 'sonner'
import { usePrefs } from '@/stores/prefs'

/**
 * Toasts do portal (sonner). O tema acompanha a preferência da pessoa —
 * "sistema" deixa o sonner ouvir `prefers-color-scheme` sozinho. Canto
 * inferior direito, o mesmo do Toast do cvz.
 */
export function Toaster() {
  const tema = usePrefs((s) => s.tema)
  return (
    <Sonner
      theme={tema === 'claro' ? 'light' : tema === 'escuro' ? 'dark' : 'system'}
      position="bottom-right"
      closeButton
      richColors
      toastOptions={{
        classNames: {
          toast: 'rounded-md  bg-superficie text-tinta shadow-elevacao-3 font-ui',
          description: 'text-tinta-secundaria',
        },
      }}
    />
  )
}

export { toast }
