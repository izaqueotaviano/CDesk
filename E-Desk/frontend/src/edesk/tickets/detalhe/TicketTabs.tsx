import { useNavigate } from 'react-router-dom'
import { useTabs } from '@/stores/tabs'
import './ticket-tabs.scss'

/**
 * Abas dos tickets abertos (o print pede: "separação por abas dos tickets que
 * estou trabalhando, pra facilitar a navegação"). Reusa o store `useTabs`, que
 * já implementa o contrato de docs/06-abas-frontend.md: estado local
 * instantâneo + espelho no servidor (/tickets/tabs/) + reconciliação por
 * visibilidade. Aqui é só a UI dele no visual E-Desk.
 *
 * `idAtivo` vem da rota (não do store) — assim a aba certa acende mesmo quando
 * a pessoa chega por link direto, antes de o store terminar a reconciliação.
 */
export function TicketTabs({ idAtivo }: { idAtivo: number }) {
  const navigate = useNavigate()
  const tabs = useTabs((s) => s.tabs)
  const fechar = useTabs((s) => s.fechar)
  const definirAtiva = useTabs((s) => s.definirAtiva)

  return (
    <div className="ticket-tabs" role="tablist" aria-label="Tickets abertos">
      {tabs.map((aba) => {
        const ativo = aba.ticketId === idAtivo
        const titulo = aba.resumo?.company_name || aba.resumo?.subject || 'Ticket'
        return (
          <div
            key={aba.ticketId}
            role="tab"
            aria-selected={ativo}
            className={'ticket-tabs__tab' + (ativo ? ' ticket-tabs__tab--ativo' : '')}
          >
            <button
              type="button"
              className="ticket-tabs__abrir"
              onClick={() => {
                definirAtiva(aba.ticketId)
                navigate(`/chamados/${aba.ticketId}`)
              }}
            >
              <span className="ticket-tabs__titulo">{titulo}</span>
              <span className="ticket-tabs__num">{aba.resumo?.reference ?? `#${aba.ticketId}`}</span>
            </button>
            <button
              type="button"
              className="ticket-tabs__fechar"
              aria-label={`Fechar ${aba.resumo?.reference ?? aba.ticketId}`}
              onClick={() => {
                const restantes = tabs.filter((t) => t.ticketId !== aba.ticketId)
                fechar(aba.ticketId)
                if (ativo) {
                  const proximo = restantes.at(-1)
                  navigate(proximo ? `/chamados/${proximo.ticketId}` : '/chamados')
                }
              }}
            >
              <i className="ri-close-line" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        className="ticket-tabs__mais"
        aria-label="Abrir outro ticket"
        onClick={() => navigate('/chamados')}
      >
        <i className="ri-add-circle-line" />
      </button>
    </div>
  )
}
