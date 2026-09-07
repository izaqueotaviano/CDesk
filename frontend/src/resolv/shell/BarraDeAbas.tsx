import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type Aba } from '@/stores/tabs'
import { NAV } from './Sidebar'
import './barra-de-abas.scss'

/**
 * Barra de abas do shell — Fase 2 da unificação de shell. Ocupa o lugar da
 * Topbar antiga e mostra as duas espécies de aba do store (`stores/tabs.ts`)
 * numa lista só, na ordem em que foram abertas: tickets (o contrato de
 * sempre, várias por vez) e seções (Tickets, Quadro, Chat, Clientes, Avisos,
 * Auditoria, Configurações, Relatórios — uma por vez, dedup por rota).
 * Início NUNCA vira aba — só se chega lá pela Sidebar, o mesmo papel que uma
 * aba fixa de "início" teria, sem precisar ser uma.
 *
 * Diferença do antigo `TicketTabs.tsx` (removido nesta rodada): esta barra
 * monta UMA vez em NovoShell, não uma por página — quem decide o que está
 * aberto é a ROTA atual, observada aqui, não cada página chamando um método
 * de abrir. Ticket continua sendo exceção: `PaginaDetalheTicket` ainda chama
 * `abrirTicket()` ao carregar os dados (é de lá que vem o resumo pro título
 * da aba), esta barra só decide QUAL aba fica marcada como ativa quando a
 * rota é de ticket.
 */

const SECOES = NAV.filter((n) => n.enabled && n.id !== 'inicio')

function secaoDaRota(pathname: string) {
  return SECOES.find((s) => pathname === s.route || pathname.startsWith(`${s.route}/`))
}

/** Deriva a aba que DEVERIA estar em destaque a partir da URL, não do store —
 *  mesmo raciocínio que o antigo `idAtivo` de TicketTabs.tsx documentava:
 *  assim a aba certa acende num link direto ou voltar do navegador, antes de
 *  qualquer efeito rodar. */
function chaveAtivaDaRota(pathname: string): string | null {
  const ticket = pathname.match(/^\/chamados\/(\d+)$/)
  if (ticket) return `ticket:${ticket[1]}`
  const secao = secaoDaRota(pathname)
  return secao ? `secao:${secao.route}` : null
}

function destinoDaAba(aba: Aba): string {
  return aba.tipo === 'ticket' ? `/chamados/${aba.ticketId}` : aba.rota
}

