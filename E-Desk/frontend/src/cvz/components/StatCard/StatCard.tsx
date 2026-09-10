import type { ComponentType } from 'react';
import type { IconProps } from '../icons';
import './StatCard.scss';

export interface StatCardProps {
  label: string;
  value: string;
  Icon?: ComponentType<IconProps>;
  /** Variação — "+6", "−3min". O sinal decide a cor, não a palavra. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  /**
   * Se subir é bom (resolvidos) ou ruim (tickets abertos) depende da métrica.
   * Sem isso, "up" sempre pintaria verde e "tickets abertos +6" pareceria uma
   * boa notícia.
   */
  deltaMeaning?: 'up-is-good' | 'up-is-bad';
}

export function StatCard({
  label,
  value,
  Icon,
  delta,
  deltaMeaning = 'up-is-good',
}: StatCardProps) {
  const isPositive =
    delta &&
    ((delta.direction === 'up' && deltaMeaning === 'up-is-good') ||
      (delta.direction === 'down' && deltaMeaning === 'up-is-bad'));
  const isNegative =
    delta &&
    ((delta.direction === 'down' && deltaMeaning === 'up-is-good') ||
      (delta.direction === 'up' && deltaMeaning === 'up-is-bad'));

  return (
    <div className="stat-card">
      <div className="stat-card__head">
        <span className="stat-card__label">{label}</span>
        {Icon && <Icon className="stat-card__icon" />}
      </div>
      <div className="stat-card__value">{value}</div>
      {delta && (
        <span
          className={
            'stat-card__delta' +
            (isPositive ? ' stat-card__delta--positive' : '') +
            (isNegative ? ' stat-card__delta--negative' : '')
          }
        >
          {delta.value}
        </span>
      )}
    </div>
  );
}

export default StatCard;
