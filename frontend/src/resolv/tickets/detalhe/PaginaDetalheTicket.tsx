import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError } from '@/api/client'
import { useTabs } from '@/stores/tabs'
import { Conversa } from './Conversa'
import { PainelCliente } from './PainelCliente'
import { PainelPropriedades } from './PainelPropriedades'
import { TicketTabs } from './TicketTabs'
import { useTicketDetalhe } from './dados'
import './detalhe.scss'

export function PaginaDetalheTicket() {
  const { id } = useParams<{ id: string }>()
  const ticketId = Number(id)
  const { data: ticket, isLoading, isError, error } = useTicketDetalhe(ticketId)
  const abrir = useTabs((s) => s.abrir)

  // Registra/atualiza a aba deste ticket assim que os dados chegam — é o que
  // alimenta a TicketTabs e o espelho no servidor (docs/06).
  useEffect(() => {
    if (!ticket) return
    abrir(ticket.id, {
      id: ticket.id,
      reference: ticket.reference,
      subject: ticket.subject,
      status: ticket.status,
      stage_color: ticket.stage_color,
      requester_display: ticket.requester_display,
      company_name: ticket.company_name,
    })
    // só quando o id/identidade muda
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id, ticket?.reference, ticket?.subject])

  return (
    <div className="detalhe">
      <TicketTabs idAtivo={ticketId} />

      {isError ? (
        <div className="detalhe__estado detalhe__estado--erro">
          <i className="ri-error-warning-line" />
          <p>
            {error instanceof ApiError && error.status === 404
              ? 'Ticket não encontrado ou sem acesso.'
              : 'Não foi possível carregar o ticket.'}
          </p>
        </div>
      ) : isLoading || !ticket ? (
        <div className="detalhe__estado">
          <i className="ri-loader-4-line detalhe__spin" />
          <p>Carregando ticket…</p>
        </div>
      ) : (
        <div className="detalhe__colunas">
          <PainelPropriedades ticket={ticket} />
          <Conversa ticket={ticket} />
          <PainelCliente ticket={ticket} />
        </div>
      )}
    </div>
  )
}
