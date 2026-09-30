import { useId } from 'react'
import { Link } from 'react-router-dom'
import { ROTULO_STATUS } from '../format'
import { LIMITE_OUTROS_TICKETS, useOutrosTicketsDoSolicitante } from './dados'
import { mensagemDeErro } from './linhaDoTempo'
import type { TicketDetalhe } from './tiposDetalhe'
import './outros-tickets.scss'

/** "12/09/2026" — a data basta; a hora do chamado antigo não ajuda a decidir nada. */
function dataCurta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}

/**
 * "Outros tickets de <nome>" no painel do cliente: os últimos chamados da
 * mesma pessoa, sem o que está na tela. É a pergunta que todo atendente faz
 * antes de responder — "isso já aconteceu antes?" — e que antes pedia sair do
 * ticket, filtrar a fila e voltar.
 *
 * O recorte respeita o escopo de quem pede (é a mesma listagem da fila), e
 * "Ver todos" leva para a fila filtrada pelo mesmo solicitante.
 */
export function OutrosTicketsDoSolicitante({ ticket }: { ticket: TicketDetalhe }) {
  const idTitulo = useId()
  const solicitanteId = ticket.requester?.id
  const nome = ticket.requester?.name ?? ticket.requester_display
  const { data, isLoading, isError, error, refetch, isFetching } = useOutrosTicketsDoSolicitante(
    solicitanteId,
    ticket.id,
  )

  // Conteúdo mascarado (sem `requester`) ou backend sem o campo: sem a
  // pergunta certa a fazer, a seção não aparece — melhor que uma lista errada.
  // (O painel já nem monta este componente nesse caso; a guarda fica por
  // quem o usar em outro lugar.)
  if (solicitanteId == null) return null

  return (
    <section className="cliente__grupo outros-tickets" aria-labelledby={idTitulo}>
      <div className="outros-tickets__topo">
        <h2 id={idTitulo} className="cliente__titulo">
          Outros tickets de {nome}
        </h2>
        {data && data.total > 0 && (
          <Link
            className="outros-tickets__todos"
            to={`/chamados?solicitante=${solicitanteId}`}
            aria-label={`Ver todos os tickets de ${nome}`}
          >
            Ver todos{data.total > data.itens.length ? ` (${data.total})` : ''}
          </Link>
        )}
      </div>

      {isLoading ? (
        <ul className="outros-tickets__lista" aria-busy="true" aria-label="Carregando outros tickets">
          {[0, 1, 2].map((i) => (
            <li key={i} className="outros-tickets__esqueleto">
              <span className="outros-tickets__esq outros-tickets__esq--curto" />
              <span className="outros-tickets__esq" />
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="outros-tickets__erro" role="alert">
          <span>{mensagemDeErro(error, 'Não foi possível carregar os outros tickets.')}</span>
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Tentando…' : 'Tentar de novo'}
          </button>
        </div>
      ) : !data || data.itens.length === 0 ? (
        <p className="outros-tickets__vazio">
          Este é o primeiro ticket de {nome}.
        </p>
      ) : (
        <ul className="outros-tickets__lista">
          {data.itens.map((t) => (
            <li key={t.id}>
              <Link className="outros-tickets__item" to={`/chamados/${t.id}`}>
                <span className="outros-tickets__linha">
                  <span className="outros-tickets__ref">{t.reference}</span>
                  <span
                    className="outros-tickets__status"
                    style={{ ['--cor' as string]: t.stage_color || undefined }}
                  >
                    <span className="outros-tickets__ponto" aria-hidden="true" />
                    {t.stage_name || ROTULO_STATUS[t.status]}
                  </span>
                  <time className="outros-tickets__data" dateTime={t.created_at}>
                    {dataCurta(t.created_at)}
                  </time>
                </span>
                <span className="outros-tickets__assunto">{t.subject}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && data.total > LIMITE_OUTROS_TICKETS && (
        <span className="outros-tickets__nota">
          Mostrando os {LIMITE_OUTROS_TICKETS} mais recentes.
        </span>
      )}
    </section>
  )
}
