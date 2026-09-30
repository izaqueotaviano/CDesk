import { useNavigate } from 'react-router-dom'
import { corEstadoSla, COR_PRIORIDADE, textoEstadoSla } from '../tickets/format'
import { useTicketsList } from '../tickets/useTicketsList'
import { EsqueletoLista } from './EsqueletoLista'

const LIMITE = 5

/**
 * Os próprios tickets em aberto, ordenados por urgência de SLA — não a
 * contagem "Meus tickets" da faixa de KPI (essa continua ali, é útil como
 * visão geral), e sim o PRÓXIMO PASSO: em qual clicar primeiro. Mesma view
 * (`meus-nao-resolvidos`) que o card de KPI já usa pra contar, aqui pedindo
 * as linhas de verdade em vez de só o `count`.
 */
export function FilaDePrioridade() {
  const navigate = useNavigate()
  const { data, isLoading } = useTicketsList({ view: 'meus-nao-resolvidos', ordering: 'sla', limit: LIMITE, offset: 0 })
  const linhas = data?.results ?? []

  return (
    <div className="inicio-lista">
      <header className="inicio-lista__cabecalho">
        <h2>Seus próximos</h2>
        {data && <span className="inicio-lista__contador">{data.count}</span>}
      </header>
      {isLoading ? (
        <EsqueletoLista rotulo="Carregando seus próximos tickets" />
      ) : linhas.length === 0 ? (
        <p className="inicio-lista__vazio">Nada pendente com você agora.</p>
      ) : (
        <ul className="inicio-lista__itens">
          {linhas.map((t) => (
            <li key={t.id}>
              <button type="button" className="inicio-lista__item" onClick={() => navigate(`/tickets/${t.id}`)}>
                <span className="inicio-lista__barra" style={{ background: COR_PRIORIDADE[t.priority] }} aria-hidden="true" />
                <span className="inicio-lista__texto">
                  <span className="inicio-lista__assunto">{t.subject}</span>
                  <span className="inicio-lista__meta">
                    {t.reference} · {t.company_name}
                  </span>
                </span>
                <span className="inicio-lista__sla" style={{ color: corEstadoSla(t.sla.resolution) }}>
                  {textoEstadoSla(t.sla.resolution)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
