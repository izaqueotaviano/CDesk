import type { ComponentType } from 'react';
import { Tooltip } from '../Tooltip/Tooltip';
import {
  IconHome,
  IconTicket,
  IconChats,
  IconClients,
  IconSettings,
  IconReports,
  IconCalendar,
  IconNotes,
  IconMegaphone,
  IconAudit,
  type IconProps,
} from '../icons';
import './Sidebar.scss';

export type NavId =
  | 'inicio'
  | 'tickets'
  | 'chats'
  | 'clientes'
  | 'avisos'
  | 'auditoria'
  | 'configuracoes'
  | 'relatorios'
  | 'calendario'
  | 'notas';

export interface NavItem {
  id: NavId;
  label: string;
  Icon: ComponentType<IconProps>;
  /** Contador opcional — some quando 0. */
  count?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'inicio', label: 'Início', Icon: IconHome },
  { id: 'tickets', label: 'Tickets', Icon: IconTicket },
  { id: 'chats', label: 'Chats', Icon: IconChats },
  { id: 'clientes', label: 'Clientes', Icon: IconClients },
  { id: 'avisos', label: 'Avisos', Icon: IconMegaphone },
  { id: 'auditoria', label: 'Auditoria e LGPD', Icon: IconAudit },
  { id: 'configuracoes', label: 'Configurações', Icon: IconSettings },
  { id: 'relatorios', label: 'Relatórios', Icon: IconReports },
  { id: 'calendario', label: 'Calendário', Icon: IconCalendar },
  { id: 'notas', label: 'Notas', Icon: IconNotes },
];

export interface SidebarProps {
  active: NavId;
  onNavigate: (id: NavId) => void;
  items?: NavItem[];
  /** Sigla no bloco de logo. */
  logo?: string;
  /**
   * Abaixo de 768px a sidebar vira gaveta: fica fora da tela até `open`. O
   * AppShell controla isso; em desktop a prop é ignorada pelo CSS.
   */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({
  active,
  onNavigate,
  items = NAV_ITEMS,
  logo = 'cvz',
  open = false,
  onClose,
}: SidebarProps) {
  return (
    <aside className={'sidebar' + (open ? ' sidebar--open' : '')}>
      <div className="sidebar__logo" aria-label="cvzdesk">
        {logo}
      </div>

      <div className="sidebar__divider" role="presentation" />

      <nav className="sidebar__nav" aria-label="Navegação principal">
        {items.map(({ id, label, Icon, count }) => {
          const isActive = id === active;
          return (
            <Tooltip key={id} label={label} side="right">
              <button
                type="button"
                className={
                  'sidebar__item' + (isActive ? ' sidebar__item--active' : '')
                }
                aria-current={isActive ? 'page' : undefined}
                aria-label={label}
                  onClick={() => {
                  onNavigate(id);
                  onClose?.();
                }}
              >
                <Icon className="sidebar__icon" />
                {count ? (
                  <span className="sidebar__count" aria-hidden>
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </button>
            </Tooltip>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
