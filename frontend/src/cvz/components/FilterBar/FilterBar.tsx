import type { ReactNode } from 'react';
import { Tag } from '../Tag/Tag';
import './FilterBar.scss';

export interface AppliedFilter {
  key: string;
  label: string;
}

export interface FilterBarProps {
  /** Controles de filtro — Menu, Select, SearchInput, o que a tela precisar. */
  children: ReactNode;
  /** O que está aplicado agora, viram chips removíveis. */
  applied?: AppliedFilter[];
  onRemove?: (key: string) => void;
  onClearAll?: () => void;
}

/**
 * Linha de filtros + chips do que está aplicado. Os controles ficam livres
 * (não é uma lista fixa de tipos) porque cada tela filtra por campos
 * diferentes; o que é fixo é onde os chips aparecem e como se limpa tudo.
 */
export function FilterBar({
  children,
  applied = [],
  onRemove,
  onClearAll,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <div className="filter-bar__controls">{children}</div>

      {applied.length > 0 && (
        <div className="filter-bar__applied">
          {applied.map((f) => (
            <Tag key={f.key} onRemove={onRemove ? () => onRemove(f.key) : undefined}>
              {f.label}
            </Tag>
          ))}
          {onClearAll && (
            <button type="button" className="filter-bar__clear" onClick={onClearAll}>
              Limpar tudo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default FilterBar;
