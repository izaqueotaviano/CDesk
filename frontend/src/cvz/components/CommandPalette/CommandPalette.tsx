import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { useFocusTrap } from '../../hooks';
import {
  IconSearch,
  IconFilters,
  IconArrowRight,
  type IconProps,
} from '../icons';
import { NAV_ITEMS } from '../Sidebar/Sidebar';
import './CommandPalette.scss';

export interface Command {
  id: string;
  label: string;
  group: string;
  Icon: ComponentType<IconProps>;
  meta?: string;
  run?: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands?: Command[];
  onRun?: (command: Command) => void;
}

/** Atalho global Ctrl+K / ⌘K. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return {
    open,
    openPalette: useCallback(() => setOpen(true), []),
    closePalette: useCallback(() => setOpen(false), []),
  };
}

const DEFAULT_COMMANDS: Command[] = NAV_ITEMS.map((item) => ({
  id: `nav-${item.id}`,
  label: item.label,
  group: 'Navegar',
  Icon: item.Icon,
}));

export function CommandPalette({
  open,
  onClose,
  commands = DEFAULT_COMMANDS,
  onRun,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // O input, não o painel, recebe o foco inicial — é ele que o usuário digita.
  // O trap ainda cicla Tab dentro do painel inteiro.
  useFocusTrap(panelRef, open);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  const advanced: Command = {
    id: 'advanced',
    label: 'Busca avançada',
    group: '',
    Icon: IconFilters,
    meta: 'filtros',
  };
  const rows = useMemo(() => [advanced, ...results], [results]);

  // O foco inicial é responsabilidade do useFocusTrap (o input é o primeiro
  // elemento focável do painel); aqui só resetamos o estado e travamos o scroll.
  // Padrão do componente cvzdesk original, preservado verbatim — a auditoria
  // confirmou que reescrever isso como ajuste de estado durante o render
  // (para agradar o lint) introduzia um frame de atraso real no reset ao
  // reabrir a paleta.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    setQuery('');
    setIndex(0);
    document.body.classList.add('is-locked');
    return () => document.body.classList.remove('is-locked');
  }, [open]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- idem acima
  useEffect(() => setIndex(0), [query]);

  const run = useCallback(
    (command: Command) => {
      command.run?.();
      onRun?.(command);
      onClose();
    },
    [onClose, onRun],
  );

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(rows.length - 1, i + 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[index];
      if (row) run(row);
    }
  };

  let lastGroup = '';

  return (
    <div
      className="palette-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Busca"
        onKeyDown={onKeyDown}
      >
        <div className="palette__head">
          <IconSearch className="palette__head-icon" />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder="Buscar ou pular para…"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
          <kbd className="palette__esc">esc</kbd>
        </div>

        <div className="palette__body">
          {rows.map((row, i) => {
            const showGroup = row.group && row.group !== lastGroup;
            if (row.group) lastGroup = row.group;
            const { Icon } = row;
            return (
              <div key={row.id}>
                {showGroup && (
                  <div className="palette__group">
                    <span>{row.group}</span>
                  </div>
                )}
                <button
                  type="button"
                  className={
                    'palette__item' +
                    (i === index ? ' palette__item--active' : '')
                  }
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(row)}
                >
                  <Icon className="palette__item-icon" />
                  <span className="palette__item-label">{row.label}</span>
                  {row.meta ? (
                    <span className="palette__item-meta">{row.meta}</span>
                  ) : (
                    <IconArrowRight className="palette__item-go" />
                  )}
                </button>
              </div>
            );
          })}

          {results.length === 0 && (
            <div className="palette__empty">
              <b>Nada encontrado para “{query}”</b>
              Tente outro termo ou use a busca avançada.
            </div>
          )}
        </div>

        <div className="palette__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navegar
          </span>
          <span>
            <kbd>↵</kbd> abrir
          </span>
          <span>
            <kbd>esc</kbd> fechar
          </span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
