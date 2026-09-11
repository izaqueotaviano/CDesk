import { useNavigate } from 'react-router-dom'
import { COR_PRIORIDADE, ROTULO_PRIORIDADE, textoEstadoSla, tomSla } from '../tickets/format'
import { useTicketsList } from '../tickets/useTicketsList'
import { Icone } from '../shell/Icone'

const LIMITE = 5

/**
 * Os próprios tickets em aberto, ordenados por urgência de SLA — não a
 * contagem "Meus tickets" da faixa de indicadores (essa continua ali, é útil
 * como visão geral), e sim o PRÓXIMO PASSO: em qual clicar primeiro. Mesma
 * view (`meus-nao-resolvidos`) que o indicador já usa pra contar, aqui
 * pedindo as linhas de verdade em vez de só o `count`.
 */
export function FilaDePrioridade() {
  const navigate = useNavigate()
  const { data, isLoading } = useTicketsList({ view: 'meus-nao-resolvidos', ordering: 'sla', limit: LIMITE, offset: 0 })
  const linhas = data?.results ?? []

  return (
    <section className="inicio-secao" aria-labelledby="inicio-proximos">
      <header className="inicio-secao__cabecalho">
        <Icone nome="person_search" />
        <h2 id="inicio-proximos">Seus próximos</h2>
        {data && <span className="md-badge">{data.count}</span>}
      </header>
      {isLoading ? (
        <p className="inicio-secao__vazio">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="inicio-secao__vazio">Nada pendente com você agora.</p>
      ) : (
        <ul className="md-lista">
          {linhas.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="md-lista__item inicio-secao__item"
                onClick={() => navigate(`/chamados/${t.id}`)}
              >
                {/* prioridade: barra fina + `title`, para não ficar só na cor */}
                <span
                  className="inicio-secao__barra"
                  style={{ background: COR_PRIORIDADE[t.priority] }}
                  title={`Prioridade ${ROTULO_PRIORIDADE[t.priority]}`}
                />
                <span className="inicio-secao__texto">
                  <span className="inicio-secao__assunto">{t.subject}</span>
                  <span className="inicio-secao__meta">
                    {t.reference} · {t.company_name}
                  </span>
                </span>
                <span className={`md-badge md-badge--${tomSla(t.sla.resolution)}`}>
                  <span className="md-badge__ponto" aria-hidden="true" />
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
