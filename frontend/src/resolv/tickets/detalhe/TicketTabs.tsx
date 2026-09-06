import { useRef, useState, type KeyboardEvent } from 'react'
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
 *
 * Estrutura de cada aba — DOIS `<button>` irmãos, nenhum dentro do outro:
 *   <div class="ticket-tabs__tab">
 *     <button role="tab">nome</button>      ← participa do tablist
 *     <button>fechar (×)</button>           ← FORA do elemento role="tab"
 *   </div>
 * Um `<button role="tab">` não pode conter outro elemento interativo (o de
 * fechar) sem quebrar a árvore de acessibilidade — um controle dentro do
 * outro não tem como anunciar "botão dentro de aba" de um jeito operável, e
 * na prática cada leitor de tela resolve esse aninhamento de um jeito
 * diferente. Como irmãos, os dois têm alvo de clique e semântica próprios:
 * o de nome participa da navegação por seta (roving tabindex, próximo
 * comentário); o de fechar não é uma "aba" e não entra nesse ciclo.
 */
export function TicketTabs({ idAtivo }: { idAtivo: number }) {
  const navigate = useNavigate()
  const tabs = useTabs((s) => s.tabs)
  const fechar = useTabs((s) => s.fechar)
  const definirAtiva = useTabs((s) => s.definirAtiva)

  // Roving tabindex (padrão WAI-ARIA de tabs): só UM `role="tab"` do grupo
  // tem tabIndex 0 por vez — os outros ficam -1, e Tab entra/sai do grupo
  // inteiro de uma vez, não aba por aba. Começa acompanhando a aba ativa da
  // rota; setas movem o FOCO sem navegar (ativação manual — trocar de ticket
  // é uma navegação de página, cara demais para disparar a cada tecla de
  // seta ao percorrer muitas abas).
  const [abaComFoco, setAbaComFoco] = useState(idAtivo)
  const botoesRef = useRef(new Map<number, HTMLButtonElement>())

  // Ajusta o roving tabindex quando a rota muda por FORA das setas (clique
  // numa aba, navegação direta) — derivado DURANTE o render comparando com o
  // valor anterior, o mesmo padrão que `statusVisto` usa em Compositor.tsx
  // para "sincronizar com uma prop", sem useEffect (setState em effect sem
  // efeito colateral externo é só um passo a mais para o mesmo resultado).
  const [idAtivoVisto, setIdAtivoVisto] = useState(idAtivo)
  if (idAtivoVisto !== idAtivo) {
    setIdAtivoVisto(idAtivo)
    setAbaComFoco(idAtivo)
  }

  // Se a aba com foco roving fechou (fechada por outra aba, ou por si mesma),
  // cai de volta pra ativa — sem isto nenhum `role="tab"` sobraria com
  // tabIndex 0 e o grupo inteiro sairia da ordem de tabulação.
  const abaComFocoValida = tabs.some((a) => a.ticketId === abaComFoco) ? abaComFoco : idAtivo

  function moverFoco(indiceAtual: number, direcao: 1 | -1) {
    if (tabs.length === 0) return
    const proxima = tabs[(indiceAtual + direcao + tabs.length) % tabs.length]
    setAbaComFoco(proxima.ticketId)
    botoesRef.current.get(proxima.ticketId)?.focus()
  }

  function aoTeclarNaAba(e: KeyboardEvent<HTMLButtonElement>, indice: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      moverFoco(indice, 1)
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      moverFoco(indice, -1)
    }
  }

  return (
    <div className="ticket-tabs" role="tablist" aria-label="Tickets abertos">
      {tabs.map((aba, indice) => {
        const ativo = aba.ticketId === idAtivo
        const titulo = aba.resumo?.company_name || aba.resumo?.subject || 'Ticket'
        const ref = aba.resumo?.reference ?? `#${aba.ticketId}`
        const rascunho = aba.draft.trim().length > 0
        return (
          <div
            key={aba.ticketId}
            className={'ticket-tabs__tab' + (ativo ? ' ticket-tabs__tab--ativo' : '')}
          >
            <button
              type="button"
              role="tab"
              // Id + aria-controls fecham o par com o painel único que
              // PaginaDetalheTicket.tsx renderiza (id="detalhe-painel-ticket",
              // role="tabpanel") — sem relação com o aria-controls que o
              // Compositor usa nas PRÓPRIAS abas (Responder/Nota interna, um
              // tablist independente sobre o mesmo <textarea> de composição).
              id={`aba-tab-${aba.ticketId}`}
              aria-controls="detalhe-painel-ticket"
              aria-selected={ativo}
              tabIndex={aba.ticketId === abaComFocoValida ? 0 : -1}
              ref={(el) => {
                if (el) botoesRef.current.set(aba.ticketId, el)
                else botoesRef.current.delete(aba.ticketId)
              }}
              className="ticket-tabs__abrir"
              title={aba.resumo?.subject ? `${ref} · ${aba.resumo.subject}` : ref}
              onKeyDown={(e) => aoTeclarNaAba(e, indice)}
              onClick={() => {
                setAbaComFoco(aba.ticketId)
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
              title={rascunho ? 'Fechar aba — há um rascunho não enviado' : 'Fechar aba'}
              onClick={() => {
                // A aba já sabe que há texto não enviado (é o "· rascunho" ao
                // lado da referência) e `useTabs.fechar` leva o rascunho junto —
                // ele é local por contrato (docs/06: nunca vai para o servidor),
                // então fechar sem perguntar apaga de vez. Pergunta SÓ quando há
                // rascunho: confirmar toda troca de aba viraria ruído.
                if (
                  rascunho &&
                  !window.confirm(
                    `A aba ${ref} tem um rascunho não enviado. Fechar descarta esse texto.`,
                  )
                ) {
                  return
                }
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
