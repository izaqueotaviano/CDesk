import type { Me } from '@/api/types'
import { paraTextoSimples } from '@/ui/textoFormatado'
import { formatarDataHora } from '../format'
import { useAcoesTicket } from './dados'
import type { TicketDetalhe } from './tiposDetalhe'

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
}

/**
 * As respostas agendadas que ainda vão sair, com "Cancelar". Mora logo acima
 * do compositor, na faixa da conversa: é a próxima mensagem do chamado, só
 * que com hora marcada (`dispatch_scheduled_replies`, a cada minuto).
 *
 * AGENDAR é no próprio compositor (botão ao lado de enviar, sobre o mesmo
 * texto). Antes havia aqui um segundo campo de texto só para agendar — e a
 * pessoa escrevia a resposta num lugar e procurava o agendamento no outro.
 *
 * Ferramenta de agente: some para quem não pode responder publicamente
 * (`ticket.reply_public`) e para o cliente, que nem recebe
 * `scheduled_replies` do backend.
 */
export function AgendarResposta({ ticket, me }: Props) {
  const { cancelarAgendamento } = useAcoesTicket(ticket.id)
  const perms = me?.permissions ?? []
  const podeAgendar = me?.is_internal === true && perms.includes('ticket.reply_public')
  const pendentes = ticket.scheduled_replies.filter((r) => r.status === 'pending')

  if (!podeAgendar || pendentes.length === 0) return null

  return (
    <div className="agendar-resposta">
      <ul className="agendar-resposta__lista" aria-label="Respostas agendadas">
        {pendentes.map((r) => (
          <li key={r.id} className="agendar-resposta__item">
            <i className="ti ti-calendar-time" aria-hidden="true" />
            <span className="agendar-resposta__item-texto">
              <strong>Sai {formatarDataHora(r.scheduled_at)}</strong>
              <span>{paraTextoSimples(r.body)}</span>
            </span>
            <button
              type="button"
              className="agendar-resposta__cancelar"
              disabled={cancelarAgendamento.isPending}
              onClick={() => cancelarAgendamento.mutate(r.id)}
            >
              Cancelar
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
