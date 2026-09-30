/**
 * Sidebar do shell — três formas: EXPANDIDA (248px, ícone + rótulo),
 * RECOLHIDA (52px, só ícone) e, em tela pequena, GAVETA por cima do conteúdo
 * (abre pelo botão de menu da barra superior, fecha no véu, no X, no Esc ou
 * ao navegar). Expandida/recolhida é preferência de quem usa e fica salva
 * (`stores/prefs`); a gaveta é estado de tela e mora no NovoShell.
 *
 * O desenho segue a referência (Copilot), zona por zona:
 *
 *   - topo: a marca (atalho para o Início) e o botão de recolher. Recolhida,
 *     sobra só o botão — como na referência;
 *   - a ação primária, "Novo ticket", com o ícone em círculo cheio: é o
 *     "Novo chat" daqui;
 *   - "Buscar", como item comum, e os cinco destinos do dia a dia;
 *   - "Mais", um menu com o que se abre de vez em quando (avisos, notas,
 *     relatórios, auditoria, configurações). Seis destinos a menos na
 *     coluna é o que deixa espaço para…
 *   - "Trabalhando agora", os tickets abertos, só em texto — a lista de conversas da
 *     referência. Recolhida, some, como lá;
 *   - no rodapé, só a conta. Notificações e tema subiram para o canto
 *     superior direito (NovoShell), que é onde a referência os põe.
 *
 * Só os itens com rota real navegam; Calendário segue no "Mais", inerte
 * ("em breve"), em vez de levar a um 404.
 *
 * O nome de cada ícone vem do `aria-label` (leitor de tela) mais o `title`
 * nativo (mouse) — o title é desenhado pelo navegador FORA do documento,
 * então não invade a área de trabalho com a barra recolhida.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useFilaChat, useMeusChats } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { usePrefs } from '@/stores/prefs'
import { useTabs } from '@/stores/tabs'
import { ListaTrabalho } from './ListaTrabalho'
import { MenuFlutuante } from './MenuFlutuante'
import { MenuPresenca } from './MenuPresenca'
import './sidebar.scss'

export type Item = {
  id: string
  label: string
  /** Classe Tabler (`ti ti-*`) — a mesma na sidebar, no "Mais" e na busca. */
  icon: string
  route: string
  enabled: boolean
  /** Mora no menu "Mais", não na coluna. Só a Sidebar lê: a busca (Ctrl K)
   *  consome a mesma lista e mostra todos os destinos. */
  mais?: boolean
}

// Exportado: BuscaComando.tsx reusa esta MESMA lista no grupo "Navegar" —
// uma fonte só de nome, ícone e rota. A ORDEM aqui é a ordem nos dois.
export const NAV: Item[] = [
  { id: 'inicio', label: 'Início', icon: 'ti ti-home', route: '/inicio', enabled: true },
  { id: 'tickets', label: 'Tickets', icon: 'ti ti-ticket', route: '/chamados', enabled: true },
  { id: 'chat', label: 'Chats', icon: 'ti ti-message-circle-2', route: '/chat', enabled: true },
  { id: 'kanban', label: 'Quadro', icon: 'ti ti-layout-grid', route: '/quadro', enabled: true },
  { id: 'clientes', label: 'Clientes', icon: 'ti ti-users', route: '/clientes', enabled: true },
  { id: 'avisos', label: 'Avisos', icon: 'ti ti-speakerphone', route: '/avisos', enabled: true, mais: true },
  { id: 'notas', label: 'Notas', icon: 'ti ti-note', route: '/notas', enabled: true, mais: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'ti ti-chart-bar', route: '/relatorios', enabled: true, mais: true },
  { id: 'auditoria', label: 'Auditoria e LGPD', icon: 'ti ti-shield-check', route: '/auditoria', enabled: true, mais: true },
  { id: 'config', label: 'Configurações', icon: 'ti ti-settings', route: '/configuracoes', enabled: true, mais: true },
  { id: 'calendario', label: 'Calendário', icon: 'ti ti-calendar', route: '/calendario', enabled: false, mais: true },
]

const PRINCIPAIS = NAV.filter((n) => !n.mais)
const SECUNDARIOS = NAV.filter((n) => n.mais)

interface Props {
  onAbrirBusca: () => void
  /** Presente só em tela pequena (NovoShell decide): a barra vira gaveta. */
  gaveta?: { aberta: boolean; onFechar: () => void }
}

const FOCAVEIS = 'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])'

