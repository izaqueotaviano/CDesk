import type { CSSProperties, HTMLAttributes } from 'react'

interface PilulaProps extends HTMLAttributes<HTMLSpanElement> {
  /** Cor vinda do banco (etapa do quadro) — nunca uma paleta fixa no CSS.
   *  Ex.: `stage_color` de `TicketList`. */
  cor: string
  texto: string
}

/**
 * A pílula mostra a ETAPA, não um status fixo — não existe paleta de status
 * no CSS deste sistema (DESIGN_SYSTEM.md/LEIA-ME do protótipo). A cor é
 * sempre injetada via `--etapa`; a correção de contraste por tema mora em
 * `.pilula--etapa` (src/styles/index.css), não aqui.
 */
export function Pilula({ cor, texto, className = '', style, ...props }: PilulaProps) {
  return (
    <span
      className={`pilula--etapa inline-flex items-center gap-1.5 rounded-total border
        border-current px-2.5 py-0.5 text-legenda font-medio ${className}`}
      style={{ '--etapa': cor, ...style } as CSSProperties}
      {...props}
    >
      {texto}
    </span>
  )
}
