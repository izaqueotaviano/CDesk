import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../hooks';
import { IconClose } from '../icons';
import './Modal.scss';

export type ModalSize = 'sm' | 'md' | 'lg';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Rodapé de ações. A primária fica à direita. */
  footer?: ReactNode;
  size?: ModalSize;
  /** Impede fechar por clique fora e Esc — use só em ação destrutiva. */
  dismissible?: boolean;
}

/** Trava o scroll do body e fecha no Esc enquanto `open`. */
function useLockAndEscape(open: boolean, onClose: () => void, escapable: boolean) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('is-locked');

    const onKey = (e: KeyboardEvent) => {
      if (escapable && e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.body.classList.remove('is-locked');
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, escapable]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  dismissible = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockAndEscape(open, onClose, dismissible);
  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          {dismissible && (
            <button
              type="button"
              className="modal__close"
              aria-label="Fechar"
              onClick={onClose}
            >
              <IconClose className="modal__close-icon" />
            </button>
          )}
        </header>

        <div className="modal__body">{children}</div>

        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export interface DrawerProps extends Omit<ModalProps, 'size'> {
  /** Lado de onde entra. Propriedades de ticket entram pela direita. */
  side?: 'right' | 'left';
  width?: string;
}

/** Painel lateral. Mesma mecânica do Modal, ancoragem diferente. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  side = 'right',
  width,
  dismissible = true,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockAndEscape(open, onClose, dismissible);
  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <div
      className="modal-overlay modal-overlay--drawer"
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`drawer drawer--${side}`}
        style={width ? { width } : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button
            type="button"
            className="modal__close"
            aria-label="Fechar"
            onClick={onClose}
          >
            <IconClose className="modal__close-icon" />
          </button>
        </header>

        <div className="modal__body">{children}</div>

        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export default Modal;
