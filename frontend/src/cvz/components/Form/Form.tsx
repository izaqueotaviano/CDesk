import type { ReactNode } from 'react';
import './Form.scss';

export interface FormSectionProps {
  title?: string;
  /** Linha de apoio abaixo do título, explicando o grupo. */
  description?: string;
  children: ReactNode;
}

/** Grupo de campos com título. Separa assuntos dentro de um formulário longo. */
export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <section className="form-section">
      {(title || description) && (
        <header className="form-section__head">
          {title && <h2 className="form-section__title">{title}</h2>}
          {description && (
            <p className="form-section__description">{description}</p>
          )}
        </header>
      )}
      <div className="form-section__body">{children}</div>
    </section>
  );
}

export interface FormRowProps {
  children: ReactNode;
  /**
   * Proporção das colunas. Em telas abaixo de 768px toda linha vira uma coluna
   * só, independente do valor.
   */
  columns?: 1 | 2 | 3 | '2-1' | '1-2';
}

/** Linha de campos lado a lado. Colapsa para uma coluna no mobile. */
export function FormRow({ children, columns = 2 }: FormRowProps) {
  return <div className={`form-row form-row--${columns}`}>{children}</div>;
}

export interface FormActionsProps {
  children: ReactNode;
  /** Fixa as ações no rodapé da área rolável — útil em formulário longo. */
  sticky?: boolean;
}

/** Rodapé de ações. A primária fica à direita; no mobile ocupam a largura. */
export function FormActions({ children, sticky = false }: FormActionsProps) {
  return (
    <div className={'form-actions' + (sticky ? ' form-actions--sticky' : '')}>
      {children}
    </div>
  );
}

export default FormSection;
