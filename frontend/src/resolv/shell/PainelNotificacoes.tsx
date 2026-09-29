import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Popover } from '@/cvz/components'
import { useMarcarNotificacaoLida, useMarcarTodasLidas, useNotificacoes, type Notificacao } from '@/api/notifications'
import { tempoRelativo } from '@/resolv/tickets/detalhe/linhaDoTempo'
import {
  desligarAvisosDoSistema,
  estadoDosAvisos,
  ligarAvisosDoSistema,
  type EstadoAviso,
} from '@/realtime/avisos'
import './notificacoes.scss'
import { IconeMarca } from '@/ui/marca/IconeMarca'

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
 * Liga/desliga a notificação do sistema operacional — a única das três
 * entregas de `realtime/avisos.ts` que aparece por cima de outro programa.
 *
 * Mora no rodapé do sino porque é onde a pessoa está pensando em
 * notificação. A permissão é pedida no CLIQUE, nunca na carga da página: o
 * pedido que aparece sozinho ao abrir o site é o que todo mundo nega por
 * reflexo — e "negado" no navegador não dá pra desfazer por código.
 *
 * Os quatro estados são visíveis de propósito, inclusive os dois que não têm
 * botão: sem isso, "não recebo aviso nenhum" vira mistério.
 */
function AvisosDoSistema() {
  const [estado, setEstado] = useState<EstadoAviso>(estadoDosAvisos)
  const idRotulo = useId()
  const idDescricao = useId()

  if (estado === 'indisponivel') return null

  if (estado === 'bloqueado') {
    return (
      <p className="painel-notif__avisos painel-notif__avisos--bloqueado">
        Avisos no computador estão bloqueados por este navegador. Para voltar a
        recebê-los, libere as notificações deste site nas configurações dele.
      </p>
    )
  }

  const ligado = estado === 'ligado'
  return (
    <div className="painel-notif__avisos">
      <span>
        {/* O nome acessível da chave é este texto, e a explicação é o <small>:
            sem isso o leitor de tela anuncia "interruptor, ligado" sem dizer
            ligado o quê. */}
        <span id={idRotulo}>Avisar neste computador</span>
        <small id={idDescricao}>Aparece mesmo com o Resolv em outra aba.</small>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-labelledby={idRotulo}
        aria-describedby={idDescricao}
        className={'painel-notif__chave' + (ligado ? ' painel-notif__chave--ligada' : '')}
        onClick={async () => {
          if (ligado) {
            desligarAvisosDoSistema()
            setEstado(estadoDosAvisos())
          } else {
            setEstado(await ligarAvisosDoSistema())
          }
        }}
      >
        <span className="painel-notif__chave-bolinha" />
      </button>
    </div>
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
        <button type="button" className="sidebar-rail__item" aria-label="Notificações" title="Notificações" {...props}>
          {/* Mesma estrutura ícone+rótulo dos itens de navegação: é o que faz
              o selo ancorar no SINO (e não na ponta da linha) e os rótulos
              alinharem numa coluna só com a barra expandida. */}
          <span className="sidebar-rail__icone">
            <IconeMarca nome="bell" />
            {naoLidas > 0 && <span className="painel-notif__badge">{naoLidas > 9 ? '9+' : naoLidas}</span>}
          </span>
          <span className="sidebar-rail__rotulo" aria-hidden="true">
            Notificações
          </span>
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
          <AvisosDoSistema />
        </div>
      )}
    </Popover>
  )
}
