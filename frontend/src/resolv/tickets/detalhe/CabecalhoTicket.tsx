import { useNavigate } from 'react-router-dom'
import type { Me } from '@/api/types'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE, formatarDataHora } from '../format'
import { ICONE_CANAL, ROTULO_CANAL, ROTULO_SLA, TOM_SLA, tempoSla } from './linhaDoTempo'
import type { RelogioSla, TicketDetalhe } from './tiposDetalhe'

export type PainelLateral = 'propriedades' | 'cliente'

interface Props {
  ticket: TicketDetalhe
  me: Me | undefined
  assumindo: boolean
  onAssumir: () => void
  onFechar: () => void
  onReabrir: () => void
  /** Em telas estreitas os painéis laterais viram gavetas — o cabeçalho é
   *  quem abre cada uma. */
  painelAberto: PainelLateral | null
  onAlternarPainel: (p: PainelLateral) => void
}

function RelogioSlaChip({ rotulo, relogio }: { rotulo: string; relogio: RelogioSla }) {
  const tom = TOM_SLA[relogio.state]
  const prazo = relogio.due_at ? `Prazo: ${formatarDataHora(relogio.due_at)}` : 'Sem prazo definido'
  return (
    <span className={`ticket-cab__sla ticket-cab__sla--${tom}`} title={prazo}>
      <span className="ticket-cab__sla-rotulo">{rotulo}</span>
      <span className="ticket-cab__sla-valor">{tempoSla(relogio)}</span>
      <span className="ticket-cab__sla-estado">{ROTULO_SLA[relogio.state]}</span>
    </span>
  )
}

/**
 * Identidade do ticket + as ações que a pessoa mais procura ao abrir a tela:
 * assumir e fechar/reabrir. Antes, fechar só existia escondido num menu do
 * botão de enviar — e falhava no backend, que exige as datas da solução (D4).
 * Agora é um botão com nome, que abre o formulário certo. "Seguir" fica no
 * painel de propriedades, junto da lista de quem já segue.
 */
export function CabecalhoTicket({
  ticket,
  me,
  assumindo,
  onAssumir,
  onFechar,
  onReabrir,
  painelAberto,
  onAlternarPainel,
}: Props) {
  const navigate = useNavigate()
  const perms = me?.permissions ?? []
  const fechado = ticket.status === 'closed'
  const souOResponsavel = me != null && ticket.assignee_id === me.id
  const podeAssumir = !fechado && !souOResponsavel && perms.includes('ticket.be_assigned')
  const podeFechar = perms.includes('ticket.close')
  const podeReabrir = perms.includes('ticket.reply_public')

  return (
    <header className="ticket-cab">
      <div className="ticket-cab__linha">
        <button
          type="button"
          className="ticket-cab__voltar"
          onClick={() => navigate('/chamados')}
          aria-label="Voltar para a lista de tickets"
          title="Voltar para a lista"
        >
          <i className="ti ti-arrow-left" />
        </button>

        <div className="ticket-cab__identidade">
          <span className="ticket-cab__ref">{ticket.reference}</span>
          <h1 className="ticket-cab__assunto">
            {ticket.is_restricted && (
              <i className="ti ti-lock" title="Equipe restrita" aria-label="Equipe restrita" />
            )}
            {ticket.subject}
          </h1>
        </div>

        <div className="ticket-cab__acoes">
          {podeAssumir && (
            <button
              type="button"
              className="ticket-cab__botao"
              onClick={onAssumir}
              disabled={assumindo}
            >
              <i className="ti ti-user-check" />
              {assumindo ? 'Assumindo…' : 'Assumir'}
            </button>
          )}
          {fechado
            ? podeReabrir && (
                <button type="button" className="ticket-cab__botao" onClick={onReabrir}>
                  <i className="ti ti-rotate-clockwise-2" />
                  Reabrir…
                </button>
              )
            : podeFechar && (
                <button
                  type="button"
                  className="ticket-cab__botao ticket-cab__botao--primario"
                  onClick={onFechar}
                >
                  <i className="ti ti-circle-check" />
                  Fechar ticket…
                </button>
              )}

          <span className="ticket-cab__gavetas" role="group" aria-label="Painéis">
            <button
              type="button"
              className={
                'ticket-cab__gaveta ticket-cab__gaveta--props' +
                (painelAberto === 'propriedades' ? ' ticket-cab__gaveta--ativa' : '')
              }
              onClick={() => onAlternarPainel('propriedades')}
              aria-pressed={painelAberto === 'propriedades'}
              aria-label="Propriedades do ticket"
              title="Propriedades"
            >
              <i className="ti ti-adjustments-horizontal" />
            </button>
            <button
              type="button"
              className={
                'ticket-cab__gaveta ticket-cab__gaveta--cliente' +
                (painelAberto === 'cliente' ? ' ticket-cab__gaveta--ativa' : '')
              }
              onClick={() => onAlternarPainel('cliente')}
              aria-pressed={painelAberto === 'cliente'}
              aria-label="Dados do cliente"
              title="Cliente"
            >
              <i className="ti ti-user" />
            </button>
          </span>
        </div>
      </div>

      <div className="ticket-cab__linha ticket-cab__linha--meta">
        <span
          className="ticket-cab__pilula ticket-cab__pilula--etapa"
          style={{ ['--cor' as string]: ticket.stage_color }}
        >
          <span className="ticket-cab__ponto" />
          {ticket.stage_name}
        </span>
        <span
          className="ticket-cab__pilula ticket-cab__pilula--prioridade"
          style={{ ['--cor' as string]: COR_PRIORIDADE[ticket.priority] }}
          title="Prioridade"
        >
          <span className="ticket-cab__barra" />
          {ROTULO_PRIORIDADE[ticket.priority]}
        </span>
        {ticket.team && (
          <span className="ticket-cab__meta">
            <i className="ti ti-users-group" />
            {ticket.team.name}
          </span>
        )}
        <span className="ticket-cab__meta">
          <i className={ICONE_CANAL[ticket.source] ?? 'ti ti-mail'} />
          {ROTULO_CANAL[ticket.source] ?? ticket.source}
        </span>
        <span className="ticket-cab__meta ticket-cab__meta--quieto">
          Aberto em <time dateTime={ticket.created_at}>{formatarDataHora(ticket.created_at)}</time>{' '}
          por <strong>{ticket.requester_display}</strong>
          {ticket.company_name ? ` · ${ticket.company_name}` : ''}
        </span>

        <span className="ticket-cab__slas" aria-label="Prazos de SLA">
          <RelogioSlaChip rotulo="1ª resposta" relogio={ticket.sla.first_response} />
          <RelogioSlaChip rotulo="Resolução" relogio={ticket.sla.resolution} />
        </span>
      </div>
    </header>
  )
}
