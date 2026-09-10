import { ROTULO_STATUS } from '../format'
import { formatarDataHora } from '../format'
import type { TicketDetalhe } from './tiposDetalhe'

const COR_STATUS: Record<string, string> = {
  new: 'var(--accent)',
  open: 'var(--accent)',
  pending_customer: 'var(--away)',
  closed: 'var(--ok)',
}

const ROTULO_IDIOMA: Record<string, string> = {
  'pt-br': 'Português (Brasil)',
  'pt-BR': 'Português (Brasil)',
  en: 'Inglês',
  'en-us': 'Inglês (EUA)',
  es: 'Espanhol',
}

/** Hora local do cliente a partir do fuso da empresa (ex.: "qui., 10:55 BRT"). */
function horaLocal(timezone: string | null): string | null {
  if (!timezone) return null
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: timezone,
    }).format(new Date())
  } catch {
    return null
  }
}

/**
 * Painel do cliente — agora 100% real: nome, empresa, e-mail, hora local
 * (calculada do fuso da empresa) e idioma vêm do campo `requester`, que o
 * backend passou a expor (RequesterSerializer). Histórico = eventos reais.
 * `requester` é null quando o conteúdo está mascarado para quem pede.
 */
export function PainelCliente({ ticket }: { ticket: TicketDetalhe }) {
  const req = ticket.requester
  const hora = horaLocal(req?.timezone ?? null)
  const idioma = req ? (ROTULO_IDIOMA[req.ui_language] ?? req.ui_language) : null

  return (
    <aside className="cliente-panel" aria-label="Cliente">
      <div className="cliente-panel__cabecalho">
        <span className="cliente-panel__avatar">
          <i className="ri-user-line" />
        </span>
        <div className="cliente-panel__id">
          <span className="cliente-panel__nome">{req?.name ?? ticket.requester_display}</span>
          {ticket.company_name && (
            <span className="cliente-panel__empresa">{ticket.company_name}</span>
          )}
        </div>
      </div>

      <div className="cliente-panel__campos">
        <div className="cliente-panel__campo">
          <span className="cliente-panel__rotulo">
            <i className="ri-mail-line" /> E-mail
          </span>
          {req?.email ? (
            <a className="cliente-panel__valor cliente-panel__link" href={`mailto:${req.email}`}>
              {req.email}
            </a>
          ) : (
            <span className="cliente-panel__valor cliente-panel__valor--off">—</span>
          )}
        </div>
        <div className="cliente-panel__campo">
          <span className="cliente-panel__rotulo">
            <i className="ri-time-line" /> Hora local
          </span>
          <span className={'cliente-panel__valor' + (hora ? '' : ' cliente-panel__valor--off')}>
            {hora ?? '—'}
          </span>
        </div>
        <div className="cliente-panel__campo">
          <span className="cliente-panel__rotulo">
            <i className="ri-translate-2" /> Idioma
          </span>
          <span className={'cliente-panel__valor' + (idioma ? '' : ' cliente-panel__valor--off')}>
            {idioma ?? '—'}
          </span>
        </div>
      </div>

      <div className="cliente-panel__campo cliente-panel__campo--col">
        <span className="cliente-panel__rotulo">Observações</span>
        <textarea
          className="cliente-panel__obs"
          rows={2}
          placeholder="Adicionar observações do cliente"
          disabled
        />
      </div>

      {/* Histórico de interações — eventos operacionais do ticket (reais) */}
      <div className="cliente-panel__historico">
        <div className="cliente-panel__historico-topo">
          <span className="cliente-panel__rotulo">Histórico de interações</span>
        </div>

        <ul className="cliente-panel__lista">
          {/* o próprio chamado como âncora do histórico */}
          <li className="cliente-panel__item cliente-panel__item--ativo">
            <span className="cliente-panel__dot" style={{ background: COR_STATUS[ticket.status] }} />
            <div>
              <p className="cliente-panel__item-titulo">{ticket.subject}</p>
              <p className="cliente-panel__item-meta">{formatarDataHora(ticket.created_at)}</p>
              <p className="cliente-panel__item-status">Status {ROTULO_STATUS[ticket.status]}</p>
            </div>
          </li>

          {ticket.events.map((ev) => (
            <li key={ev.id} className="cliente-panel__item">
              <span
                className="cliente-panel__dot"
                style={{ background: COR_STATUS[ev.to_status] ?? 'var(--text-muted)' }}
              />
              <div>
                <p className="cliente-panel__item-titulo">
                  {ev.note || `Status → ${ROTULO_STATUS[ev.to_status]}`}
                </p>
                <p className="cliente-panel__item-meta">
                  {formatarDataHora(ev.created_at)}
                  {ev.actor_name ? ` · ${ev.actor_name}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
