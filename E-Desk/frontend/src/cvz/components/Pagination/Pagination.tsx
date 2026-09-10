import { IconChevronLeft, IconChevronRight } from '../icons';
import './Pagination.scss';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
}

/** Janela de páginas com elipse: 1 … 4 5 6 … 26. */
function pageWindow(page: number, last: number): (number | '…')[] {
  if (last <= 7)
    return Array.from({ length: last }, (_, i) => i + 1);

  const out: (number | '…')[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(last - 1, page + 1);

  if (from > 2) out.push('…');
  for (let p = from; p <= to; p++) out.push(p);
  if (to < last - 1) out.push('…');
  out.push(last);
  return out;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  pageSizeOptions,
  onPageSizeChange,
}: PaginationProps) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="pagination">
      <span className="pagination__range">
        {from}–{to} de {total}
      </span>

      {pageSizeOptions && onPageSizeChange && (
        <label className="pagination__size">
          Por página
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="pagination__pages">
        <button
          type="button"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <IconChevronLeft className="pagination__icon" />
        </button>

        {pageWindow(page, last).map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="pagination__gap" aria-hidden>
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              className={p === page ? 'pagination__page--current' : undefined}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          aria-label="Próxima página"
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
        >
          <IconChevronRight className="pagination__icon" />
        </button>
      </div>
    </div>
  );
}

export default Pagination;
