import type { ReactNode } from 'react';
import { IconClose } from '../icons';
import './Tag.scss';

export type TagTone = 'neutral' | 'blue' | 'success' | 'away' | 'danger';

export interface TagProps {
  children: ReactNode;
  tone?: TagTone;
  /** Bolinha à esquerda — use em status, não em rótulos livres. */
  dot?: boolean;
  /** Contorno em vez de fundo cheio. Reservado para SLA. */
  outline?: boolean;
  /** Quando presente, renderiza o botão de remover. */
  onRemove?: () => void;
}

export function Tag({
  children,
  tone = 'neutral',
  dot = false,
  outline = false,
  onRemove,
}: TagProps) {
  return (
    <span className={`tag tag--${tone}${outline ? ' tag--outline' : ''}`}>
      {dot && <span className="tag__dot" aria-hidden />}
      {children}
      {onRemove && (
        <button
          type="button"
          className="tag__remove"
          aria-label="Remover"
          onClick={onRemove}
        >
          <IconClose className="tag__remove-icon" />
        </button>
      )}
    </span>
  );
}

/** Status de ticket: sempre com bolinha, sempre sem remover. */
export type TicketStatus = 'open' | 'pending' | 'solved' | 'urgent';

const STATUS: Record<TicketStatus, { label: string; tone: TagTone }> = {
  open: { label: 'Aberto', tone: 'blue' },
  pending: { label: 'Pendente', tone: 'away' },
  solved: { label: 'Resolvido', tone: 'success' },
  urgent: { label: 'Urgente', tone: 'danger' },
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <Tag tone={tone} dot>
      {label}
    </Tag>
  );
}

// ---------------------------------------------------------------------------
// Semântica de negócio
//
// Prioridade e SLA usam a mesma paleta ($away para alta e para em risco,
// $danger para urgente e para estourado). Para não virarem a mesma mancha numa
// linha de tabela, a FORMA os separa: prioridade é tag sólida com bolinha, SLA
// é tag contornada com o tempo em mono. Nunca inverta isso.
// ---------------------------------------------------------------------------

export type Priority = 'low' | 'normal' | 'high' | 'urgent';

const PRIORITY: Record<Priority, { label: string; tone: TagTone }> = {
  low: { label: 'Baixa', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'blue' },
  high: { label: 'Alta', tone: 'away' },
  urgent: { label: 'Urgente', tone: 'danger' },
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  const { label, tone } = PRIORITY[priority];
  return (
    <Tag tone={tone} dot>
      {label}
    </Tag>
  );
}

export type SlaState = 'ok' | 'risk' | 'breached';

const SLA: Record<SlaState, { label: string; tone: TagTone }> = {
  ok: { label: 'No prazo', tone: 'success' },
  risk: { label: 'Em risco', tone: 'away' },
  breached: { label: 'Estourado', tone: 'danger' },
};

export interface SlaBadgeProps {
  state: SlaState;
  /** Tempo restante, ou decorrido quando estourado. Ex.: "2h14". */
  remaining?: string;
}

export function SlaBadge({ state, remaining }: SlaBadgeProps) {
  const { label, tone } = SLA[state];
  return (
    <Tag tone={tone} outline>
      {remaining ? (
        <>
          {label}
          <span className="tag__mono">{remaining}</span>
        </>
      ) : (
        label
      )}
    </Tag>
  );
}

/**
 * Deriva o estado de SLA a partir do prazo. Em risco quando resta menos de um
 * quarto da janela — o mesmo limiar usado no token $sla-risk.
 */
export function slaStateFrom(deadline: Date, openedAt: Date, now = new Date()): SlaState {
  if (now > deadline) return 'breached';
  const window = deadline.getTime() - openedAt.getTime();
  const left = deadline.getTime() - now.getTime();
  return left / window < 0.25 ? 'risk' : 'ok';
}

export default Tag;
