import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { chaveAba, useTabs, type Aba } from '@/stores/tabs'
import { NAV } from './Sidebar'
import './barra-de-abas.scss'

/**
 * Barra de abas do shell. Mostra as duas espécies de aba do store
 * (`stores/tabs.ts`) numa lista só, na ordem em que foram abertas: tickets
 * (várias por vez) e seções (uma por rota, dedup por prefixo).
 *
 * Início é a exceção deliberada: é aba FIXA, sempre a primeira, sem botão de
 * fechar — e não mora no store. Não está lá porque nada nela é estado: não
 * abre, não fecha, não reordena. Deixá-la fora evita ter que proteger o store
 * inteiro contra "e se alguém fechar a Início" (o caso em que a barra ficaria
 * sem nenhuma aba e sem para onde voltar).
 *
 * Esta barra monta UMA vez em NovoShell, não uma por página — quem decide o
 * que está aberto é a ROTA atual, observada aqui. Ticket é exceção:
 * `PaginaDetalheTicket` chama `abrirTicket()` ao carregar os dados (é de lá
 * que vem o resumo pro título da aba); a barra só decide qual fica ativa.
 */

const SECOES = NAV.filter((n) => n.enabled && n.id !== 'inicio')

/** Chave da aba fixa. Não colide com as do store (`ticket:`/`secao:`). */
const CHAVE_INICIO = 'inicio'

function secaoDaRota(pathname: string) {
  return SECOES.find((s) => pathname === s.route || pathname.startsWith(`${s.route}/`))
}

/** Deriva a aba que DEVERIA estar em destaque a partir da URL, não do store:
 *  assim a aba certa acende num link direto ou no voltar do navegador, antes
 *  de qualquer efeito rodar. */
function chaveAtivaDaRota(pathname: string): string | null {
  if (pathname === '/inicio') return CHAVE_INICIO
  const ticket = pathname.match(/^\/chamados\/(\d+)$/)
  if (ticket) return `ticket:${ticket[1]}`
  const secao = secaoDaRota(pathname)
  return secao ? `secao:${secao.route}` : null
}

function destinoDaAba(aba: Aba): string {
  return aba.tipo === 'ticket' ? `/chamados/${aba.ticketId}` : aba.rota
}