export function Sidebar({ onAbrirBusca, gaveta }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const preferenciaRecolhida = usePrefs((s) => s.sidebarRecolhida)
  const alternarSidebar = usePrefs((s) => s.alternarSidebar)
  const asideRef = useRef<HTMLElement>(null)

  // Na gaveta a preferência não vale: ela abre sempre inteira, com rótulos —
  // uma gaveta de 64px só com ícones não teria motivo pra cobrir o conteúdo.
  const emGaveta = gaveta !== undefined
  const recolhida = preferenciaRecolhida && !emGaveta
  const gavetaAberta = emGaveta && gaveta.aberta

  // UM estado ativo por vez na sidebar inteira. O ticket aberto acende na
  // lista "Trabalhando agora", "novo" acende em Novo ticket — e "Tickets" só
  // acende na lista em si. Exceção: se o ticket da tela não está visível lá
  // (barra recolhida, ou o resumo ainda não chegou), quem acende é Tickets,
  // para a pessoa nunca ficar sem saber onde está.
  const caminho = location.pathname
  const naNovoTicket = caminho === '/chamados/novo'
  const idNaRota = caminho.match(/^\/chamados\/(\d+)$/)?.[1]
  const ticketVisivelNaLista = useTabs((st) =>
    idNaRota !== undefined && st.tabs.some((a) => a.tipo === 'ticket' && String(a.ticketId) === idNaRota),
  )
  const ativo = (r: string) => {
    if (r === '/inicio') return caminho === '/inicio'
    if (r === '/chamados') {
      if (caminho === '/chamados') return true
      if (naNovoTicket) return false
      if (idNaRota) return recolhida || !ticketVisivelNaLista
      return caminho.startsWith('/chamados/')
    }
    return caminho === r || caminho.startsWith(`${r}/`)
  }

  const [maisAberto, setMaisAberto] = useState(false)
  const maisRef = useRef<HTMLButtonElement>(null)
  const secundarioAtual = SECUNDARIOS.find((n) => n.enabled && ativo(n.route))

  // O contador é real: fila + meus atendimentos, atualizado pelo socket (a
  // bridge invalida as duas chaves a cada chat_queued/chat_taken).
  const { data: usuario } = useMe()
  const { data: fila } = useFilaChat(usuario?.is_internal === true)
  const { data: meus } = useMeusChats(usuario?.is_internal === true)
  const conversas = (fila?.length ?? 0) + (meus?.length ?? 0)

  // Gaveta aberta: o foco entra (no botão de fechar — é o primeiro e o mais
  // previsível), Esc fecha, e ao fechar o foco volta pra onde estava.
  useEffect(() => {
    if (!gavetaAberta) return
    const origem = document.activeElement as HTMLElement | null
    asideRef.current?.querySelector<HTMLElement>('.sidebar-rail__alternar')?.focus()
    const aoTeclar = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') gaveta?.onFechar()
    }
    document.addEventListener('keydown', aoTeclar)
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      origem?.focus?.()
    }
    // `gaveta` muda de identidade a cada render do NovoShell; o que importa é
    // o booleano.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gavetaAberta])

  // Trava de foco só na gaveta: é modal (tem véu), então Tab circula dentro.
  function aoTeclarNaGaveta(e: KeyboardEvent<HTMLElement>) {
    if (!gavetaAberta || e.key !== 'Tab' || !asideRef.current) return
    const focaveis = Array.from(asideRef.current.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
      (el) => el.offsetParent !== null,
    )
    if (focaveis.length === 0) return
    const primeiro = focaveis[0]!
    const ultimo = focaveis[focaveis.length - 1]!
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault()
      ultimo.focus()
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault()
      primeiro.focus()
    }
  }

  const alternar = emGaveta ? (
    <button
      type="button"
      className="sidebar-rail__alternar"
      aria-label="Fechar menu"
      title="Fechar menu"
      onClick={gaveta.onFechar}
    >
      <i className="ti ti-x" aria-hidden="true" />
    </button>
  ) : (
    <button
      type="button"
      className="sidebar-rail__alternar"
      aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
      title={recolhida ? 'Expandir menu' : 'Recolher menu'}
      aria-expanded={!recolhida}
      onClick={alternarSidebar}
    >
      <i
        className={recolhida ? 'ti ti-layout-sidebar-left-expand' : 'ti ti-layout-sidebar-left-collapse'}
        aria-hidden="true"
      />
    </button>
  )

  return (
    <>
      {/* Véu da gaveta — clicar fora fecha, como em qualquer painel modal. */}
      {emGaveta && gavetaAberta && (
        <div className="sidebar-veu" onClick={gaveta.onFechar} aria-hidden="true" />
      )}
      <aside
        ref={asideRef}
        className={
          'sidebar-rail' +
          (recolhida ? ' sidebar-rail--recolhida' : '') +
          (emGaveta ? ' sidebar-rail--gaveta' : '') +
          (gavetaAberta ? ' sidebar-rail--gaveta-aberta' : '')
        }
        aria-label="Navegação principal"
        // Fechada em tela pequena ela está fora da tela (sidebar.scss): some
        // também da árvore acessível, senão o leitor de tela "vê" uma barra
        // que ninguém consegue tocar.
        aria-hidden={emGaveta && !gavetaAberta ? true : undefined}
        role={gavetaAberta ? 'dialog' : undefined}
        aria-modal={gavetaAberta ? true : undefined}
        onKeyDown={aoTeclarNaGaveta}
      >
        <div className="sidebar-rail__topo">
          {/* Recolhida, o topo é só o botão de expandir — como na referência.
              A marca volta quando há espaço para o nome ao lado. */}
          {!recolhida && (
            <button
              type="button"
              className="sidebar-rail__marca"
              aria-label="Resolv: ir para o Início"
              title="Resolv: ir para o Início"
              onClick={() => navigate('/inicio')}
            >
              <span className="sidebar-rail__logo">
                <svg className="sidebar-rail__logo-mark" viewBox="0 0 236 270" fill="none" aria-hidden="true">
                  <path
                    d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
              <span className="sidebar-rail__marca-nome">Resolv</span>
            </button>
          )}
          {alternar}
        </div>

        <nav className="sidebar-rail__nav">
          {/* A ação primária. Círculo cheio, como o "Novo chat" da referência:
              é o único ícone preenchido da coluna, e por isso o que o olho
              encontra primeiro. */}
          <button
            type="button"
            className={'sidebar-rail__item sidebar-rail__item--primaria' + (naNovoTicket ? ' sidebar-rail__item--ativo' : '')}
            aria-label="Novo ticket"
            title="Novo ticket"
            aria-current={naNovoTicket ? 'page' : undefined}
            onClick={() => navigate('/chamados/novo')}
          >
            <span className="sidebar-rail__icone">
              <span className="sidebar-rail__novo" aria-hidden="true">
                <i className="ti ti-plus" />
              </span>
            </span>
            <span className="sidebar-rail__rotulo" aria-hidden="true">
              Novo ticket
            </span>
          </button>

          <button
            type="button"
            className="sidebar-rail__item"
            aria-label="Buscar e navegar"
            title="Buscar e navegar (Ctrl K)"
            aria-keyshortcuts="Control+K Meta+K"
            onClick={onAbrirBusca}
          >
            <span className="sidebar-rail__icone">
              <i className="ti ti-search" aria-hidden="true" />
            </span>
            <span className="sidebar-rail__rotulo" aria-hidden="true">
              Buscar
            </span>
          </button>

          {PRINCIPAIS.map((item) => {
            const badge = item.id === 'chat' && conversas > 0 ? (conversas > 9 ? '9+' : conversas) : null
            const rotulo =
              item.id === 'chat' && badge
                ? `${item.label} (${conversas} ${conversas === 1 ? 'conversa' : 'conversas'})`
                : item.label
            return (
              <button
                key={item.id}
                type="button"
                className={'sidebar-rail__item' + (ativo(item.route) ? ' sidebar-rail__item--ativo' : '')}
                aria-label={rotulo}
                title={rotulo}
                aria-current={ativo(item.route) ? 'page' : undefined}
                onClick={() => navigate(item.route)}
              >
                <span className="sidebar-rail__icone">
                  <i className={item.icon} aria-hidden="true" />
                  {badge != null && <span className="sidebar-rail__badge">{badge}</span>}
                </span>
                {/* aria-hidden: o nome acessível do botão já é o `aria-label`
                    completo (com a contagem de conversas); sem isto o leitor
                    de tela lia o rótulo duas vezes. */}
                <span className="sidebar-rail__rotulo" aria-hidden="true">
                  {item.label}
                </span>
              </button>
            )
          })}

          {/* "Mais" acende quando a tela atual é um dos destinos dele — a
              pessoa sabe que está numa área secundária, e o nome acessível
              diz qual. */}
          <button
            ref={maisRef}
            type="button"
            className={'sidebar-rail__item' + (secundarioAtual ? ' sidebar-rail__item--ativo' : '')}
            aria-label={secundarioAtual ? `Mais (você está em ${secundarioAtual.label})` : 'Mais'}
            title="Mais"
            aria-haspopup="menu"
            aria-expanded={maisAberto}
            onClick={() => setMaisAberto((v) => !v)}
          >
            <span className="sidebar-rail__icone">
              <i className="ti ti-dots" aria-hidden="true" />
            </span>
            <span className="sidebar-rail__rotulo" aria-hidden="true">
              Mais
            </span>
          </button>
          <MenuFlutuante
            aberto={maisAberto}
            onFechar={() => setMaisAberto(false)}
            rotulo="Mais seções"
            obterAncora={() => maisRef.current}
            itens={SECUNDARIOS.map((n) => ({
              rotulo: n.enabled ? n.label : `${n.label} · em breve`,
              icone: n.icon,
              desabilitado: !n.enabled,
              onSelecionar: () => navigate(n.route),
            }))}
          />
        </nav>

        {!recolhida && (
          <div className="sidebar-rail__trabalho">
            <ListaTrabalho />
          </div>
        )}

        <div className="sidebar-rail__conta">
          <MenuPresenca />
        </div>
      </aside>
    </>
  )
}
