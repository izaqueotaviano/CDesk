import './Progress.scss';

export interface ProgressProps {
  /** 0 a 100. Omita para a barra indeterminada. */
  value?: number;
  label?: string;
  tone?: 'blue' | 'success' | 'away' | 'danger';
}

export function Progress({ value, label, tone = 'blue' }: ProgressProps) {
  const indeterminate = value === undefined;
  const clamped = indeterminate ? 0 : Math.min(100, Math.max(0, value));

  return (
    <div className="progress">
      {label && (
        <div className="progress__head">
          <span>{label}</span>
          {!indeterminate && <b>{Math.round(clamped)}%</b>}
        </div>
      )}
      <div
        className={
          `progress__track progress__track--${tone}` +
          (indeterminate ? ' progress__track--indeterminate' : '')
        }
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span
          className="progress__bar"
          style={indeterminate ? undefined : { width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export interface SkeletonProps {
  /** Número de linhas. Use `lines` para blocos de texto. */
  lines?: number;
  width?: string;
  height?: string;
  /** Círculo, para o lugar de um avatar. */
  circle?: boolean;
}

export function Skeleton({ lines = 1, width, height, circle = false }: SkeletonProps) {
  if (circle) {
    return (
      <span
        className="skeleton skeleton--circle"
        style={{ width: width ?? '30px', height: height ?? width ?? '30px' }}
        aria-hidden
      />
    );
  }

  // Última linha mais curta: sinaliza fim de parágrafo sem inventar conteúdo.
  return (
    <span className="skeleton-group" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skeleton"
          style={{
            width: width ?? (i === lines - 1 && lines > 1 ? '62%' : '100%'),
            height,
          }}
        />
      ))}
    </span>
  );
}

/** Placeholder de linha de tabela, alinhado à densidade em uso. */
export function SkeletonRow({ columns }: { columns: number }) {
  return (
    <tr aria-hidden>
      {Array.from({ length: columns }, (_, i) => (
        <td key={i}>
          <Skeleton width={i === 0 ? '40%' : '70%'} />
        </td>
      ))}
    </tr>
  );
}

export default Progress;