/** Uma linha da barra. `aba: null` é a Início — fixa, sem fechar. */
type ItemDaBarra = { chave: string; aba: Aba | null }

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

  const itens: ItemDaBarra[] = [
    { chave: CHAVE_INICIO, aba: null },
    ...tabs.map((aba) => ({ chave: chaveAba(aba), aba })),
  ]

  const idAtivo = chaveDaRota ?? useTabs.getState().active

  // Roving tabindex (padrão WAI-ARIA de tabs): só UM `role="tab"` do grupo tem
  // tabIndex 0 por vez, Tab entra/sai do grupo inteiro de uma vez, setas movem
  // o FOCO sem ativar. A Início entra na roda como qualquer outra — ser fixa
  // não é motivo para ficar fora do teclado.
  const [chaveComFoco, setChaveComFoco] = useState<string | null>(idAtivo)
  const botoesRef = useRef(new Map<string, HTMLButtonElement>())

  const [idAtivoVisto, setIdAtivoVisto] = useState(idAtivo)
  if (idAtivoVisto !== idAtivo) {
    setIdAtivoVisto(idAtivo)
    setChaveComFoco(idAtivo)
  }

  const chaveComFocoValida = itens.some((i) => i.chave === chaveComFoco)
    ? chaveComFoco
    : CHAVE_INICIO

  function moverFoco(indiceAtual: number, direcao: 1 | -1) {
    const proximo = itens[(indiceAtual + direcao + itens.length) % itens.length]!
    setChaveComFoco(proximo.chave)
    botoesRef.current.get(proximo.chave)?.focus()
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
    // Fechar a aba ativa cai na última que sobrou; sem nenhuma, no Início —
    // que está sempre ali, então nunca existe o estado "sem aba nenhuma".
    if (ativa) {
      const proxima = restantes.at(-1)
      navigate(proxima ? destinoDaAba(proxima) : '/inicio')
    }
  }

  return (
    <div className="barra-de-abas" role="tablist" aria-label="Abas abertas">
      {itens.map((item, indice) => {
        const { chave, aba } = item
        const ativa = chave === idAtivo
        const fixa = aba === null
        const titulo = fixa
          ? 'Início'
          : aba.tipo === 'ticket'
            ? aba.resumo?.company_name || aba.resumo?.subject || 'Ticket'
            : aba.titulo
        const ref = !fixa && aba.tipo === 'ticket' ? (aba.resumo?.reference ?? `#${aba.ticketId}`) : null
        const rascunho = !fixa && aba.tipo === 'ticket' && aba.draft.trim().length > 0
        return (
          <div
            key={chave}
            className={
              'barra-de-abas__tab' +
              (ativa ? ' barra-de-abas__tab--ativa' : '') +
              (fixa ? ' barra-de-abas__tab--fixa' : '')
            }
          >
            <button
              type="button"
              role="tab"
              // id/aria-controls só faz sentido pra ticket: é o único tipo de
              // aba com um tabpanel de verdade do outro lado
              // (PaginaDetalheTicket.tsx, id="detalhe-painel-ticket"). Aba de
              // seção e Início trocam a página inteira ao ativar — não há
              // painel parceiro pra apontar.
              id={!fixa && aba.tipo === 'ticket' ? `aba-tab-${aba.ticketId}` : undefined}
              aria-controls={!fixa && aba.tipo === 'ticket' ? 'detalhe-painel-ticket' : undefined}
              aria-selected={ativa}
              tabIndex={chave === chaveComFocoValida ? 0 : -1}
              ref={(el) => {
                if (el) botoesRef.current.set(chave, el)
                else botoesRef.current.delete(chave)
              }}
              className="barra-de-abas__abrir"
              title={!fixa && aba.tipo === 'ticket' && aba.resumo?.subject ? `${ref} · ${aba.resumo.subject}` : titulo}
              onKeyDown={(e) => aoTeclarNaAba(e, indice)}
              onClick={() => {
                setChaveComFoco(chave)
                if (fixa) {
                  navigate('/inicio')
                  return
                }
                definirAtiva(chave)
                navigate(destinoDaAba(aba))
              }}
            >
              <span className="barra-de-abas__titulo">
                {fixa && <i className="ti ti-home" aria-hidden="true" />}
                {!fixa && aba.tipo === 'ticket' && aba.resumo?.stage_color && (
                  <span
                    className="barra-de-abas__etapa"
                    style={{ background: aba.resumo.stage_color }}
                    aria-hidden="true"
                  />
                )}
                {!fixa && aba.tipo === 'secao' && <i className={aba.icone} aria-hidden="true" />}
                {titulo}
              </span>
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
            {/* A Início não fecha: é o destino de fallback de todas as outras.
                Sem botão em vez de botão desabilitado — desabilitado sugere
                "dá para fechar, só não agora", e não é o caso. */}
            {!fixa && (
              <button
                type="button"
                className="barra-de-abas__fechar"
                aria-label={`Fechar aba ${titulo}`}
                title="Fechar aba"
                onClick={() => fecharAba(aba, chave, ativa)}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}

      {/* Fora do tablist na leitura: é ação, não aba — por isso vem depois de
          todas e não entra no roving tabindex (Tab normal alcança). */}
      <button
        type="button"
        className="barra-de-abas__novo"
        aria-label="Abrir novo ticket"
        title="Abrir novo ticket"
        onClick={() => navigate('/chamados/novo')}
      >
        <i className="ti ti-plus" aria-hidden="true" />
      </button>
    </div>
  )
}
