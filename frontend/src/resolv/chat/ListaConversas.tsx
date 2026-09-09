import type { Chat } from '@/api/chat'
import { AvatarComPresenca } from './AvatarComPresenca'
import { dataHoraDe, haQuanto } from './format'

interface Props {
  fila: Chat[]
  selecionado: number | null
  onSelecionar: (id: number) => void
  onPegar: (id: number) => void
  pegando: boolean
  erroFila: string | null
  filaAberta: boolean | undefined
  abreEm: string | null | undefined
  limite: number | undefined
  /** Quantos o agente já tem em andamento — é o que trava o "Pegar". */
  emAtendimento: number
  agoraMs: number
}

/**
 * A FILA — quem está esperando ser atendido. Todo agente vê tudo, sem
 * recorte de equipe (a equipe só entra na conversão), e o card some daqui
 * quando QUALQUER agente pega: o backend manda `chat_taken` pra todo mundo
 * e a bridge invalida a lista.
 *
 * As conversas EM ANDAMENTO saíram daqui para `ListaClientes`, que as
 * agrupa por pessoa. A separação é a diferença entre as duas coisas: fila é
 * trabalho a fazer, e some ao ser pego; conversa é com quem se está
 * falando, e continua existindo depois.
 */
export function ListaConversas({
  fila,
  selecionado,
  onSelecionar,
  onPegar,
  pegando,
  erroFila,
  filaAberta,
  abreEm,
  limite,
  emAtendimento,
  agoraMs,
}: Props) {
  const noLimite = limite != null && emAtendimento >= limite

  // Sem <aside> próprio: quem desenha a coluna (e o rótulo acessível dela) é
  // a PaginaChat, que também abriga a aba "Finalizados". Dois <aside> um
  // dentro do outro dariam dois marcos de navegação para a mesma coluna.
  return (
    <>
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
                <AvatarComPresenca nome={c.client_name} presenca={c.client_presence} />
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

    </>
  )
}
