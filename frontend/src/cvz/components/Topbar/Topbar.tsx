import { IconSearch, IconBell, IconChats, IconMenu, IconSun, IconMoon } from '../icons';
import { Avatar, type Presence } from '../Avatar/Avatar';
import './Topbar.scss';

export type { Presence };

export interface TopbarUser {
  name: string;
  initials: string;
  presence: Presence;
}

export interface TopbarProps {
  user: TopbarUser;
  conversations?: number;
  notifications?: number;
  /** Ativa o vidro fosco — o AppShell liga isso quando o conteúdo rola. */
  scrolled?: boolean;
  onOpenSearch: () => void;
  /** Abre a gaveta de navegação. Só aparece abaixo de 768px. */
  onOpenNav?: () => void;
  /** Tema atual e alternância. Omita para esconder o botão. */
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  onOpenConversations?: () => void;
  onOpenNotifications?: () => void;
  onOpenProfile?: () => void;
}

export function Topbar({
  user,
  conversations = 0,
  notifications = 0,
  scrolled = false,
  onOpenSearch,
  onOpenNav,
  theme,
  onToggleTheme,
  onOpenConversations,
  onOpenNotifications,
  onOpenProfile,
}: TopbarProps) {
  return (
    <header className={'topbar' + (scrolled ? ' topbar--scrolled' : '')}>
      <div className="topbar__left">
        {onOpenNav && (
          <button
            type="button"
            className="topbar__nav-toggle"
            aria-label="Abrir navegação"
            onClick={onOpenNav}
          >
            <IconMenu className="topbar__icon" />
          </button>
        )}
      </div>

      <div className="topbar__center">
        <button type="button" className="topbar__search" onClick={onOpenSearch}>
          <IconSearch className="topbar__search-icon" />
          <span className="topbar__search-label">Buscar…</span>
          <kbd className="topbar__kbd">Ctrl+K</kbd>
        </button>
      </div>

      <div className="topbar__right">
        <button
          type="button"
          className="topbar__conversations"
          onClick={onOpenConversations}
        >
          <IconChats className="topbar__icon" />
          <span className="topbar__conversations-label">Conversas</span>
          <span className="topbar__conversations-count">{conversations}</span>
        </button>

        <span className="topbar__separator" role="presentation" />

        <button
          type="button"
          className="topbar__action"
          aria-label={
            notifications
              ? `Notificações, ${notifications} não lidas`
              : 'Notificações'
          }
          onClick={onOpenNotifications}
        >
          <IconBell className="topbar__icon" />
          {notifications > 0 && (
            <span className="topbar__badge" aria-hidden>
              {notifications > 9 ? '9+' : notifications}
            </span>
          )}
        </button>

        {onToggleTheme && (
          <button
            type="button"
            className="topbar__action"
            aria-label={theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? (
              <IconSun className="topbar__icon" />
            ) : (
              <IconMoon className="topbar__icon" />
            )}
          </button>
        )}

        <span className="topbar__separator" role="presentation" />

        <button type="button" className="topbar__user" onClick={onOpenProfile}>
          <Avatar
            name={user.name}
            initials={user.initials}
            presence={user.presence}
            ringOn="chrome"
          />
          <span className="topbar__name">{user.name}</span>
        </button>
      </div>
    </header>
  );
}

export default Topbar;
