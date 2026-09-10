import { useEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import './Checkbox.scss';

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  /** Linha de apoio abaixo do rótulo. */
  description?: string;
  /** Estado parcial — pai de um grupo com alguns filhos marcados. */
  indeterminate?: boolean;
  invalid?: boolean;
}

export function Checkbox({
  label,
  description,
  indeterminate = false,
  invalid = false,
  disabled,
  className = '',
  ...rest
}: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  // `indeterminate` só existe no DOM, não como atributo.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  const cls = [
    'cbx',
    disabled ? 'cbx--disabled' : '',
    invalid ? 'cbx--invalid' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <label className={cls}>
      <input ref={ref} type="checkbox" disabled={disabled} {...rest} />
      <span className="cbx__box" aria-hidden>
        <svg viewBox="0 0 16 16" className="cbx__check">
          <path d="m3.5 8.4 3 3 6-6.4" />
        </svg>
      </span>
      {(label || description) && (
        <span className="cbx__text">
          {label}
          {description && <small>{description}</small>}
        </span>
      )}
    </label>
  );
}

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
}

export function Radio({ label, className = '', ...rest }: RadioProps) {
  return (
    <label className={'radio ' + className}>
      <input type="radio" {...rest} />
      <span className="radio__dot" aria-hidden />
      <span className="radio__text">{label}</span>
    </label>
  );
}

export interface ToggleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
}

export function Toggle({ label, className = '', ...rest }: ToggleProps) {
  return (
    <label className={'toggle ' + className}>
      <input type="checkbox" role="switch" {...rest} />
      <span className="toggle__track" aria-hidden />
      {label && <span className="toggle__text">{label}</span>}
    </label>
  );
}

export default Checkbox;
