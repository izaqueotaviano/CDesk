import { useMemo, useState, type MouseEvent, type ReactNode } from 'react';
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
  /** Alinha à direita (cabeçalho E valor) e usa algarismos tabulares — use
   *  em contagens, valores e datas. */
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
  /**
   * Com a linha clicável (`onRowClick`), é nesta célula que mora o link da
   * linha — o que o teclado e o leitor de tela encontram. Sem nenhuma coluna
   * marcada, vale a primeira.
   */
  primary?: boolean;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selectable?: boolean;
  batchActions?: (selectedKeys: string[]) => ReactNode;
  /** Faixa acima do cabeçalho. Só aparece quando há o que pôr nela. */
  toolbar?: ReactNode;
  /**
   * Linha inteira clicável. O clique em qualquer ponto da linha abre; o
   * teclado chega pelo link da célula principal (`primary`), e Enter abre.
   * Botões e campos dentro da linha continuam só deles — não precisam de
   * `stopPropagation`.
   */
  onRowClick?: (row: T) => void;
  /**
   * Endereço da linha, quando abrir é navegar. Vira `href` de verdade no link
   * da célula principal: Ctrl/Cmd+clique e o botão do meio abrem em outra aba,
   * e o leitor de tela anuncia "link". Sem ele o link vira `<button>`.
   */
  rowHref?: (row: T) => string;
  /** Nome acessível do link da linha. Omita quando o texto da célula já diz. */
  rowLabel?: (row: T) => string;
  empty?: ReactNode;
  /**
   * Força uma densidade fixa — a tabela para de seguir a preferência de quem
   * usa. Omita para o caso comum: a tabela lê `usePrefs().densidade` sozinha.
   * O alternador que grava essa preferência NÃO mora mais na tabela (era uma
   * faixa branca vazia só para dois ícones): a página que quiser oferecê-lo
   * põe `<DensityToggle />` na própria barra de filtros.
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

/** O clique nasceu num controle da própria linha (Editar, checkbox, link)? */
function veioDeControle(e: MouseEvent<HTMLElement>): boolean {
  const alvo = e.target as HTMLElement | null;
  const controle = alvo?.closest('a, button, input, select, textarea, label, [role="button"], [role="checkbox"]');
  return !!controle && e.currentTarget.contains(controle);
}

/** Quem arrasta para selecionar o nome da empresa não quer abrir a empresa. */
function temTextoSelecionado(): boolean {
  return (window.getSelection?.()?.toString() ?? '').length > 0;
}

/**
 * Alternador "padrão × confortável" da densidade das tabelas. Grava a
 * preferência global (a mesma da fila de chamados), então basta estar em UMA
 * barra da página — toda DataTable sem `density` explícito segue.
 */
export function DensityToggle() {
  const densidade = usePrefs((s) => s.densidade);
  const setDensidade = usePrefs((s) => s.setDensidade);
  return (
    <div className="data-table-densidade" role="group" aria-label="Densidade da tabela">
      <IconButton
        Icon={IconRowsCompact}
        label="Tabela padrão"
        size="sm"
        bare
        aria-pressed={densidade === 'compacta'}
        className={
          'data-table-densidade__btn' +
          (densidade === 'compacta' ? ' data-table-densidade__btn--ativo' : '')
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
          'data-table-densidade__btn' +
          (densidade === 'confortavel' ? ' data-table-densidade__btn--ativo' : '')
        }
        onClick={() => setDensidade('confortavel')}
      />
    </div>
  );
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selectable = false,
  batchActions,
  toolbar,
  onRowClick,
  rowHref,
  rowLabel,
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
  // mesmas duas formas que `sort`/`sortProp` já usam logo abaixo.
  const densidade = usePrefs((s) => s.densidade);
  const density = densityProp ?? densidadeParaTableDensity(densidade);

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

  const primaryKey = (columns.find((c) => c.primary) ?? columns[0])?.key;
  const clicavel = !!onRowClick;

  /** O link da linha: `<a href>` quando há endereço, `<button>` quando não. */
  const linkDaLinha = (row: T, conteudo: ReactNode) => {
    const label = rowLabel?.(row);
    if (rowHref) {
      return (
        <a
          className="data-table__row-link"
          href={rowHref(row)}
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            // Ctrl/Cmd/Shift e botão do meio: o navegador abre outra aba, como
            // em qualquer link. Só o clique simples fica na SPA.
            if (!onRowClick || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            onRowClick(row);
          }}
        >
          {conteudo}
        </a>
      );
    }
    return (
      <button
        type="button"
        className="data-table__row-link"
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          onRowClick?.(row);
        }}
      >
        {conteudo}
      </button>
    );
  };

  const cls = [
    'data-table',
    density !== 'default' ? `data-table--${density}` : '',
    loading ? 'data-table--loading' : '',
    clicavel ? 'data-table--clicavel' : '',
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
        toolbar && <div className="data-table__toolbar">{toolbar}</div>
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
                  scope="col"
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
              const rowCls = [
                isSelected ? 'data-table__row--selected' : '',
                clicavel ? 'data-table__row--clicavel' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={key}
                  className={rowCls || undefined}
                  onClick={
                    onRowClick
                      ? (e) => {
                          if (veioDeControle(e) || temTextoSelecionado()) return;
                          onRowClick(row);
                        }
                      : undefined
                  }
                >
                  {selectable && (
                    <td className="data-table__check">
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
                      {clicavel && c.key === primaryKey
                        ? linkDaLinha(row, c.render(row))
                        : c.render(row)}
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
