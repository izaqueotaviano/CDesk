import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import { IconChevronDown, IconSearch } from '../icons';
import './Field.scss';

export interface FieldProps {
  label?: string;
  /** Texto de apoio abaixo do campo. Suprimido quando há erro. */
  helper?: string;
  /** Mensagem de erro — também marca o controle como inválido. */
  error?: string;
  htmlFor?: string;
  children: ReactNode;
}

/** Wrapper de rótulo + apoio + erro. Use em volta de qualquer controle. */
export function Field({ label, helper, error, htmlFor, children }: FieldProps) {
  return (
    <div className={'field' + (error ? ' field--invalid' : '')}>
      {label && (
        <label className="field__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        helper && <span className="field__helper">{helper}</span>
      )}
    </div>
  );
}

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  helper?: string;
  error?: string;
}

export function TextInput({ label, helper, error, ...rest }: TextInputProps) {
  const id = useId();
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <input
        id={id}
        className={'control' + (error ? ' control--invalid' : '')}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export interface TextAreaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export function TextArea({ label, helper, error, rows = 4, ...rest }: TextAreaProps) {
  const id = useId();
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <textarea
        id={id}
        rows={rows}
        className={'control control--area' + (error ? ' control--invalid' : '')}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helper?: string;
  error?: string;
  options: SelectOption[];
}

export function Select({ label, helper, error, options, ...rest }: SelectProps) {
  const id = useId();
  return (
    <Field label={label} helper={helper} error={error} htmlFor={id}>
      <div className="select-wrap">
        <select id={id} className="control control--select" {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <IconChevronDown className="select-wrap__caret" />
      </div>
    </Field>
  );
}

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Quando true, o campo não digita: só abre o CommandPalette no clique. */
  asTrigger?: boolean;
}

export function SearchInput({
  asTrigger = false,
  placeholder = 'Buscar',
  ...rest
}: SearchInputProps) {
  return (
    <div className="search-input">
      <IconSearch className="search-input__icon" />
      <input
        className="control search-input__control"
        placeholder={placeholder}
        readOnly={asTrigger || undefined}
        {...rest}
      />
    </div>
  );
}

export default Field;
