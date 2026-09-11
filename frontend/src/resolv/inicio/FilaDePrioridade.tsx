import { useNavigate } from 'react-router-dom'
import { PersonClock20Regular } from '@fluentui/react-icons'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE, textoEstadoSla, tomSla } from '../tickets/format'
import { useTicketsList } from '../tickets/useTicketsList'

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
    <section className="inicio-lista fui-card" aria-labelledby="inicio-proximos">
      <header className="inicio-lista__cabecalho">
        <PersonClock20Regular aria-hidden="true" />
        <h2 id="inicio-proximos">Seus próximos</h2>
        {data && <span className="fui-badge">{data.count}</span>}
      </header>
      {isLoading ? (
        <p className="inicio-lista__vazio">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="inicio-lista__vazio">Nada pendente com você agora.</p>
      ) : (
        <ul className="fui-lista">
          {linhas.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="fui-lista__item inicio-lista__item"
                onClick={() => navigate(`/chamados/${t.id}`)}
              >
                {/* prioridade: barra fina + `title`, para não ficar só na cor */}
                <span
                  className="inicio-lista__barra"
                  style={{ background: COR_PRIORIDADE[t.priority] }}
                  title={`Prioridade ${ROTULO_PRIORIDADE[t.priority]}`}
                />
                <span className="inicio-lista__texto">
                  <span className="inicio-lista__assunto">{t.subject}</span>
                  <span className="inicio-lista__meta">
                    {t.reference} · {t.company_name}
                  </span>
                </span>
                <span className={`fui-badge fui-badge--${tomSla(t.sla.resolution)}`}>
                  <span className="fui-badge__ponto" aria-hidden="true" />
                  {textoEstadoSla(t.sla.resolution)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
