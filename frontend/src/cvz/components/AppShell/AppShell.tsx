import { useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { Sidebar, type NavId, type NavItem } from '../Sidebar/Sidebar';
import { Topbar, type TopbarUser } from '../Topbar/Topbar';
import {
  CommandPalette,
  useCommandPalette,
  type Command,
} from '../CommandPalette/CommandPalette';
import { useIsMobile, useTheme } from '../../hooks';
import './AppShell.scss';

/**
 * `dashboard` — surface com padding e rolagem própria.
 * `flush`     — surface sem padding, flex, para telas de coluna cheia.
 */
export type SurfaceVariant = 'dashboard' | 'flush';

export interface AppShellProps {
  user: TopbarUser;
  active: NavId;
  onNavigate: (id: NavId) => void;
  children: ReactNode;
  variant?: SurfaceVariant;
  navItems?: NavItem[];
  conversations?: number;
  notifications?: number;
  commands?: Command[];
  onRunCommand?: (command: Command) => void;
}

export function AppShell({
  user,
  active,
  onNavigate,
  children,
  variant = 'dashboard',
  navItems,
  conversations = 0,
  notifications = 0,
  commands,
  onRunCommand,
}: AppShellProps) {
  const { open, openPalette, closePalette } = useCommandPalette();
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();

  const [navOpen, setNavOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const rafRef = useRef<number | null>(null);

  // Trocar de tela fecha a gaveta; sair do mobile também, para o desktop nunca
  // herdar um estado que só existe abaixo de 768px. Padrão do componente
  // cvzdesk original, preservado verbatim — a auditoria confirmou que
  // reescrever isso como ajuste de estado durante o render mudava o timing
  // real de fechamento da gaveta ao cruzar o breakpoint.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ver acima
    if (!isMobile) setNavOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!navOpen) return;
    document.body.classList.add('is-locked');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('is-locked');
      document.removeEventListener('keydown', onKey);
    };
  }, [navOpen]);

  // O scroll acontece na surface, não na janela. A leitura vai em rAF para não
  // custar layout a cada evento.
  const handleScroll = (e: UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop;
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setScrolled(top > 2);
    });
  };

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={onNavigate}
        items={navItems}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      {navOpen && (
        <button
          type="button"
          className="app-shell__scrim"
          aria-label="Fechar navegação"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="app-shell__body">
        <Topbar
          user={user}
          conversations={conversations}
          notifications={notifications}
          scrolled={scrolled}
          theme={theme}
          onToggleTheme={toggle}
          onOpenSearch={openPalette}
          onOpenNav={isMobile ? () => setNavOpen(true) : undefined}
        />

        <main
          className={`surface surface--${variant}`}
          onScroll={variant === 'dashboard' ? handleScroll : undefined}
        >
          {children}
        </main>
      </div>

      <CommandPalette
        open={open}
        onClose={closePalette}
        commands={commands}
        onRun={onRunCommand}
      />
    </div>
  );
}

export default AppShell;
