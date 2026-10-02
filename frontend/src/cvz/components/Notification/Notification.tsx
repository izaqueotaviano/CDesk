import type { ReactNode } from 'react';
import { IconClose } from '../icons';
import './Notification.scss';

export type NotificationTone = 'info' | 'success' | 'warning' | 'danger';

export interface NotificationProps {
  tone?: NotificationTone;
  title: string;
  children?: ReactNode;
  onDismiss?: () => void;
}

/**
 * Aviso inline, ancorado no fluxo da página. Para feedback efêmero de uma ação,
 * use o mesmo componente dentro de um container fixo — não há variante toast
 * separada.
 */
export function Notification({
  tone = 'info',
  title,
  children,
  onDismiss,
}: NotificationProps) {
  return (
    <div className={`notification notification--${tone}`} role="status">
      <div className="notification__body">
        <b className="notification__title">{title}</b>
        {/* div, não p: o corpo do aviso às vezes é uma lista, e um <ul>
            dentro de <p> é inválido — o navegador fecha o parágrafo sozinho
            e o texto seguinte escapa do bloco. */}
        {children && <div className="notification__text">{children}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="notification__close"
          aria-label="Dispensar"
          onClick={onDismiss}
        >
          <IconClose className="notification__close-icon" />
        </button>
      )}
    </div>
  );
}

export default Notification;
