import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconCheck, IconChevronDown, IconClose, IconSearch } from '../icons';
import { Field } from '../Field/Field';
import './Combobox.scss';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface BaseProps {
  options: ComboboxOption[];
  placeholder?: string;
  label?: string;
  helper?: string;
  error?: string;
  disabled?: boolean;
  /** Texto do estado sem resultado. */
  emptyLabel?: string;
}

export interface ComboboxProps extends BaseProps {
  multiple?: false;
  value: string | null;
  onChange: (value: string | null) => void;
}

export interface ComboboxMultiProps extends BaseProps {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Campo de busca com lista filtrada. Cobre atribuir responsável, escolher
 * cliente e selecionar tags — single ou multi pela prop `multiple`, mesma
 * mecânica de teclado nos dois.
 */
export function Combobox(props: ComboboxProps | ComboboxMultiProps) {
  const {
    options,
    placeholder = 'Buscar…',
    label,
    helper,
    error,
    disabled,
    emptyLabel = 'Nada encontrado.',
  } = props;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedValues = props.multiple ? props.value : props.value ? [props.value] : [];
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedValues.includes(o.value)),
    [options, selectedValues],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const commit = (option: ComboboxOption) => {
    if (props.multiple) {
      const has = props.value.includes(option.value);
      props.onChange(
        has ? props.value.filter((v) => v !== option.value) : [...props.value, option.value],
      );
      // Multi mantém o menu aberto para escolher mais de um em sequência.
      setQuery('');
      inputRef.current?.focus();
    } else {
      props.onChange(option.value);
      setOpen(false);
      setQuery('');
    }
  };

  const removeChip = (value: string) => {
    if (props.multiple) props.onChange(props.value.filter((v) => v !== value));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    }
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
    if (e.key === 'Backspace' && !query && props.multiple && props.value.length > 0) {
      // Backspace no campo vazio remove o último chip — igual a qualquer
      // campo de tags que o usuário já conhece de outros produtos.
      props.onChange(props.value.slice(0, -1));
    }
  };

  return (
    <Field label={label} helper={helper} error={error}>
      <div
        ref={wrapRef}
        className={
          'combobox' + (open ? ' combobox--open' : '') + (disabled ? ' combobox--disabled' : '')
        }
      >
        <div
          className="combobox__control"
          onClick={() => {
            if (!disabled) {
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
        >
          {props.multiple &&
            selectedOptions.map((o) => (
              <span key={o.value} className="combobox__chip">
                {o.label}
                <button
                  type="button"
                  aria-label={`Remover ${o.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(o.value);
                  }}
                >
                  <IconClose />
                </button>
              </span>
            ))}

          {!props.multiple && props.value && !open && (
            <span className="combobox__single-value">{selectedOptions[0]?.label}</span>
          )}

          <IconSearch className="combobox__search-icon" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="combobox__input"
            placeholder={
              props.multiple
                ? selectedOptions.length > 0
                  ? ''
                  : placeholder
                : props.value && !open
                  ? ''
                  : placeholder
            }
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <IconChevronDown className="combobox__caret" />
        </div>

        {open && (
          <ul id={listId} role="listbox" className="combobox__list">
            {filtered.length === 0 && (
              <li className="combobox__empty">{emptyLabel}</li>
            )}
            {filtered.map((o, i) => {
              const isSelected = selectedValues.includes(o.value);
              return (
                <li
                  key={o.value}
                  role="option"
                  aria-selected={isSelected}
                  className={
                    'combobox__option' +
                    (i === activeIndex ? ' combobox__option--active' : '') +
                    (isSelected ? ' combobox__option--selected' : '')
                  }
                  onMouseMove={() => setActiveIndex(i)}
                  onClick={() => commit(o)}
                >
                  {o.icon}
                  <span className="combobox__option-text">
                    {o.label}
                    {o.description && <small>{o.description}</small>}
                  </span>
                  {isSelected && <IconCheck className="combobox__option-check" />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Field>
  );
}

export default Combobox;
