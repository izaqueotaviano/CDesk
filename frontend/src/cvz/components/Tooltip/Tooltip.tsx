import type { ReactNode } from 'react';
import './Tooltip.scss';

export type TooltipSide = 'right' | 'top' | 'bottom';

export interface TooltipProps {
  label: string;
  side?: TooltipSide;
  children: ReactNode;
}

/**
 * Tooltip por CSS: aparece no hover e no foco do elemento envolvido, sem estado
 * em JS. O filho precisa ser focável (button, a, input) para funcionar por
 * teclado — e um controle que precisa de tooltip já deveria ser focável.
 */
export function Tooltip({ label, side = 'right', children }: TooltipProps) {
  return (
    <span className={`tooltip tooltip--${side}`}>
      {children}
      <span className="tooltip__bubble" role="tooltip">
        {label}
      </span>
    </span>
  );
}

export default Tooltip;
