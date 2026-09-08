import { useLocation, useNavigate } from 'react-router-dom'
import { useConfigChat, useFilaChat, useMeusChats, type Chat } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { useChatUi } from '@/stores/chatUi'
import { identidadeDe } from '@/ui/identidade'
import { ConversaChat } from './ConversaChat'
import { iniciais } from './format'
import '../styles/tokens.scss'
import './chat.scss'
import './minichat.scss'

/** Sem config carregada ainda, o teto do backend (ChatConfig, default 3). */
const LIMITE_PADRAO = 3

function AbaChat({ chat, aberta, onAlternar }: { chat: Chat; aberta: boolean; onAlternar: () => void }) {
  return (
    <button
      type="button"
      className={'minichat__aba' + (aberta ? ' minichat__aba--aberta' : '')}
      aria-expanded={aberta}
      aria-label={`${aberta ? 'Recolher' : 'Abrir'} conversa com ${chat.client_name}`}
      title={`${chat.client_name} · ${chat.company_name}`}
      onClick={onAlternar}
    >
      <span className="minichat__avatar" {...identidadeDe(chat.client_name)}>{iniciais(chat.client_name)}</span>
      <span className="minichat__aba-nome">{chat.client_name}</span>
      {chat.unread_count > 0 && <span className="minichat__badge">{chat.unread_count > 9 ? '9+' : chat.unread_count}</span>}
    </button>
  )
}

/**
 * Mini chat do agente — o "widget global" de docs/01-arquitetura.md §6 e
 * docs/07 §3.3: vive fora das rotas, docado embaixo à direita, e deixa a
 * pessoa responder os atendimentos dela de QUALQUER tela (ticket, cliente,
 * relatório) sem ir ao console. Cada atendimento vira uma aba; a aba abre
 * um painel com a conversa inteira — o mesmo `ConversaChat` do console,
 * mesma sala de socket (registro singleton: abrir aqui e no console é UMA
 * conexão), mesmo composer, mesmos anexos.
 *
 * Quantos painéis ao mesmo tempo é o `max_chats_per_agent` da configuração
 * do chat (default 3) — o mesmo teto que já limita quantos atendimentos o
 * agente pega; um número só, decidido num lugar só.
 *
 * Some no /chat (o console já mostra tudo, e dois painéis da mesma sala
 * marcariam "lido" duas vezes) e no celular (não cabe painel flutuante).
 */
export function MiniChat() {
  const { data: me } = useMe()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const interno = me?.is_internal === true
  const noConsole = pathname.startsWith('/chat')
  const ativo = interno && !noConsole

  const { data: meus } = useMeusChats(ativo)
  const { data: fila } = useFilaChat(ativo)
  const { data: config } = useConfigChat()
  const abertos = useChatUi((s) => s.abertos)
  const alternar = useChatUi((s) => s.alternar)
  const fechar = useChatUi((s) => s.fechar)

  if (!ativo || !meus || meus.length === 0) return null

  const limite = config?.max_chats_per_agent ?? LIMITE_PADRAO
  const porId = new Map(meus.map((c) => [c.id, c]))
  // só os que AINDA são meus e ativos — encerrou/transferiu, o painel some
  const paineis = abertos.map((id) => porId.get(id)).filter((c): c is Chat => c != null)
  const naFila = fila?.length ?? 0

  return (
    <div className="resolv-scope minichat" aria-label="Mini chat">
      {paineis.length > 0 && (
        <div className="minichat__paineis">
          {paineis.map((chat) => (
            <section key={chat.id} className="minichat__painel" aria-label={`Conversa com ${chat.client_name}`}>
              <header className="minichat__painel-cabecalho">
                <span className="minichat__avatar minichat__avatar--ativo" {...identidadeDe(chat.client_name)}>{iniciais(chat.client_name)}</span>
                <span className="minichat__painel-titulo">
                  <strong>{chat.client_name}</strong>
                  <small>{chat.company_name}</small>
                </span>
                <button
                  type="button"
                  className="minichat__icone"
                  aria-label="Abrir no console"
                  title="Abrir no console"
                  onClick={() => navigate(`/chat?chat=${chat.id}`)}
                >
                  <i className="ti ti-arrows-diagonal" />
                </button>
                <button
                  type="button"
                  className="minichat__icone"
                  aria-label={`Minimizar conversa com ${chat.client_name}`}
                  title="Minimizar"
                  onClick={() => fechar(chat.id)}
                >
                  <i className="ti ti-minus" />
                </button>
              </header>
              {/* key: remontar ao trocar de chat zera rascunho/erro — mesmo motivo do console */}
              <ConversaChat key={`mini-${chat.id}`} chatId={chat.id} me={me} compacto />
            </section>
          ))}
        </div>
      )}

      <div className="minichat__barra" role="toolbar" aria-label="Meus atendimentos">
        <span className="minichat__contador" title={`${meus.length} de ${limite} atendimentos simultâneos`}>
          <i className="ti ti-message-circle-2" />
          {meus.length}/{limite}
        </span>
        {meus.map((chat) => (
          <AbaChat key={chat.id} chat={chat} aberta={abertos.includes(chat.id)} onAlternar={() => alternar(chat.id, limite)} />
        ))}
        {naFila > 0 && (
          <button type="button" className="minichat__fila" onClick={() => navigate('/chat')} title="Ver a fila no console">
            {naFila} na fila
          </button>
        )}
      </div>
    </div>
  )
}
