import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './Popover.scss';

export interface PopoverProps {
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
    id: string;
  }) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: 'start' | 'end';
  /** Controle externo — para o trigger decidir quando abrir/fechar também. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Superfície flutuante genérica: fecha no clique fora e no Esc, mesma posição
 * e camada em todo o produto (`@include popover`). `Menu` é este componente
 * mais uma lista de itens com teclado — quando o conteúdo é livre (um
 * mini-formulário, um seletor de cor), use `Popover` direto.
 */
export function Popover({
  trigger,
  children,
  align = 'start',
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className="popover" ref={wrapRef}>
      {trigger({
        onClick: () => setOpen(!open),
        'aria-expanded': open,
        id,
      })}
      {open && (
        <div className={`popover__panel popover__panel--${align}`} aria-labelledby={id}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export default Popover;
