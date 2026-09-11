import { useMemo, useState, type ReactNode } from 'react';
import { usePrefs, type Densidade } from '@/stores/prefs';
import { IconButton } from '../Button/Button';
import { Checkbox } from '../Checkbox/Checkbox';
import { SkeletonRow } from '../Progress/Progress';
import { IconRowsCompact, IconRowsRelaxed, IconSortAsc, IconSortDesc, IconSortNone } from '../icons';
import './DataTable.scss';

export type SortDirection = 'asc' | 'desc';
export type TableDensity = 'compact' | 'default' | 'relaxed';

/** 'compacta' é o que a tabela já renderiza sem modificador nenhum
 *  (`density='default'`, $row-h — 40px); 'confortavel' é o modificador
 *  `relaxed` que a folha já sabe desenhar ($row-h-relaxed — 48px, com mais
 *  respiro vertical). O terceiro estado do componente (`compact`, 32px)
 *  fica de fora do alternador — é mais denso que o que qualquer tela deste
 *  admin já mostrou, e não é o que "padrão vs. confortável" está pedindo. */
function densidadeParaTableDensity(d: Densidade): TableDensity {
  return d === 'confortavel' ? 'relaxed' : 'default';
}

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  header: string;
  /** Alinha à direita e aplica a fonte mono — use em valores e datas. */
  numeric?: boolean;
  width?: string;
  render: (row: T) => ReactNode;
  /**
   * Torna a coluna ordenável. O valor devolvido é o que se compara — devolva
   * número ou string, nunca o nó renderizado.
   */
  sortBy?: (row: T) => string | number;
  /**
   * No modo cartão (mobile) a coluna vira título, subtítulo ou linha de dado.
   * Colunas sem papel definido viram linha de dado com o header como rótulo.
   */
  mobile?: 'title' | 'subtitle' | 'meta' | 'hidden';
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  batchActions?: (selectedKeys: string[]) => ReactNode;
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /**
   * Força uma densidade fixa e ESCONDE o alternador — a tabela para de
   * seguir a preferência de quem usa. Reservado para um cenário onde a
   * página, não a pessoa, decide (um resumo embutido sem espaço de sobra,
   * por exemplo). Omita para o caso comum: a tabela lê `usePrefs().densidade`
   * sozinha e mostra o alternador que grava nela.
   */
  density?: TableDensity;
  /** Mostra esqueleto no lugar das linhas. */
  loading?: boolean;
  /** Quantas linhas de esqueleto renderizar enquanto carrega. */
  loadingRows?: number;
  /** Ordenação inicial. Omita para começar sem ordenar. */
  defaultSort?: SortState;
  /** Assuma o controle da ordenação (dados vindos do servidor, por exemplo). */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectable = false,
  batchActions,
  toolbar,
  onRowClick,
  empty = 'Nada por aqui.',
  density: densityProp,
  loading = false,
  loadingRows = 5,
  defaultSort,
  sort: sortProp,
  onSortChange,
}: DataTableProps<T>) {
  const [selected, setSelected] = useState<string[]>([]);
  const [internalSort, setInternalSort] = useState<SortState | null>(
    defaultSort ?? null,
  );

  // Densidade controlada (prop explícita) ou pela preferência global — as
  // mesmas duas formas que `sort`/`sortProp` já usam duas linhas acima. Sem
  // prop, a tabela mostra o alternador; com prop, ela obedece a página e o
  // alternador some (ver comentário de `density` em DataTableProps).
  const densidade = usePrefs((s) => s.densidade);
  const setDensidade = usePrefs((s) => s.setDensidade);
  const density = densityProp ?? densidadeParaTableDensity(densidade);
  const densidadeEhGlobal = densityProp === undefined;

  // Controlado quando `sort` é passado; não controlado caso contrário.
  const sort = sortProp !== undefined ? sortProp : internalSort;

  const setSort = (next: SortState | null) => {
    if (sortProp === undefined) setInternalSort(next);
    onSortChange?.(next);
  };

  /** asc → desc → sem ordenação. O terceiro clique devolve a ordem original. */
  const toggleSort = (key: string) => {
    if (!sort || sort.key !== key) return setSort({ key, direction: 'asc' });
    if (sort.direction === 'asc') return setSort({ key, direction: 'desc' });
    return setSort(null);
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.key === sort.key);
    if (!column?.sortBy) return rows;

    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = column.sortBy!(a);
      const vb = column.sortBy!(b);
      if (typeof va === 'number' && typeof vb === 'number')
        return (va - vb) * factor;
      return String(va).localeCompare(String(vb), 'pt-BR') * factor;
    });
  }, [rows, columns, sort]);

  const allKeys = useMemo(() => sortedRows.map(rowKey), [sortedRows, rowKey]);
  const allChecked = selected.length > 0 && selected.length === allKeys.length;
  const someChecked = selected.length > 0 && !allChecked;
  const hasSelection = selected.length > 0;

  const toggleAll = () => setSelected(allChecked ? [] : allKeys);
  const toggleRow = (key: string) =>
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );

  const cls = [
    'data-table',
    density !== 'default' ? `data-table--${density}` : '',
    loading ? 'data-table--loading' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const colCount = columns.length + (selectable ? 1 : 0);

  return (
    <div className={cls}>
      {hasSelection ? (
        <div className="data-table__batch">
          <span className="data-table__batch-count">
            <b>{selected.length}</b>{' '}
            {selected.length === 1 ? 'item selecionado' : 'itens selecionados'}
          </span>
          <div className="data-table__batch-actions">
            {batchActions?.(selected)}
            <button
              type="button"
              className="data-table__batch-clear"
              onClick={() => setSelected([])}
            >
              Limpar
            </button>
          </div>
        </div>
      ) : (
        <div className="data-table__toolbar">
          <div className="data-table__toolbar-conteudo">{toolbar}</div>
          {densidadeEhGlobal && (
            <div className="data-table__densidade" role="group" aria-label="Densidade da tabela">
              <IconButton
                Icon={IconRowsCompact}
                label="Tabela padrão"
                size="sm"
                bare
                aria-pressed={densidade === 'compacta'}
                className={
                  'data-table__densidade-btn' +
                  (densidade === 'compacta' ? ' data-table__densidade-btn--ativo' : '')
                }
                onClick={() => setDensidade('compacta')}
              />
              <IconButton
                Icon={IconRowsRelaxed}
                label="Tabela confortável (linhas mais espaçadas)"
                size="sm"
                bare
                aria-pressed={densidade === 'confortavel'}
                className={
                  'data-table__densidade-btn' +
                  (densidade === 'confortavel' ? ' data-table__densidade-btn--ativo' : '')
                }
                onClick={() => setDensidade('confortavel')}
              />
            </div>
          )}
        </div>
      )}

      <table className="data-table__table">
        <thead>
          <tr>
            {selectable && (
              <th className="data-table__check">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onChange={toggleAll}
                  aria-label="Selecionar todos"
                />
              </th>
            )}
            {columns.map((c) => {
              const isSorted = sort?.key === c.key;
              const ariaSort = isSorted
                ? sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
                : 'none';

              return (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={c.numeric ? 'data-table__num' : undefined}
                  aria-sort={c.sortBy ? ariaSort : undefined}
                >
                  {c.sortBy ? (
                    <button
                      type="button"
                      className={
                        'data-table__sort' +
                        (isSorted ? ' data-table__sort--active' : '')
                      }
                      onClick={() => toggleSort(c.key)}
                    >
                      {c.header}
                      {isSorted ? (
                        sort.direction === 'asc' ? (
                          <IconSortAsc className="data-table__sort-icon" />
                        ) : (
                          <IconSortDesc className="data-table__sort-icon" />
                        )
                      ) : (
                        <IconSortNone className="data-table__sort-icon data-table__sort-icon--idle" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: loadingRows }, (_, i) => (
              <SkeletonRow key={`sk-${i}`} columns={colCount} />
            ))}

          {!loading &&
            sortedRows.map((row) => {
              const key = rowKey(row);
              const isSelected = selected.includes(key);
              return (
                <tr
                  key={key}
                  className={isSelected ? 'data-table__row--selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td
                      className="data-table__check"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        aria-label={`Selecionar ${key}`}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      data-label={c.header}
                      data-mobile={c.mobile ?? 'meta'}
                      className={c.numeric ? 'data-table__num' : undefined}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}

          {!loading && sortedRows.length === 0 && (
            <tr>
              <td className="data-table__empty" colSpan={colCount}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
