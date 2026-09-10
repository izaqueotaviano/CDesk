import type { ButtonHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { IconProps } from '../icons';
import './Button.scss';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'tertiary'
  | 'ghost'
  | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Ícone à esquerda do rótulo. */
  Icon?: ComponentType<IconProps>;
  /** Ocupa toda a largura do container. */
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  Icon,
  block = false,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  const cls = [
    'btn',
    `btn--${variant}`,
    `btn--${size}`,
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={cls} {...rest}>
      {Icon && <Icon className="btn__icon" />}
      <span className="btn__label">{children}</span>
    </button>
  );
}

export interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  Icon: ComponentType<IconProps>;
  /** Obrigatório: o botão não tem rótulo visível. */
  label: string;
  size?: 'sm' | 'md';
  /** Sem borda — para uso dentro de linhas de tabela e barras densas. */
  bare?: boolean;
}

export function IconButton({
  Icon,
  label,
  size = 'md',
  bare = false,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = [
    'icon-btn',
    `icon-btn--${size}`,
    bare ? 'icon-btn--bare' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={cls} aria-label={label} title={label} {...rest}>
      <Icon className="icon-btn__icon" />
    </button>
  );
}

export default Button;
