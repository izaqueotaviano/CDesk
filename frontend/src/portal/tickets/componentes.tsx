import { Link } from 'react-router-dom'
import { Hash, RotateCcw, Tag } from 'lucide-react'
import type { Prioridade } from '@/resolv/tickets/tipos'
import type { TicketResumo } from '../api/tickets'
import { cn } from '../lib/cn'
import { ROTULO_PRIORIDADE, TOM_PRIORIDADE, relativo, statusDoCliente } from '../lib/formato'
import { Badge } from '../ui/badge'
import { Skeleton } from '../ui/skeleton'

export function PilulaStatus({
  ticket,
  className,
}: {
  ticket: { status: TicketResumo['status']; auto_closed?: boolean | null }
  className?: string
}) {
  const s = statusDoCliente(ticket)
  return (
    <Badge variant={s.tom} ponto className={className}>
      {s.rotulo}
    </Badge>
  )
}

/** Só Alta/Urgente ganham cor: "Normal" em toda linha seria ruído. */
export function PilulaPrioridade({ prioridade }: { prioridade: Prioridade }) {
  const tom = TOM_PRIORIDADE[prioridade]
  if (tom === 'neutro' || tom === 'acento') return null
  return (
    <Badge variant={tom} ponto>
      {ROTULO_PRIORIDADE[prioridade]}
    </Badge>
  )
}

interface CartaoProps {
  ticket: TicketResumo
  agoraMs: number
  /** No Início: sem a linha de metadados. */
  compacto?: boolean
}

/** Uma linha da lista — o card inteiro é o link. */
export function CartaoTicket({ ticket, agoraMs, compacto }: CartaoProps) {
  const aguardandoVoce = ticket.status === 'pending_customer'
  return (
    <Link
      to={`/portal/tickets/${ticket.id}`}
      className={cn(
        'group flex flex-col gap-2 rounded-xl border border-divisoria bg-superficie p-4 shadow-elevacao-1 transition-[border-color,box-shadow] hover:border-borda-controle hover:shadow-elevacao-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40 sm:flex-row sm:items-center sm:gap-4',
        aguardandoVoce && 'border-alerta/40 bg-alerta-suave/30',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="fonte-mono text-legenda text-acento">{ticket.reference}</span>
          {ticket.reopen_count > 0 && (
            <span className="inline-flex items-center gap-1 text-legenda text-tinta-secundaria" title="Reaberto">
              <RotateCcw className="size-3" aria-hidden="true" />
              reaberto
            </span>
          )}
        </div>
        <p className="truncate text-corpo font-medio text-tinta group-hover:text-acento">
          {ticket.content_hidden ? 'Chamado restrito' : ticket.subject}
        </p>
        {!compacto && (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-legenda text-tinta-secundaria">
            {ticket.category_name && (
              <span className="inline-flex items-center gap-1">
                <Tag className="size-3" aria-hidden="true" />
                {ticket.category_name}
              </span>
            )}
            {ticket.order_number && (
              <span className="inline-flex items-center gap-1">
                <Hash className="size-3" aria-hidden="true" />
                pedido {ticket.order_number}
              </span>
            )}
            <span>aberto {relativo(ticket.created_at, agoraMs)}</span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        <span className="flex items-center gap-2">
          <PilulaPrioridade prioridade={ticket.priority} />
          <PilulaStatus ticket={ticket} />
        </span>
        <span className="text-legenda text-tinta-terciaria">
          atualizado {relativo(ticket.updated_at, agoraMs)}
        </span>
      </div>
    </Link>
  )
}

export function EsqueletoCartaoTicket() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-divisoria bg-superficie p-4">
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-5 w-24 rounded-total" />
    </div>
  )
}
