import type { ComponentType, ReactNode } from 'react';
import { IconCircleX, IconTriangleAlert } from '../icons';
import type { IconProps } from '../icons';
import './State.scss';

interface BaseStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** Ilustração pequena — SVG do produto, se houver. Opcional. */
  illustration?: ReactNode;
}

export interface EmptyStateProps extends BaseStateProps {
  Icon?: ComponentType<IconProps>;
}

/**
 * Estado vazio: título que diz o que fazer, nunca "nenhum resultado". Use
 * dentro de DataTable via `empty`, ou solto numa página inteira sem dado.
 */
export function EmptyState({ title, description, action, Icon, illustration }: EmptyStateProps) {
  return (
    <div className="state">
      {illustration ?? (Icon && <Icon className="state__icon" />)}
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

// DIVERGÊNCIA DELIBERADA do canônico cvzdesk (auditoria confirmou e mediu com
// tsc): lá, `ErrorStateProps extends BaseStateProps` herda `title: string`
// obrigatório, e a assinatura da função intersecta com `{ title?: string }` —
// mas intersectar um `string` obrigatório com um opcional de mesmo nome dá
// `string` obrigatório, então o valor default do destructuring nunca dispara
// por tipo: todo `<ErrorState onRetry={fn} />` sem `title` FALHA o typecheck
// no canônico, apesar do default existir em runtime. Aqui `title` é
// realmente opcional na interface — sem isso, telas como PaginaListaEmpresas
// não compilam.
export interface ErrorStateProps extends Omit<BaseStateProps, 'title'> {
  /** Tem um padrão sensato — omita quando "Não foi possível carregar" já basta. */
  title?: string;
  /** Chamado pelo botão "Tentar de novo" padrão. Omita para não mostrar o botão. */
  onRetry?: () => void;
}

/** Estado de erro: mesma forma do vazio, tom e ícone de alerta. */
export function ErrorState({
  title = 'Não foi possível carregar',
  description,
  onRetry,
  action,
}: ErrorStateProps) {
  return (
    <div className="state state--error">
      <IconTriangleAlert className="state__icon" />
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
      <div className="state__action">
        {onRetry && (
          <button type="button" className="state__retry" onClick={onRetry}>
            Tentar de novo
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

/** Sem permissão para ver o conteúdo. Não é erro técnico — não oferece retry. */
export function ForbiddenState({ title = 'Sem acesso a esta área', description }: BaseStateProps & { title?: string }) {
  return (
    <div className="state state--forbidden">
      <IconCircleX className="state__icon" />
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
    </div>
  );
}

export default EmptyState;
