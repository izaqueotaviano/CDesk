import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Popover } from '@/cvz/components'
import { useMarcarNotificacaoLida, useMarcarTodasLidas, useNotificacoes, type Notificacao } from '@/api/notifications'
import { tempoRelativo } from '@/resolv/tickets/detalhe/linhaDoTempo'
import './notificacoes.scss'

const ICONE_TIPO: Record<string, string> = {
  ticket_created: 'ti ti-ticket',
  ticket_assigned: 'ti ti-ticket',
  ticket_owner_set: 'ti ti-ticket',
  ticket_replied: 'ti ti-ticket',
  ticket_reopened: 'ti ti-ticket',
  ticket_closed: 'ti ti-ticket',
  mention: 'ti ti-at',
  sla_warning: 'ti ti-alert-triangle',
  sla_breached: 'ti ti-alert-triangle',
  chat_incoming: 'ti ti-message-circle-2',
  chat_converted: 'ti ti-message-circle-2',
  chat_closed: 'ti ti-message-circle-2',
  announcement: 'ti ti-speakerphone',
  attachment_blocked: 'ti ti-shield-x',
  lgpd_deadline: 'ti ti-gavel',
  kanban_due: 'ti ti-calendar-due',
}

function LinhaNotificacao({
  notificacao,
  agoraMs,
  onAbrir,
}: {
  notificacao: Notificacao
  agoraMs: number
  onAbrir: (n: Notificacao) => void
}) {
  const naoLida = notificacao.read_at == null
  return (
    <button
      type="button"
      className={'painel-notif__item' + (naoLida ? ' painel-notif__item--nao-lida' : '')}
      onClick={() => onAbrir(notificacao)}
    >
      <i className={ICONE_TIPO[notificacao.kind] ?? 'ti ti-bell'} aria-hidden="true" />
      <span className="painel-notif__texto">
        <strong>{notificacao.title}</strong>
        {notificacao.body && <span className="painel-notif__corpo">{notificacao.body}</span>}
        <span className="painel-notif__tempo">{tempoRelativo(notificacao.created_at, agoraMs)}</span>
      </span>
      {naoLida && <span className="painel-notif__ponto" aria-hidden="true" />}
    </button>
  )
}

/**
 * Conteúdo do dropdown do sino — a fiação já existia esperando por isto:
 * `realtime/bridge.ts` invalida `['notifications']` a cada evento de socket
 * desde sempre, sem nenhum hook consumindo a chave. `unread_count` real no
 * badge (não mais um número inventado), marcar uma ou todas como lidas, e
 * clicar leva pro recurso (`notificacao.url`, já resolvido pelo backend
 * para a rota certa de quem está vendo).
 */
export function PainelNotificacoes() {
  const [agoraMs] = useState(() => Date.now())
  const navigate = useNavigate()
  const { data } = useNotificacoes()
  const marcarLida = useMarcarNotificacaoLida()
  const marcarTodas = useMarcarTodasLidas()

  const notificacoes = data?.results ?? []
  const naoLidas = data?.unread_count ?? 0

  function abrir(n: Notificacao, fechar: () => void) {
    if (n.read_at == null) marcarLida.mutate(n.id)
    fechar()
    if (n.url) navigate(n.url)
  }

  return (
    <Popover
      align="end"
      trigger={(props) => (
        <button type="button" className="topbar-glass__icon-btn" aria-label="Notificações" {...props}>
          <i className="ti ti-bell" />
          {naoLidas > 0 && <span className="painel-notif__badge">{naoLidas > 9 ? '9+' : naoLidas}</span>}
        </button>
      )}
    >
      {(fechar) => (
        <div className="painel-notif">
          <header className="painel-notif__cabecalho">
            <strong>Notificações</strong>
            {naoLidas > 0 && (
              <button type="button" onClick={() => marcarTodas.mutate()} disabled={marcarTodas.isPending}>
                Marcar todas como lidas
              </button>
            )}
          </header>
          {notificacoes.length === 0 ? (
            <p className="painel-notif__vazio">Nenhuma notificação por aqui.</p>
          ) : (
            <div className="painel-notif__lista">
              {notificacoes.map((n) => (
                <LinhaNotificacao key={n.id} notificacao={n} agoraMs={agoraMs} onAbrir={(no) => abrir(no, fechar)} />
              ))}
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}
