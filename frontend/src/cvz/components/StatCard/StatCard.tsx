import type { ComponentType } from 'react';
import type { IconProps } from '../icons';
import './StatCard.scss';

export interface StatCardProps {
  label: string;
  value: string;
  Icon?: ComponentType<IconProps>;
  /** Linha de apoio sob o valor ("em 3 eventos", "mediana 12min"). */
  hint?: string;
  /** Variação — "+6", "−3min". O sinal decide a cor, não a palavra. */
  delta?: { value: string; direction: 'up' | 'down' | 'flat' };
  /**
   * Se subir é bom (resolvidos), ruim (tempo de resposta) ou nem um nem
   * outro (volume aberto). Sem isso, "up" sempre pintaria verde e "tempo
   * médio de resposta +600%" pareceria uma boa notícia. `neutral` nunca
   * pinta: a variação aparece, sem juízo.
   */
  deltaMeaning?: 'up-is-good' | 'up-is-bad' | 'neutral';
  /** Contra o quê a variação compara — vai para o leitor de tela e o title. */
  deltaContext?: string;
}

export function StatCard({
  label,
  value,
  Icon,
  hint,
  delta,
  deltaMeaning = 'up-is-good',
  deltaContext = 'em relação ao período anterior',
}: StatCardProps) {
  const julga = delta && delta.direction !== 'flat' && deltaMeaning !== 'neutral';
  const isPositive =
    julga &&
    ((delta.direction === 'up' && deltaMeaning === 'up-is-good') ||
      (delta.direction === 'down' && deltaMeaning === 'up-is-bad'));
  const isNegative = julga && !isPositive;

  // A seta repete o sinal em forma (não só em cor): quem não separa verde de
  // vermelho ainda lê para que lado foi.
  const seta = delta?.direction === 'up' ? '↑' : delta?.direction === 'down' ? '↓' : '';

  return (
    <div className="stat-card">
      <div className="stat-card__head">
        <span className="stat-card__label">{label}</span>
        {Icon && <Icon className="stat-card__icon" />}
      </div>
      <div className="stat-card__value">{value}</div>
      {hint && <div className="stat-card__hint">{hint}</div>}
      {delta && (
        <span
          className={
            'stat-card__delta' +
            (isPositive ? ' stat-card__delta--positive' : '') +
            (isNegative ? ' stat-card__delta--negative' : '')
          }
          title={`${delta.value} ${deltaContext}`}
        >
          {seta && <span aria-hidden="true">{seta} </span>}
          <span>{delta.value}</span>
          <span className="sr-only"> {deltaContext}</span>
        </span>
      )}
    </div>
  );
}

export default StatCard;
