import type { Chat } from '@/api/chat'
import { dataHoraDe, haQuanto, iniciais } from './format'

interface Props {
  fila: Chat[]
  meus: Chat[]
  selecionado: number | null
  onSelecionar: (id: number) => void
  onPegar: (id: number) => void
  pegando: boolean
  erroFila: string | null
  filaAberta: boolean | undefined
  abreEm: string | null | undefined
  limite: number | undefined
  agoraMs: number
}

/**
 * Coluna da esquerda do console: a FILA (todo agente vê tudo, sem recorte
 * de equipe — a equipe só entra na conversão) e os atendimentos do agente
 * logado. O card da fila some daqui quando QUALQUER agente pega: o backend
 * manda `chat_taken` pra todo mundo e a bridge invalida a lista.
 */
export function ListaConversas({
  fila,
  meus,
  selecionado,
  onSelecionar,
  onPegar,
  pegando,
  erroFila,
  filaAberta,
  abreEm,
  limite,
  agoraMs,
}: Props) {
  const noLimite = limite != null && meus.length >= limite

  return (
    <aside className="cc-lista" aria-label="Conversas">
      <section className="cc-lista__secao">
        <header className="cc-lista__cabecalho">
          <h2>Na fila</h2>
          <span className="cc-lista__contador">{fila.length}</span>
        </header>

        {filaAberta === false && (
          <p className="cc-lista__aviso">
            Fila fechada — fora do horário de atendimento
            {abreEm ? ` (abre ${dataHoraDe(abreEm)})` : ''}.
          </p>
        )}
        {noLimite && (
          <p className="cc-lista__aviso">
            Você está no limite de {limite} atendimentos simultâneos — encerre um para pegar outro.
          </p>
        )}
        {erroFila && <p className="cc-lista__erro">{erroFila}</p>}

        {fila.length === 0 ? (
          <p className="cc-lista__vazio">Ninguém esperando.</p>
        ) : (
          fila.map((c) => (
            <div
              key={c.id}
              className={'cc-card cc-card--fila' + (selecionado === c.id ? ' cc-card--ativo' : '')}
            >
              <button type="button" className="cc-card__corpo" onClick={() => onSelecionar(c.id)}>
                <span className="cc-card__avatar">{iniciais(c.client_name)}</span>
                <span className="cc-card__texto">
                  <span className="cc-card__nome">{c.client_name}</span>
                  <span className="cc-card__meta">
                    {c.company_name} · esperando {haQuanto(c.queued_at, agoraMs).replace('há ', '')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cc-card__pegar"
                disabled={pegando || noLimite}
                onClick={() => onPegar(c.id)}
              >
                Pegar
              </button>
            </div>
          ))
        )}
      </section>

      <section className="cc-lista__secao">
        <header className="cc-lista__cabecalho">
          <h2>Meus atendimentos</h2>
          <span className="cc-lista__contador">
            {meus.length}
            {limite != null ? `/${limite}` : ''}
          </span>
        </header>
        {meus.length === 0 ? (
          <p className="cc-lista__vazio">Nenhum atendimento em andamento.</p>
        ) : (
          meus.map((c) => (
            <button
              key={c.id}
              type="button"
              className={'cc-card' + (selecionado === c.id ? ' cc-card--ativo' : '')}
              onClick={() => onSelecionar(c.id)}
            >
              <span className="cc-card__avatar cc-card__avatar--ativo">{iniciais(c.client_name)}</span>
              <span className="cc-card__texto">
                <span className="cc-card__nome">
                  {c.client_name}
                  {c.unread_count > 0 && <span className="cc-card__badge">{c.unread_count}</span>}
                </span>
                <span className="cc-card__meta">{c.company_name}</span>
                {c.last_message_preview && <span className="cc-card__preview">{c.last_message_preview}</span>}
              </span>
            </button>
          ))
        )}
      </section>
    </aside>
  )
}
