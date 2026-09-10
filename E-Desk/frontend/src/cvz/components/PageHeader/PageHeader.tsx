import type { ReactNode } from 'react';
import { IconChevronRight } from '../icons';
import './PageHeader.scss';

export interface Crumb {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface PageHeaderProps {
  title: string;
  /** Vem antes do título — número do ticket, por exemplo. */
  eyebrow?: string;
  /** Vem depois do título, mesma linha — para um StatusBadge de contexto. */
  titleAdornment?: ReactNode;
  description?: string;
  breadcrumbs?: Crumb[];
  /** Botões de ação, da menos para a mais importante. A última fica mais à direita. */
  actions?: ReactNode;
}

/**
 * Cabeçalho padrão de página: breadcrumb opcional, título, descrição e ações.
 * Repete em toda tela — é aqui, não em cada tela, que o espaçamento entre
 * essas peças é decidido.
 */
export function PageHeader({
  title,
  eyebrow,
  titleAdornment,
  description,
  breadcrumbs,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="page-header__crumbs" aria-label="Breadcrumb">
          {breadcrumbs.map((c, i) => (
            <span key={i} className="page-header__crumb-group">
              {c.href || c.onClick ? (
                <a
                  href={c.href ?? '#'}
                  onClick={
                    c.onClick
                      ? (e) => {
                          e.preventDefault();
                          c.onClick!();
                        }
                      : undefined
                  }
                >
                  {c.label}
                </a>
              ) : (
                <span aria-current="page">{c.label}</span>
              )}
              {i < breadcrumbs.length - 1 && (
                <IconChevronRight className="page-header__crumb-sep" />
              )}
            </span>
          ))}
        </nav>
      )}

      <div className="page-header__row">
        <div className="page-header__heading">
          {eyebrow && <span className="page-header__eyebrow">{eyebrow}</span>}
          <div className="page-header__title-line">
            <h1 className="page-header__title">{title}</h1>
            {titleAdornment}
          </div>
          {description && (
            <p className="page-header__description">{description}</p>
          )}
        </div>

        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}

export default PageHeader;
