import { useCaixaDeClientes, type LinhaDeCliente } from '@/api/chat'
import { AvatarComPresenca } from './AvatarComPresenca'
import { haQuanto } from './format'

/**
 * A caixa de entrada do console: uma linha por PESSOA, não por abertura.
 *
 * Com cinquenta clientes e várias aberturas cada, a lista por abertura é a
 * que ninguém navega — a mesma pessoa aparece cinco vezes, sem relação
 * visível entre as linhas, e achar "onde eu parei com a Ana" vira uma
 * caçada. Aqui é o formato que todo mensageiro usa: quem falou por último
 * está em cima.
 *
 * O agrupamento é de APRESENTAÇÃO. Cada `Chat` continua sendo uma linha no
 * banco, com o próprio SLA, a própria avaliação e o próprio ciclo — a
 * modelagem não mudou, a pergunta que a tela faz é que mudou ("com quem
 * estou falando" em vez de "que aberturas existem").
 *
 * A FILA fica de fora, na seção dela: é trabalho a fazer, não conversa em
 * andamento, e some assim que alguém pega.
 */
export function ListaClientes({
  selecionado,
  onSelecionar,
  agoraMs,
}: {
  /** O cliente aberto agora — a seleção é por pessoa, não por chat. */
  selecionado: number | null
  onSelecionar: (clienteId: number) => void
  agoraMs: number
}) {
  const { data, isLoading, isError, refetch } = useCaixaDeClientes()

  return (
    <section className="cc-lista__secao">
      <header className="cc-lista__cabecalho">
        <h2>Conversas</h2>
        <span className="cc-lista__contador">{data?.length ?? 0}</span>
      </header>

      {isLoading && <p className="cc-lista__vazio">Carregando…</p>}
      {isError && (
        <p className="cc-lista__erro">
          Não foi possível carregar.{' '}
          <button type="button" className="cc-link" onClick={() => void refetch()}>
            Tentar de novo
          </button>
        </p>
      )}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="cc-lista__vazio">Nenhuma conversa ainda.</p>
      )}

      {(data ?? []).map((linha) => (
        <CardCliente
          key={linha.client_id}
          linha={linha}
          ativo={selecionado === linha.client_id}
          agoraMs={agoraMs}
          onSelecionar={() => onSelecionar(linha.client_id)}
        />
      ))}
    </section>
  )
}

function CardCliente({
  linha,
  ativo,
  agoraMs,
  onSelecionar,
}: {
  linha: LinhaDeCliente
  ativo: boolean
  agoraMs: number
  onSelecionar: () => void
}) {
  return (
    <button
      type="button"
      className={'cc-card' + (ativo ? ' cc-card--ativo' : '')}
      onClick={onSelecionar}
    >
      <AvatarComPresenca nome={linha.client_name} presenca={linha.client_presence} />
      <span className="cc-card__texto">
        <span className="cc-card__nome">
          {linha.client_name}
          {linha.last_activity && (
            <span className="cc-card__quando">{haQuanto(linha.last_activity, agoraMs)}</span>
          )}
        </span>
        <span className="cc-card__meta">
          {linha.company_name}
          {/* quantas aberturas a thread costura — o número explica por que a
              rolagem tem marcadores no meio */}
          {linha.sessions > 1 && ` · ${linha.sessions} atendimentos`}
          {linha.open_chat_id == null && ' · sem conversa aberta'}
        </span>
        {linha.last_message_preview && (
          <span className="cc-card__preview">{linha.last_message_preview}</span>
        )}
      </span>
      {linha.unread > 0 && (
        <span className="cc-card__badge" aria-label={`${linha.unread} não lidas`}>
          {linha.unread}
        </span>
      )}
    </button>
  )
}
