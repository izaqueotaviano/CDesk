import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/ui/Avatar'
import {
  COR_PRIORIDADE,
  ICONE_PRIORIDADE,
  ROTULO_PRIORIDADE,
  ROTULO_STATUS,
  corEstadoSla,
  prioridadeEmDestaque,
  rotuloAbrirChamado,
  textoEstadoSla,
} from './format'
import type { TicketLinha } from './tipos'

interface Props {
  linhas: TicketLinha[]
  selecionados: Set<number>
  onSelecionar: (id: number) => void
  onAbrir: (id: number) => void
  indiceFocado: number
  onFocarLinha: (indice: number) => void
}

/**
 * A fila em cartões — celular e coluna estreita (a tabela de onze colunas
 * rolava de lado e escondia justamente o assunto). Cada cartão diz o que a
 * pessoa decide olhando de relance: o assunto, de quem é, em que pé está,
 * o prazo e com quem está. Prioridade só aparece quando pede atenção (Alta,
 * Urgente) — "Normal" em todo cartão seria ruído.
 *
 * Mesmas regras de teclado da tabela (`data-linha` + foco roving), e a
 * seleção é a caixa no canto — alvo de 24px, fora da área que abre o ticket.
 */
export function CartoesTickets({
  linhas,
  selecionados,
  onSelecionar,
  onAbrir,
  indiceFocado,
  onFocarLinha,
}: Props) {
  return (
    <ul className="cartoes-tickets">
      {linhas.map((t, i) => {
        const marcado = selecionados.has(t.id)
        const sla = t.sla.resolution
        return (
          <li
            key={t.id}
            data-linha={i}
            tabIndex={i === indiceFocado ? 0 : -1}
            className={'cartao-ticket' + (marcado ? ' is-selecionada' : '')}
            onFocus={() => onFocarLinha(i)}
            onClick={() => onAbrir(t.id)}
          >
            <label className="cartao-ticket__check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                aria-label={`Selecionar ${t.reference}`}
                checked={marcado}
                onChange={() => onSelecionar(t.id)}
              />
            </label>

            <div className="cartao-ticket__corpo">
              <Link
                to={`/chamados/${t.id}`}
                className="cartao-ticket__assunto"
                aria-label={rotuloAbrirChamado(t)}
                onClick={(e) => e.stopPropagation()}
              >
                {t.is_restricted && (
                  <i className="ti ti-lock cartao-ticket__cadeado" aria-hidden="true" />
                )}
                {t.subject}
              </Link>
              {/* Uma linha só, cortada no fim: quebrada, o "·" abria a
                  segunda linha solto. */}
              <p className="cartao-ticket__meta">
                {[t.reference, t.requester_display, t.company_name].filter(Boolean).join(' · ')}
              </p>
              <div className="cartao-ticket__estado">
                <span className="tickets-tabela__status">
                  <span
                    className="tickets-tabela__status-dot"
                    style={{ background: t.stage_color || 'var(--text-muted)' }}
                  />
                  {t.stage_name || ROTULO_STATUS[t.status]}
                </span>
                {prioridadeEmDestaque(t.priority) && (
                  <span
                    className="tickets-tabela__prio"
                    style={{ '--cor': COR_PRIORIDADE[t.priority] } as CSSProperties}
                  >
                    <i className={'ti ' + ICONE_PRIORIDADE[t.priority]} aria-hidden="true" />
                    {ROTULO_PRIORIDADE[t.priority]}
                  </span>
                )}
                {sla.state !== 'none' && (
                  <span className="cartao-ticket__sla" style={{ color: corEstadoSla(sla) }}>
                    <i className="ti ti-clock" aria-hidden="true" />
                    {textoEstadoSla(sla)}
                  </span>
                )}
              </div>
            </div>

            <div className="cartao-ticket__dono">
              {t.assignee_name ? (
                <span title={`Responsável: ${t.assignee_name}`}>
                  {/* O Avatar já se anuncia com o nome (role="img"). */}
                  <span className="tickets-tabela__sr">Responsável: </span>
                  <Avatar nome={t.assignee_name} tamanho="sm" />
                </span>
              ) : (
                <span className="cartao-ticket__sem-dono" title="Sem responsável">
                  <i className="ti ti-user" aria-hidden="true" />
                  <span className="tickets-tabela__sr">Sem responsável</span>
                </span>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
