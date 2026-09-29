import { useCaixaDeClientes, type LinhaDeCliente } from '@/api/chat'
import { AvatarComPresenca } from './AvatarComPresenca'
import { EsqueletoLista } from './Esqueletos'
import { dataHoraDe, quandoCurto } from './format'

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
    <section className="cc-lista__secao" aria-labelledby="cc-conversas-titulo">
      <header className="cc-lista__cabecalho">
        <h2 id="cc-conversas-titulo">Conversas</h2>
        {(data?.length ?? 0) > 0 && <span className="cc-lista__contador">{data?.length}</span>}
      </header>

      {isLoading && <EsqueletoLista />}
      {isError && (
        <p className="cc-lista__erro" role="alert">
          Não foi possível carregar as conversas.{' '}
          <button type="button" className="cc-link" onClick={() => void refetch()}>
            Tentar de novo
          </button>
        </p>
      )}
      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="cc-lista__vazio">
          Nenhuma conversa ainda. Pegue alguém da fila e a conversa aparece aqui.
        </p>
      )}

      {(data ?? []).length > 0 && (
        <ul className="cc-lista__itens">
          {(data ?? []).map((linha) => (
            <li key={linha.client_id}>
              <CardCliente
                linha={linha}
                ativo={selecionado === linha.client_id}
                agoraMs={agoraMs}
                onSelecionar={() => onSelecionar(linha.client_id)}
              />
            </li>
          ))}
        </ul>
      )}
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
  const naoLidas = linha.unread > 0
  return (
    <button
      type="button"
      className={'cc-card' + (ativo ? ' cc-card--ativo' : '') + (naoLidas ? ' cc-card--nao-lida' : '')}
      aria-current={ativo ? 'true' : undefined}
      onClick={onSelecionar}
    >
      <AvatarComPresenca nome={linha.client_name} presenca={linha.client_presence} />
      <span className="cc-card__texto">
        {/* o formato de mensageiro: quem e quando em cima, o que disse por
            último embaixo (com as não lidas na ponta), e de onde é por fim */}
        <span className="cc-card__linha">
          <span className="cc-card__nome">{linha.client_name}</span>
          {linha.last_activity && (
            <time
              className="cc-card__quando"
              dateTime={linha.last_activity}
              title={dataHoraDe(linha.last_activity)}
            >
              {quandoCurto(linha.last_activity, agoraMs)}
            </time>
          )}
        </span>
        {(linha.last_message_preview || naoLidas) && (
          <span className="cc-card__linha">
            <span className="cc-card__preview">{linha.last_message_preview}</span>
            {naoLidas && (
              <span className="cc-card__badge" aria-label={`${linha.unread} não lidas`}>
                {linha.unread > 99 ? '99+' : linha.unread}
              </span>
            )}
          </span>
        )}
        <span className="cc-card__meta">
          {linha.company_name}
          {/* quantas aberturas a thread costura — o número explica por que a
              rolagem tem marcadores no meio */}
          {linha.sessions > 1 && ` · ${linha.sessions} atendimentos`}
          {linha.open_chat_id == null && ' · sem conversa aberta'}
        </span>
      </span>
    </button>
  )
}
