import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  IconCircleCheck,
  IconCircleX,
  IconInfo,
  IconTriangleAlert,
  IconClose,
} from '../icons';
import './Toast.scss';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Ação inline — ex.: "Desfazer". Fecha o toast ao ser clicada. */
  action?: { label: string; onClick: () => void };
  /** ms até fechar sozinho. 0 desativa o auto-close. */
  duration?: number;
}

interface ToastItem extends Required<Pick<ToastInput, 'tone' | 'title' | 'duration'>> {
  id: string;
  description?: string;
  action?: ToastInput['action'];
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const ICON: Record<ToastTone, typeof IconInfo> = {
  info: IconInfo,
  success: IconCircleCheck,
  warning: IconTriangleAlert,
  danger: IconCircleX,
};

let seq = 0;

/**
 * Envolva a aplicação uma vez, no topo. `useToast()` dá acesso a `push` em
 * qualquer componente descendente — é a única forma de disparar um toast, não
 * existe `<Toast>` solto para renderizar na tela.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((toast: ToastInput) => {
    const id = `toast-${++seq}`;
    setItems((prev) => [
      ...prev,
      {
        id,
        tone: toast.tone ?? 'info',
        title: toast.title,
        description: toast.description,
        action: toast.action,
        duration: toast.duration ?? 5000,
      },
    ]);
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  return ctx;
}

function ToastViewport({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="toast-viewport" role="region" aria-label="Notificações">
      {items.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = ICON[toast.tone];
  const timerRef = useRef<number | null>(null);

  const arm = useCallback(() => {
    if (toast.duration <= 0) return;
    timerRef.current = window.setTimeout(onDismiss, toast.duration);
  }, [toast.duration, onDismiss]);

  const disarm = useCallback(() => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  // Pausa no hover e no foco — um toast que some enquanto o mouse está em
  // cima dele é o motivo clássico de perder a ação de "Desfazer".
  useEffect(() => {
    arm();
    return disarm;
  }, [arm, disarm]);

  return (
    <div
      className={`toast toast--${toast.tone}`}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={disarm}
      onMouseLeave={arm}
      onFocus={disarm}
      onBlur={arm}
    >
      <Icon className="toast__icon" />
      <div className="toast__body">
        <b className="toast__title">{toast.title}</b>
        {toast.description && <p className="toast__text">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            className="toast__action"
            onClick={() => {
              toast.action!.onClick();
              onDismiss();
            }}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        className="toast__close"
        aria-label="Dispensar"
        onClick={onDismiss}
      >
        <IconClose className="toast__close-icon" />
      </button>
    </div>
  );
}

export default ToastProvider;