export function BarraDeAbas() {
  const navigate = useNavigate()
  const location = useLocation()
  const tabs = useTabs((s) => s.tabs)
  const abrirSecao = useTabs((s) => s.abrirSecao)
  const definirAtiva = useTabs((s) => s.definirAtiva)
  const fechar = useTabs((s) => s.fechar)

  const chaveDaRota = chaveAtivaDaRota(location.pathname)

  // Garante que a rota atual tem aba — só para SEÇÃO; ticket é o
  // `PaginaDetalheTicket` que abre (comentário no topo do arquivo).
  useEffect(() => {
    if (!chaveDaRota || !chaveDaRota.startsWith('secao:')) return
    const rota = chaveDaRota.slice('secao:'.length)
    const jaExiste = useTabs.getState().tabs.some((a) => a.tipo === 'secao' && a.rota === rota)
    if (jaExiste) {
      if (useTabs.getState().active !== chaveDaRota) definirAtiva(chaveDaRota)
      return
    }
    const secao = SECOES.find((s) => s.route === rota)
    if (secao) abrirSecao(secao.route, secao.label, secao.icon)
    // Só quando a ROTA muda — abrirSecao/definirAtiva são estáveis (zustand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaRota])

  const idAtivo = chaveDaRota ?? useTabs.getState().active

  // Roving tabindex (padrão WAI-ARIA de tabs) — mesma lógica de
  // TicketTabs.tsx: só UM `role="tab"` do grupo tem tabIndex 0 por vez, Tab
  // entra/sai do grupo inteiro de uma vez, setas movem o FOCO sem ativar.
  const [chaveComFoco, setChaveComFoco] = useState(idAtivo)
  const botoesRef = useRef(new Map<string, HTMLButtonElement>())

  const [idAtivoVisto, setIdAtivoVisto] = useState(idAtivo)
  if (idAtivoVisto !== idAtivo) {
    setIdAtivoVisto(idAtivo)
    setChaveComFoco(idAtivo)
  }

  const chaveComFocoValida = tabs.some((a) => chaveAba(a) === chaveComFoco) ? chaveComFoco : idAtivo

  function moverFoco(indiceAtual: number, direcao: 1 | -1) {
    if (tabs.length === 0) return
    const proxima = tabs[(indiceAtual + direcao + tabs.length) % tabs.length]!
    const chave = chaveAba(proxima)
    setChaveComFoco(chave)
    botoesRef.current.get(chave)?.focus()
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

  function fecharAba(aba: Aba, chave: string, ativa: boolean) {
    if (aba.tipo === 'ticket') {
      const rascunho = aba.draft.trim().length > 0
      const ref = aba.resumo?.reference ?? `#${aba.ticketId}`
      // A aba já sabe que há texto não enviado (é o "· rascunho" ao lado da
      // referência) e `fechar` leva o rascunho junto — ele é local por
      // contrato (docs/06: nunca vai para o servidor), então fechar sem
      // perguntar apaga de vez. Pergunta SÓ quando há rascunho: confirmar
      // toda troca de aba viraria ruído.
      if (rascunho && !window.confirm(`A aba ${ref} tem um rascunho não enviado. Fechar descarta esse texto.`)) {
        return
      }
    }
    const restantes = tabs.filter((a) => chaveAba(a) !== chave)
    fechar(chave)
    if (ativa) {
      const proxima = restantes.at(-1)
      navigate(proxima ? destinoDaAba(proxima) : '/inicio')
    }
  }

  if (tabs.length === 0) return null

  return (
    <div className="barra-de-abas" role="tablist" aria-label="Abas abertas">
      {tabs.map((aba, indice) => {
        const chave = chaveAba(aba)
        const ativa = chave === idAtivo
        const titulo = aba.tipo === 'ticket' ? aba.resumo?.company_name || aba.resumo?.subject || 'Ticket' : aba.titulo
        const ref = aba.tipo === 'ticket' ? (aba.resumo?.reference ?? `#${aba.ticketId}`) : null
        const rascunho = aba.tipo === 'ticket' && aba.draft.trim().length > 0
        return (
          <div key={chave} className={'barra-de-abas__tab' + (ativa ? ' barra-de-abas__tab--ativa' : '')}>
            <button
              type="button"
              role="tab"
              // id/aria-controls só faz sentido pra ticket: é o único tipo de
              // aba com um tabpanel de verdade do outro lado
              // (PaginaDetalheTicket.tsx, id="detalhe-painel-ticket"). Aba de
              // seção troca a página inteira ao ativar — não há painel
              // parceiro pra apontar.
              id={aba.tipo === 'ticket' ? `aba-tab-${aba.ticketId}` : undefined}
              aria-controls={aba.tipo === 'ticket' ? 'detalhe-painel-ticket' : undefined}
              aria-selected={ativa}
              tabIndex={chave === chaveComFocoValida ? 0 : -1}
              ref={(el) => {
                if (el) botoesRef.current.set(chave, el)
                else botoesRef.current.delete(chave)
              }}
              className="barra-de-abas__abrir"
              title={aba.tipo === 'ticket' && aba.resumo?.subject ? `${ref} · ${aba.resumo.subject}` : titulo}
              onKeyDown={(e) => aoTeclarNaAba(e, indice)}
              onClick={() => {
                setChaveComFoco(chave)
                definirAtiva(chave)
                navigate(destinoDaAba(aba))
              }}
            >
              {aba.tipo === 'ticket' ? (
                <span className="barra-de-abas__titulo">
                  {aba.resumo?.stage_color && (
                    <span
                      className="barra-de-abas__etapa"
                      style={{ background: aba.resumo.stage_color }}
                      aria-hidden="true"
                    />
                  )}
                  {titulo}
                </span>
              ) : (
                <span className="barra-de-abas__titulo">
                  <i className={aba.icone} aria-hidden="true" />
                  {titulo}
                </span>
              )}
              {ref && (
                <span className="barra-de-abas__num">
                  {ref}
                  {rascunho && (
                    <span className="barra-de-abas__rascunho" title="Rascunho não enviado">
                      · rascunho
                    </span>
                  )}
                </span>
              )}
            </button>
            <button
              type="button"
              className="barra-de-abas__fechar"
              aria-label={`Fechar aba ${titulo}`}
              title="Fechar aba"
              onClick={() => fecharAba(aba, chave, ativa)}
            >
              <i className="ti ti-x" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
