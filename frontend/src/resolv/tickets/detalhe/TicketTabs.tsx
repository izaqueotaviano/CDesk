import { useNavigate } from 'react-router-dom'
import { useTabs } from '@/stores/tabs'
import './ticket-tabs.scss'

/**
 * Abas dos tickets abertos (o print pede: "separação por abas dos tickets que
 * estou trabalhando, pra facilitar a navegação"). Reusa o store `useTabs`, que
 * já implementa o contrato de docs/06-abas-frontend.md: estado local
 * instantâneo + espelho no servidor (/tickets/tabs/) + reconciliação por
 * visibilidade. Aqui é só a UI dele no visual Resolv.
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
        const ref = aba.resumo?.reference ?? `#${aba.ticketId}`
        const rascunho = aba.draft.trim().length > 0
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
              title={aba.resumo?.subject ? `${ref} · ${aba.resumo.subject}` : ref}
              onClick={() => {
                definirAtiva(aba.ticketId)
                navigate(`/chamados/${aba.ticketId}`)
              }}
            >
              <span className="ticket-tabs__titulo">
                {aba.resumo?.stage_color && (
                  <span
                    className="ticket-tabs__etapa"
                    style={{ background: aba.resumo.stage_color }}
                    aria-hidden="true"
                  />
                )}
                {titulo}
              </span>
              <span className="ticket-tabs__num">
                {ref}
                {rascunho && (
                  <span className="ticket-tabs__rascunho" title="Rascunho não enviado">
                    · rascunho
                  </span>
                )}
              </span>
            </button>
            <button
              type="button"
              className="ticket-tabs__fechar"
              aria-label={`Fechar aba ${ref}`}
              title="Fechar aba"
              onClick={() => {
                const restantes = tabs.filter((t) => t.ticketId !== aba.ticketId)
                fechar(aba.ticketId)
                if (ativo) {
                  const proximo = restantes.at(-1)
                  navigate(proximo ? `/chamados/${proximo.ticketId}` : '/chamados')
                }
              }}
            >
              <i className="ti ti-x" />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        className="ticket-tabs__mais"
        aria-label="Abrir outro ticket"
        title="Abrir outro ticket"
        onClick={() => navigate('/chamados')}
      >
        <i className="ti ti-plus" />
      </button>
    </div>
  )
}
