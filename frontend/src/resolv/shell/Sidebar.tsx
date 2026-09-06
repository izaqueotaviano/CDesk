/**
 * Sidebar Rail (56px) — design system Resolv. Portada da referência
 * (resolvdesignsystem.zip), com uma diferença honesta: só os itens que têm
 * rota real neste app navegam; os demais ficam visíveis mas inertes
 * (`enabled: false`) com tooltip "em breve", em vez de levar a um 404. Tickets,
 * Quadro e Chats são as entregas até aqui — o resto do shell está aqui para dar
 * o enquadramento visual correto, não para prometer telas que ainda não existem.
 */
import { useLocation, useNavigate } from 'react-router-dom'
import './sidebar.scss'

type Item = { id: string; label: string; icon: string; route: string; enabled: boolean }

const NAV: Item[] = [
  { id: 'inicio', label: 'Início', icon: 'ti ti-home', route: '/inicio', enabled: true },
  { id: 'tickets', label: 'Tickets', icon: 'ti ti-ticket', route: '/chamados', enabled: true },
  { id: 'kanban', label: 'Quadro', icon: 'ti ti-layout-grid', route: '/quadro', enabled: true },
  { id: 'chat', label: 'Chats', icon: 'ti ti-message-circle-2', route: '/chat', enabled: true },
  // As três rotas abaixo existem de verdade — só ficam noutra base do design
  // system (cvzdesk, CvzAppLayout): clicar troca de visual, mas leva a uma
  // tela real, não a um 404 (o mesmo padrão que a própria sidebar da cvzdesk
  // usa hoje pra "clientes"/"configuracoes"/"relatorios" em `AppLayout.tsx`).
  { id: 'clientes', label: 'Clientes', icon: 'ti ti-users', route: '/clientes', enabled: true },
  { id: 'config', label: 'Configurações', icon: 'ti ti-settings', route: '/configuracoes', enabled: true },
  { id: 'relatorios', label: 'Relatórios', icon: 'ti ti-chart-bar', route: '/relatorios', enabled: true },
  { id: 'calendario', label: 'Calendário', icon: 'ti ti-calendar', route: '/calendario', enabled: false },
  { id: 'notas', label: 'Notas', icon: 'ti ti-note', route: '/notas', enabled: false },
]

export function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const ativo = (r: string) =>
    r === '/inicio' ? location.pathname === '/inicio' : location.pathname.startsWith(r)

  return (
    <aside className="sidebar-rail" aria-label="Navegação principal">
      <div
        className="sidebar-rail__logo"
        data-tooltip="Início"
        role="button"
        tabIndex={0}
        onClick={() => navigate('/inicio')}
        onKeyDown={(e) => e.key === 'Enter' && navigate('/inicio')}
      >
        <svg className="sidebar-rail__logo-mark" viewBox="0 0 236 270" fill="none" aria-hidden="true">
          <path
            d="M128.101 0C151.417 0 170.802 4.03 186.255 12.09C201.98 19.88 213.909 29.82 222.042 41.91C230.447 54 235.056 67.16 235.869 81.4C236.683 95.64 233.7 109.08 226.923 121.7C220.145 134.33 209.707 145.21 195.609 154.34C181.511 163.48 163.617 168.99 141.928 170.87C139.217 170.87 136.506 172.21 133.795 174.9C131.355 177.31 130.135 180.13 130.135 183.36C130.135 186.58 132.033 189.54 135.828 192.22C139.624 194.64 146.808 195.85 157.382 195.85H223.262V269.6H162.668C146.402 269.6 132.71 267.72 121.595 263.96C110.75 260.19 102.074 255.36 95.568 249.45C89.061 243.54 84.588 236.96 82.148 229.7C79.979 222.18 79.572 214.79 80.928 207.54C82.554 200.02 85.808 193.16 90.688 186.99C95.839 180.54 102.346 175.3 110.208 171.27H65.881V269.6L0 270V0H128.101ZM116.308 116.46C132.575 116.46 144.775 113.24 152.908 106.79C161.042 100.34 165.108 93.36 165.108 85.84C165.108 78.04 161.042 70.93 152.908 64.48C144.775 58.03 132.575 54.81 116.308 54.81H65.881V116.46H116.308Z"
            fill="currentColor"
          />
        </svg>
      </div>

      <div className="sidebar-rail__sep" />

      <nav className="sidebar-rail__nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              'sidebar-rail__item' +
              (ativo(item.route) ? ' sidebar-rail__item--ativo' : '') +
              (item.enabled ? '' : ' sidebar-rail__item--inerte')
            }
            data-tooltip={item.enabled ? item.label : `${item.label} · em breve`}
            aria-label={item.label}
            aria-current={ativo(item.route) ? 'page' : undefined}
            aria-disabled={item.enabled ? undefined : true}
            onClick={() => item.enabled && navigate(item.route)}
          >
            <i className={item.icon} />
          </button>
        ))}
      </nav>
    </aside>
  )
}
