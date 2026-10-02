import { useId } from 'react'
import { IconDeviceDesktop, IconMoon, IconPalette, IconSun, type Icon } from '@tabler/icons-react'
import { usePrefs, type Tema } from '@/stores/prefs'
import { cn } from '../lib/cn'
import { Secao } from './Secao'

const TEMAS: { valor: Tema; rotulo: string; descricao: string; icone: Icon }[] = [
  { valor: 'claro', rotulo: 'Claro', descricao: 'Fundo claro, sempre.', icone: IconSun },
  { valor: 'escuro', rotulo: 'Escuro', descricao: 'Fundo escuro, sempre.', icone: IconMoon },
  { valor: 'sistema', rotulo: 'Sistema', descricao: 'Acompanha o seu aparelho.', icone: IconDeviceDesktop },
]

/** Miniatura do tema: uma janelinha com barra lateral e três linhas. */
function Miniatura({ tema }: { tema: Tema }) {
  const escuro = tema === 'escuro'
  const fundo = escuro ? 'bg-neutro-900' : 'bg-neutro-50'
  const painel = escuro ? 'bg-neutro-800' : 'bg-white'
  const linha = escuro ? 'bg-neutro-600' : 'bg-neutro-200'
  return (
    <span aria-hidden="true" className={cn('flex h-16 w-full overflow-hidden rounded-lg ', tema === 'sistema' ? 'bg-gradient-to-r from-neutro-50 to-neutro-900' : fundo)}>
      <span className={cn('h-full w-1/4', tema === 'sistema' ? 'bg-white/70' : painel)} />
      <span className="flex flex-1 flex-col gap-1.5 p-2">
        <span className={cn('h-1.5 w-3/4 rounded-total', tema === 'sistema' ? 'bg-neutro-300' : linha)} />
        <span className={cn('h-1.5 w-1/2 rounded-total', tema === 'sistema' ? 'bg-neutro-400' : linha)} />
        <span className="h-1.5 w-1/3 rounded-total bg-acento" />
      </span>
    </span>
  )
}

/**
 * Tema: Claro, Escuro ou Sistema. Aplica na hora e persiste neste
 * navegador (`stores/prefs`) — a mesma escolha do botão do menu.
 */
export function SecaoAparencia() {
  const tema = usePrefs((s) => s.tema)
  const setTema = usePrefs((s) => s.setTema)
  const idRotulo = useId()

  return (
    <Secao id="aparencia" icone={IconPalette} titulo="Aparência" descricao="O tema do portal. A escolha vale para este navegador.">
      <span id={idRotulo} className="sr-only">
        Tema
      </span>
      <div role="radiogroup" aria-labelledby={idRotulo} className="grid gap-3 sm:grid-cols-3">
        {TEMAS.map((t) => {
          const ativo = tema === t.valor
          return (
            <button
              key={t.valor}
              type="button"
              role="radio"
              aria-checked={ativo}
              onClick={() => setTema(t.valor)}
              className={cn(
                'flex flex-col gap-3 rounded-xl border bg-superficie p-3 text-left transition-[border-color] hover:border-borda-controle',
                ativo ? 'border-acento ring-1 ring-acento' : '',
              )}
            >
              <Miniatura tema={t.valor} />
              <span className="flex items-center gap-2">
                <t.icone className={cn('size-4', ativo ? 'text-acento' : 'text-tinta-secundaria')} aria-hidden="true" />
                <span className="min-w-0">
                  <span className={cn('block text-pequeno font-medio', ativo ? 'text-acento' : 'text-tinta')}>{t.rotulo}</span>
                  <span className="block text-legenda text-tinta-secundaria">{t.descricao}</span>
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </Secao>
  )
}
