import { useNavigate } from 'react-router-dom'
import { corEstadoSla, textoEstadoSla } from '../tickets/format'
import { useTicketsList } from '../tickets/useTicketsList'
import { EsqueletoLista } from './EsqueletoLista'

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
    <div className="inicio-lista">
      <header className="inicio-lista__cabecalho">
        <h2>Vencendo na equipe</h2>
        {!carregando && <span className="inicio-lista__contador">{total}</span>}
      </header>
      {carregando ? (
        <EsqueletoLista rotulo="Carregando os vencimentos da equipe" />
      ) : linhas.length === 0 ? (
        <p className="inicio-lista__vazio">Nada vencendo agora. Bom trabalho.</p>
      ) : (
        <ul className="inicio-lista__itens">
          {linhas.map((t) => (
            <li key={t.id}>
              <button type="button" className="inicio-lista__item" onClick={() => navigate(`/chamados/${t.id}`)}>
                <span className="inicio-lista__barra" style={{ background: corEstadoSla(t.sla.resolution) }} aria-hidden="true" />
                <span className="inicio-lista__texto">
                  <span className="inicio-lista__assunto">{t.subject}</span>
                  <span className="inicio-lista__meta">
                    {t.reference} · {t.assignee_name ?? 'Sem responsável'}
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
