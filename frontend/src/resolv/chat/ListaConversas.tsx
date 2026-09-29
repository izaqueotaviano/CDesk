import type { Chat } from '@/api/chat'
import { AvatarComPresenca } from './AvatarComPresenca'
import { EsqueletoLista } from './Esqueletos'
import { dataHoraDe, haQuanto } from './format'

interface Props {
  fila: Chat[]
  /** Primeira carga da fila: esqueleto no lugar da lista. */
  carregando?: boolean
  /** A fila não veio: diz e oferece de novo, em vez de "ninguém esperando". */
  erro?: boolean
  onTentarDeNovo?: () => void
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
  carregando = false,
  erro = false,
  onTentarDeNovo,
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
    <section className="cc-lista__secao" aria-labelledby="cc-fila-titulo">
      <header className="cc-lista__cabecalho">
        <h2 id="cc-fila-titulo">Na fila</h2>
        {fila.length > 0 && <span className="cc-lista__contador">{fila.length}</span>}
      </header>

      {/* Fila fechada é ESTADO (fora do expediente), não alerta: sai neutra,
          com o relógio, e diz quando reabre. */}
      {filaAberta === false && (
        <p className="cc-lista__aviso">
          <i className="ti ti-clock" aria-hidden="true" />
          <span>
            Fila fechada fora do horário de atendimento.
            {abreEm ? ` Abre ${dataHoraDe(abreEm)}.` : ''}
          </span>
        </p>
      )}
      {noLimite && (
        <p className="cc-lista__aviso">
          <i className="ti ti-info-circle" aria-hidden="true" />
          <span>
            Você está no limite de {limite} atendimentos ao mesmo tempo. Encerre um para pegar outro.
          </span>
        </p>
      )}
      {erroFila && (
        <p className="cc-lista__erro" role="alert">
          {erroFila}
        </p>
      )}

      {carregando ? (
        <EsqueletoLista linhas={2} rotulo="Carregando a fila" />
      ) : erro ? (
        <p className="cc-lista__erro" role="alert">
          Não foi possível carregar a fila.{' '}
          {onTentarDeNovo && (
            <button type="button" className="cc-link" onClick={onTentarDeNovo}>
              Tentar de novo
            </button>
          )}
        </p>
      ) : fila.length === 0 ? (
        <p className="cc-lista__vazio">
          Ninguém esperando agora. Quem entrar aparece aqui, com aviso sonoro se você estiver em outra aba.
        </p>
      ) : (
        <ul className="cc-lista__itens">
          {fila.map((c) => (
            <li
              key={c.id}
              className={'cc-card cc-card--fila' + (selecionado === c.id ? ' cc-card--ativo' : '')}
            >
              <button
                type="button"
                className="cc-card__corpo"
                aria-current={selecionado === c.id ? 'true' : undefined}
                onClick={() => onSelecionar(c.id)}
              >
                <AvatarComPresenca nome={c.client_name} presenca={c.client_presence} />
                <span className="cc-card__texto">
                  <span className="cc-card__linha">
                    <span className="cc-card__nome">{c.client_name}</span>
                  </span>
                  <span className="cc-card__meta">
                    {c.company_name} · esperando {haQuanto(c.queued_at, agoraMs).replace('há ', '')}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="cc-card__pegar"
                disabled={pegando || noLimite}
                aria-label={`Pegar ${c.client_name}`}
                onClick={() => onPegar(c.id)}
              >
                Pegar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
