import { useNavigate } from 'react-router-dom'
import { Clock20Regular } from '@fluentui/react-icons'
import { corEstadoSla, textoEstadoSla, tomSla } from '../tickets/format'
import { useTicketsList } from '../tickets/useTicketsList'

const LIMITE = 6

/**
 * O que está estourando ou prestes a estourar em toda a equipe — não só o
 * número vermelho do card "SLA em risco"/"SLA estourado" da faixa de KPI,
 * as linhas de verdade. Duas chamadas (não uma com `view=`) pelo mesmo
 * motivo do card de KPI: `sla=at_risk`/`sla=breached` sozinho já é "não
 * resolvido" (ticket fechado não tem relógio vivo) — é o filtro provado
 * que a Início já usa, sem inventar combinação nova.
 */
export function VencimentosSla() {
  const navigate = useNavigate()
  const estourados = useTicketsList({ sla: 'breached', ordering: 'sla', limit: LIMITE, offset: 0 })
  const emRisco = useTicketsList({ sla: 'at_risk', ordering: 'sla', limit: LIMITE, offset: 0 })

  const carregando = estourados.isLoading || emRisco.isLoading
  const total = (estourados.data?.count ?? 0) + (emRisco.data?.count ?? 0)
  // estourados primeiro — é o que precisa de atenção AGORA
  const linhas = [...(estourados.data?.results ?? []), ...(emRisco.data?.results ?? [])].slice(0, LIMITE)

  return (
    <section className="inicio-lista fui-card" aria-labelledby="inicio-vencendo">
      <header className="inicio-lista__cabecalho">
        <Clock20Regular aria-hidden="true" />
        <h2 id="inicio-vencendo">Vencendo na equipe</h2>
        {!carregando && (
          <span className={'fui-badge' + (total > 0 ? ' fui-badge--danger' : '')}>{total}</span>
        )}
      </header>
      {carregando ? (
        <p className="inicio-lista__vazio">Carregando…</p>
      ) : linhas.length === 0 ? (
        <p className="inicio-lista__vazio">Nada vencendo agora — bom trabalho.</p>
      ) : (
        <ul className="fui-lista">
          {linhas.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="fui-lista__item inicio-lista__item"
                onClick={() => navigate(`/chamados/${t.id}`)}
              >
                <span
                  className="inicio-lista__barra"
                  style={{ background: corEstadoSla(t.sla.resolution) }}
                  aria-hidden="true"
                />
                <span className="inicio-lista__texto">
                  <span className="inicio-lista__assunto">{t.subject}</span>
                  <span className="inicio-lista__meta">
                    {t.reference} · {t.assignee_name ?? 'Sem responsável'}
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
