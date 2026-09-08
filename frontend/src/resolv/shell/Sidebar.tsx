/**
 * Sidebar do shell — dois estados: EXPANDIDA (240px, ícone + rótulo) e
 * RECOLHIDA (64px, só ícone). A preferência é de quem usa e fica salva
 * (`stores/prefs`), não é estado de tela.
 *
 * Três zonas, de cima para baixo: a marca (que também é o atalho para o
 * Início), a busca, e a navegação; a zona utilitária (notificações, tema,
 * conta) cai no rodapé porque `__nav` tem `flex: 1`.
 *
 * Só os itens com rota real navegam; Calendário e Notas seguem visíveis mas
 * inertes ("em breve"), em vez de levarem a um 404.
 *
 * Sem tooltip de pseudo-elemento: o `::after` que existia aqui escapava por
 * cima do conteúdo quando a barra estava recolhida. Quem dá o nome do ícone
 * agora é o `aria-label` (leitor de tela) mais o `title` nativo (mouse) — o
 * title é desenhado pelo navegador FORA do documento, então não tem como
 * invadir a área de trabalho nem empurrar layout.
 */
import { useNavigate, useLocation } from 'react-router-dom'
import { useFilaChat, useMeusChats } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { usePrefs } from '@/stores/prefs'
import { BotaoTema } from './BotaoTema'
import { MenuPresenca } from './MenuPresenca'
import { PainelNotificacoes } from './PainelNotificacoes'
import './sidebar.scss'

export type Item = { id: string; label: string; icon: string; route: string; enabled: boolean }

// Exportado: BarraDeAbas.tsx e BuscaComando.tsx reusam esta MESMA lista — abas
// de seção e o grupo "Navegar" da busca vêm daqui, uma fonte só, sem duplicar
// nome/ícone/rota em três lugares. A ORDEM aqui é a ordem que aparece nos três.
export const NAV: Item[] = [
  { id: 'inicio', label: 'Início', icon: 'ti ti-home', route: '/inicio', enabled: true },
  { id: 'tickets', label: 'Tickets', icon: 'ti ti-ticket', route: '/chamados', enabled: true },
  { id: 'chat', label: 'Chats', icon: 'ti ti-message-circle-2', route: '/chat', enabled: true },
  { id: 'kanban', label: 'Quadro', icon: 'ti ti-layout-grid', route: '/quadro', enabled: true },
  { id: 'clientes', label: 'Clientes', icon: 'ti ti-users', route: '/clientes', enabled: true },
  { id: 'avisos', label: 'Avisos', icon: 'ti ti-speakerphone', route: '/avisos', enabled: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'ti ti-chart-bar', route: '/relatorios', enabled: true },
  { id: 'auditoria', label: 'Auditoria e LGPD', icon: 'ti ti-shield-check', route: '/auditoria', enabled: true },
  { id: 'config', label: 'Configurações', icon: 'ti ti-settings', route: '/configuracoes', enabled: true },
  { id: 'calendario', label: 'Calendário', icon: 'ti ti-calendar', route: '/calendario', enabled: false },
  { id: 'notas', label: 'Notas', icon: 'ti ti-note', route: '/notas', enabled: false },
]

export function Sidebar({ onAbrirBusca }: { onAbrirBusca: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const recolhida = usePrefs((s) => s.sidebarRecolhida)
  const alternarSidebar = usePrefs((s) => s.alternarSidebar)

  const ativo = (r: string) =>
    r === '/inicio' ? location.pathname === '/inicio' : location.pathname.startsWith(r)

  // O contador é real: fila + meus atendimentos, atualizado pelo socket (a
  // bridge invalida as duas chaves a cada chat_queued/chat_taken).
  const { data: usuario } = useMe()
  const { data: fila } = useFilaChat(usuario?.is_internal === true)
  const { data: meus } = useMeusChats(usuario?.is_internal === true)
  const conversas = (fila?.length ?? 0) + (meus?.length ?? 0)

  return (
    <aside
      className={'sidebar-rail' + (recolhida ? ' sidebar-rail--recolhida' : '')}
      aria-label="Navegação principal"
    >
      <div className="sidebar-rail__topo">
        {/* Marca + atalho para o Início. Não é um SELETOR de workspace: esta
            instalação atende um espaço só, e um seletor que não troca nada
            seria enfeite. O dia em que houver mais de um, o menu entra aqui. */}
        <button
          type="button"
          className="sidebar-rail__marca"
          aria-label="Resolv — ir para o Início"
          title="Resolv — ir para o Início"
          onClick={() => navigate('/inicio')}
        >
          <svg className="sidebar-rail__logo-mark" viewBox="0 0 236 270" fill="none" aria-hidden="true">
            <path
              d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
              fill="currentColor"
            />
          </svg>
          <span className="sidebar-rail__marca-nome">Resolv</span>
        </button>

        <button
          type="button"
          className="sidebar-rail__alternar"
          aria-label={recolhida ? 'Expandir menu' : 'Recolher menu'}
          title={recolhida ? 'Expandir menu' : 'Recolher menu'}
          aria-expanded={!recolhida}
          onClick={alternarSidebar}
        >
          <i className={recolhida ? 'ti ti-chevron-right' : 'ti ti-chevron-left'} aria-hidden="true" />
        </button>
      </div>

      <button
        type="button"
        className="sidebar-rail__busca"
        aria-label="Buscar e navegar"
        title="Buscar e navegar (Ctrl K)"
        onClick={onAbrirBusca}
      >
        <i className="ti ti-search" aria-hidden="true" />
        <span className="sidebar-rail__busca-rotulo">Buscar</span>
        <kbd className="sidebar-rail__busca-atalho">Ctrl K</kbd>
      </button>

      <nav className="sidebar-rail__nav">
        {NAV.map((item) => {
          const badge = item.id === 'chat' && conversas > 0 ? (conversas > 9 ? '9+' : conversas) : null
          const rotulo =
            item.id === 'chat' && badge
              ? `${item.label} — ${conversas} ${conversas === 1 ? 'conversa' : 'conversas'}`
              : item.enabled
                ? item.label
                : `${item.label} · em breve`
          return (
            <button
              key={item.id}
              type="button"
              className={
                'sidebar-rail__item' +
                (ativo(item.route) ? ' sidebar-rail__item--ativo' : '') +
                (item.enabled ? '' : ' sidebar-rail__item--inerte')
              }
              aria-label={rotulo}
              title={rotulo}
              aria-current={ativo(item.route) ? 'page' : undefined}
              aria-disabled={item.enabled ? undefined : true}
              onClick={() => item.enabled && navigate(item.route)}
            >
              <span className="sidebar-rail__icone">
                <i className={item.icon} aria-hidden="true" />
                {badge != null && <span className="sidebar-rail__badge">{badge}</span>}
              </span>
              {/* aria-hidden: o nome acessível do botão já é o `aria-label`
                  completo (com a contagem de conversas); sem isto o leitor de
                  tela lia o rótulo duas vezes. */}
              <span className="sidebar-rail__rotulo" aria-hidden="true">
                {item.label}
              </span>
              {!item.enabled && (
                <span className="sidebar-rail__em-breve" aria-hidden="true">
                  em breve
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-rail__zona-utilitaria">
        <PainelNotificacoes />
        <BotaoTema />
        <MenuPresenca />
      </div>
    </aside>
  )
}
