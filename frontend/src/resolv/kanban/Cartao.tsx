import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { API_BASE_URL } from '@/api/client'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE } from '../tickets/format'
import type { Cartao as CartaoTipo } from './tipos'

/** "2026-09-05T14:30" ↔ ISO — o backend espera ISO completo, o
 *  `datetime-local` do navegador devolve sem timezone (assume local). */
function paraDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** `avatar_url` chega como caminho relativo (`/avatars/...`) — sem a base da
 *  API na frente, o navegador resolveria contra a origem do Vite e o
 *  avatar 404ava (visto ao vivo, testando esta tela). */
function urlAvatar(caminho: string): string {
  return caminho.startsWith('http') ? caminho : `${API_BASE_URL}${caminho}`
}

function formatarPrazo(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Props {
  cartao: CartaoTipo
  onAbrir: (ticketId: number) => void
  onDefinirPrazo: (ticketId: number, iso: string | null) => void
  arrastando?: boolean
}

export function Cartao({ cartao, onAbrir, onDefinirPrazo, arrastando }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ticket-${cartao.ticket}`,
    data: { ticketId: cartao.ticket },
  })
  const [editandoPrazo, setEditandoPrazo] = useState(false)
  const [avatarFalhou, setAvatarFalhou] = useState(false)

  const style = transform
    ? { transform: CSS.Translate.toString(transform) }
    : undefined

  // O SLA de resolução importa mais que o de 1ª resposta quando ela já
  // aconteceu — mostrar os dois brigaria por espaço no card; a fila
  // (TicketsTable) já mostra o de 1ª resposta em detalhe, aqui é resumo.
  const sla = cartao.sla.first_response.state === 'none' || cartao.sla.first_response.state === 'met'
    ? cartao.sla.resolution
    : cartao.sla.first_response
  const mostrarSla = sla.state !== 'none' && sla.minutes_left != null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'kb-cartao' +
        (isDragging || arrastando ? ' kb-cartao--arrastando' : '') +
        (cartao.is_overdue ? ' kb-cartao--vencido' : '')
      }
      {...attributes}
      {...listeners}
      onClick={() => onAbrir(cartao.ticket)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onAbrir(cartao.ticket)
      }}
    >
      <div className="kb-cartao__topo">
        <span className="kb-cartao__ref">{cartao.ticket_reference}</span>
        <span
          className="kb-cartao__prioridade"
          style={{ background: COR_PRIORIDADE[cartao.priority] }}
          title={ROTULO_PRIORIDADE[cartao.priority]}
          aria-label={ROTULO_PRIORIDADE[cartao.priority]}
        />
      </div>

      <p className="kb-cartao__assunto" title={cartao.subject}>
        {cartao.subject}
      </p>

      <div className="kb-cartao__meta">
        <span className="kb-cartao__cliente" title={cartao.requester_display}>
          {cartao.requester_display}
        </span>
        {cartao.company_name && <span className="kb-cartao__empresa">{cartao.company_name}</span>}
      </div>

      <div className="kb-cartao__rodape">
        <div className="kb-cartao__badges">
          {/* Prazo INTERNO do quadro — nunca o mesmo selo do SLA contratual:
              são dois relógios diferentes, dois indicadores diferentes. */}
          {editandoPrazo ? (
            <input
              type="datetime-local"
              className="kb-cartao__prazo-input"
              autoFocus
              defaultValue={cartao.due_at ? paraDatetimeLocal(cartao.due_at) : ''}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onBlur={(e) => {
                const valor = e.target.value
                onDefinirPrazo(cartao.ticket, valor ? new Date(valor).toISOString() : null)
                setEditandoPrazo(false)
              }}
            />
          ) : (
            <button
              type="button"
              className={'kb-cartao__prazo' + (cartao.is_overdue ? ' kb-cartao__prazo--vencido' : '')}
              title={cartao.due_at ? 'Prazo interno do quadro' : 'Definir prazo interno'}
              onClick={(e) => {
                e.stopPropagation()
                setEditandoPrazo(true)
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <i className="ri-timer-line" />
              {cartao.due_at ? formatarPrazo(cartao.due_at) : 'Prazo'}
            </button>
          )}

          {mostrarSla && (
            <span className={'kb-cartao__sla kb-cartao__sla--' + sla.state}>
              <i className="ri-alarm-line" />
              {sla.minutes_left! < 0 ? `-${Math.abs(sla.minutes_left!)}m` : `${sla.minutes_left}m`}
            </span>
          )}
        </div>

        <div className="kb-cartao__contadores">
          {cartao.message_count > 0 && (
            <span title={`${cartao.message_count} mensagem(ns)`}>
              <i className="ri-chat-3-line" /> {cartao.message_count}
            </span>
          )}
          {cartao.attachment_count > 0 && (
            <span title={`${cartao.attachment_count} anexo(s)`}>
              <i className="ri-attachment-2" /> {cartao.attachment_count}
            </span>
          )}
        </div>

        {cartao.assignee_name && (
          <span className="kb-cartao__responsavel" title={cartao.assignee_name}>
            {cartao.assignee_avatar && !avatarFalhou ? (
              <img
                src={urlAvatar(cartao.assignee_avatar)}
                alt=""
                // Visto ao vivo: o servidor de estático em dev não manda CORS
                // pro avatar, e o navegador bloqueia a resposta cross-origin
                // (ORB) — cai pra inicial em vez de deixar o ícone quebrado.
                onError={() => setAvatarFalhou(true)}
              />
            ) : (
              <span className="kb-cartao__avatar-fallback">
                {cartao.assignee_name.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  )
}
