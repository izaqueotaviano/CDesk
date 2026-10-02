import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import './Toast.scss';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * Por que o toast saiu da tela — é o que separa "a pessoa desfez" de "o
 * tempo acabou" para quem adia uma ação atrás de um "Desfazer":
 *
 * - `action`: clicou no botão de ação (ex.: "Desfazer");
 * - `dismiss`: fechou no X ou com Esc;
 * - `timeout`: o prazo venceu (pausado enquanto o ponteiro/foco está nele);
 * - `programmatic`: quem abriu fechou por código (`dismiss(id)`), ou o
 *   provider saiu da tela com o toast aberto.
 */
export type ToastCloseReason = 'action' | 'dismiss' | 'timeout' | 'programmatic';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  description?: string;
  /** Ação inline — ex.: "Desfazer". Fecha o toast ao ser clicada. */
  action?: { label: string; onClick: () => void };
  /** ms até fechar sozinho. 0 desativa o auto-close. */
  duration?: number;
  /**
   * Chamado UMA vez, quando o toast sai da tela, com o motivo. É o gancho do
   * "desfazer em vez de confirmar": quem adia a ação grava de verdade quando
   * o motivo não é `action`.
   */
  onClose?: (reason: ToastCloseReason) => void;
}

interface ToastItem extends Required<Pick<ToastInput, 'tone' | 'title' | 'duration'>> {
  id: string;
  description?: string;
  action?: ToastInput['action'];
  onClose?: ToastInput['onClose'];
}

interface ToastContextValue {
  push: (toast: ToastInput) => string;
  /** Fecha por código — `onClose` recebe `programmatic`. Id que já saiu é ignorado. */
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Tabler, como o resto do produto (subset em assets/icones) — a mesma família
// que a tela em volta usa, em vez dos SVGs reconstruídos do cvz.
const ICON: Record<ToastTone, string> = {
  info: 'ti ti-info-circle',
  success: 'ti ti-circle-check',
  warning: 'ti ti-alert-triangle',
  danger: 'ti ti-circle-x',
};

let seq = 0;

/**
 * Envolva a aplicação uma vez, no topo. `useToast()` dá acesso a `push` em
 * qualquer componente descendente — é a única forma de disparar um toast, não
 * existe `<Toast>` solto para renderizar na tela.
 *
 * Providers ANINHADOS funcionam: o console (NovoShell) tem o seu e as telas
 * cvz (SuperficieCvz) continuam com o delas por dentro. `useToast()` pega o
 * mais próximo, e cada um desenha só os próprios toasts.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  // Espelho síncrono de `items` para `fechar` achar o toast (e o `onClose`
  // dele) sem efeito colateral dentro do updater do setState — que o
  // StrictMode roda duas vezes e dispararia o `onClose` em dobro.
  const vivos = useRef(new Map<string, ToastItem>());

  const fechar = useCallback((id: string, reason: ToastCloseReason) => {
    const item = vivos.current.get(id);
    if (!item) return; // já saiu: fechar duas vezes é inofensivo
    vivos.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
    item.onClose?.(reason);
  }, []);

  const dismiss = useCallback((id: string) => fechar(id, 'programmatic'), [fechar]);

  const push = useCallback((toast: ToastInput) => {
    const id = `toast-${++seq}`;
    const item: ToastItem = {
      id,
      tone: toast.tone ?? 'info',
      title: toast.title,
      description: toast.description,
      action: toast.action,
      duration: toast.duration ?? 5000,
      onClose: toast.onClose,
    };
    vivos.current.set(id, item);
    setItems((prev) => [...prev, item]);
    return id;
  }, []);

  // Provider saindo da tela com toast aberto (a rota trocou de superfície):
  // o toast some junto, e quem esperava o `onClose` precisa saber.
  useEffect(() => {
    const mapa = vivos.current;
    return () => {
      const restantes = [...mapa.values()];
      mapa.clear();
      restantes.forEach((t) => t.onClose?.('programmatic'));
    };
  }, []);

  const valor = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <ToastViewport items={items} onClose={fechar} />
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
  onClose,
}: {
  items: ToastItem[];
  onClose: (id: string, reason: ToastCloseReason) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div className="toast-viewport" role="region" aria-label="Notificações">
      {items.map((t) => (
        <ToastCard key={t.id} toast={t} onClose={(reason) => onClose(t.id, reason)} />
      ))}
    </div>
  );
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: ToastItem;
  onClose: (reason: ToastCloseReason) => void;
}) {
  const timerRef = useRef<number | null>(null);
  // Quanto falta, não quanto durava: pausar no hover e voltar com o prazo
  // INTEIRO dava tempo a mais a cada passada do mouse — e a barra de tempo
  // (que só pausa) deixava de bater com o relógio de verdade.
  const restanteRef = useRef(toast.duration);
  const armadoEmRef = useRef(0);
  const [pausado, setPausado] = useState(false);
  // `onClose` chega como função nova a cada render do viewport; o relógio
  // não pode religar por isso, então lê sempre a mais recente por ref.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  const arm = useCallback(() => {
    if (toast.duration <= 0 || timerRef.current !== null) return;
    armadoEmRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onCloseRef.current('timeout');
    }, restanteRef.current);
  }, [toast.duration]);

  const disarm = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
    restanteRef.current = Math.max(0, restanteRef.current - (Date.now() - armadoEmRef.current));
  }, []);

  const pausar = () => {
    disarm();
    setPausado(true);
  };
  const retomar = () => {
    arm();
    setPausado(false);
  };

  // Pausa no hover e no foco — um toast que some enquanto o mouse está em
  // cima dele é o motivo clássico de perder a ação de "Desfazer".
  useEffect(() => {
    arm();
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [arm]);

  const comTempo = toast.duration > 0 && toast.action !== undefined;

  return (
    <div
      className={`toast toast--${toast.tone}` + (pausado ? ' toast--pausado' : '')}
      role={toast.tone === 'danger' ? 'alert' : 'status'}
      onMouseEnter={pausar}
      onMouseLeave={(e) => {
        // o foco ainda está num botão do toast: continua pausado
        if (!e.currentTarget.contains(document.activeElement)) retomar();
      }}
      onFocus={pausar}
      onBlur={(e) => {
        // foco andando DENTRO do toast (ação → fechar) não religa o relógio
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) retomar();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose('dismiss');
        }
      }}
    >
      <i className={`${ICON[toast.tone]} toast__icon`} aria-hidden="true" />
      <div className="toast__body">
        <b className="toast__title">{toast.title}</b>
        {toast.description && <p className="toast__text">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            toast.action!.onClick();
            onClose('action');
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast__close"
        aria-label="Dispensar"
        onClick={() => onClose('dismiss')}
      >
        <i className="ti ti-x" aria-hidden="true" />
      </button>
      {comTempo && (
        // Quanto tempo resta para a ação — decorativo (o leitor de tela já
        // ouviu o título e o botão), pausa junto com o relógio.
        <span
          className="toast__tempo"
          style={{ animationDuration: `${toast.duration}ms` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

export default ToastProvider;
