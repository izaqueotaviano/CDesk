import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { useLogout } from '@/api/mutations/useLogout'
import type { Me } from '@/api/types'
import { useAvisosSonoros } from '@/realtime/useAvisosSonoros'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { usePrefs, type Tema } from '@/stores/prefs'
import { Avatar } from '@/ui/Avatar'
import { cn } from '../lib/cn'
import { Button } from '../ui/button'
import { Toaster } from '../ui/toaster'
import { ITENS_NAV } from './nav'

const PROXIMO_TEMA: Record<Tema, Tema> = { claro: 'escuro', escuro: 'sistema', sistema: 'claro' }
const ROTULO_TEMA: Record<Tema, string> = { claro: 'Tema claro', escuro: 'Tema escuro', sistema: 'Tema do sistema' }
const ICONE_TEMA = { claro: Sun, escuro: Moon, sistema: Monitor }

/** Alterna claro → escuro → sistema. A escolha persiste (stores/prefs). */
export function AlternarTema({ className }: { className?: string }) {
  const tema = usePrefs((s) => s.tema)
  const setTema = usePrefs((s) => s.setTema)
  const Icone = ICONE_TEMA[tema]
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      onClick={() => setTema(PROXIMO_TEMA[tema])}
      aria-label={`${ROTULO_TEMA[tema]} — clique para trocar`}
      title={ROTULO_TEMA[tema]}
    >
      <Icone />
    </Button>
  )
}

function Marca({ me }: { me: Me | undefined }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-acento text-corpo-lg font-forte text-acento-sobre">
        r
      </span>
      <span className="min-w-0">
        <span className="block truncate text-corpo font-forte leading-justa">Central de Suporte</span>
        {me?.company_name && (
          <span className="block truncate text-legenda text-tinta-secundaria">{me.company_name}</span>
        )}
      </span>
    </div>
  )
}

function Sidebar({ me }: { me: Me | undefined }) {
  const logout = useLogout()
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-divisoria bg-superficie md:flex" aria-label="Menu do portal">
      <div className="px-5 pb-4 pt-6">
        <Marca me={me} />
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {ITENS_NAV.map((item) => (
          <NavLink
            key={item.id}
            to={item.rota}
            end={item.exato}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-corpo font-medio text-tinta-secundaria transition-colors hover:bg-navegacao hover:text-tinta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acento/40',
                isActive && 'bg-acento-suave text-acento hover:bg-acento-suave hover:text-acento',
              )
            }
          >
            <item.icone className="size-[18px] shrink-0" aria-hidden="true" />
            {item.rotulo}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-divisoria p-3">
        {me && (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Avatar nome={me.full_name} urlFoto={me.avatar_url} tamanho="md" />
            <span className="min-w-0">
              <span className="block truncate text-pequeno font-medio">{me.full_name}</span>
              <span className="block truncate text-legenda text-tinta-secundaria">{me.email}</span>
            </span>
          </div>
        )}
        <AlternarTema />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-label="Sair"
          title="Sair"
        >
          <LogOut />
        </Button>
      </div>
    </aside>
  )
}

function TopoCelular({ me }: { me: Me | undefined }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-divisoria bg-superficie/90 px-4 backdrop-blur md:hidden">
      <Marca me={me} />
      <div className="flex items-center gap-1">
        <AlternarTema />
        {me && <Avatar nome={me.full_name} urlFoto={me.avatar_url} tamanho="sm" />}
      </div>
    </header>
  )
}

function BarraInferior() {
  const itens = ITENS_NAV.filter((i) => i.noCelular)
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-divisoria bg-superficie/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Navegação principal"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${itens.length}, minmax(0, 1fr))` }}>
        {itens.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.rota}
              end={item.exato}
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-micro font-medio text-tinta-secundaria',
                  isActive && 'text-acento',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className={cn('grid h-7 w-12 place-items-center rounded-total', isActive && 'bg-acento-suave')}>
                    <item.icone className="size-5" aria-hidden="true" />
                  </span>
                  {item.curto ?? item.rotulo}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/**
 * Shell do Painel do Cliente: menu lateral no desktop, barra inferior no
 * celular, tema claro/escuro/sistema e toasts. As páginas cuidam do próprio
 * título; o shell só dá moldura, largura de leitura e navegação.
 */
export function PortalShell() {
  const { data: me } = useMe()
  // canal pessoal (ws/me/) — ticket_event, chat, presença
  useCanalPessoal()
  // resposta do atendimento toca (só) quando o cliente está em outra aba
  useAvisosSonoros()

  return (
    <div className="flex h-full bg-canvas font-ui text-tinta">
      <Sidebar me={me} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopoCelular me={me} />
        <main className="min-h-0 flex-1 overflow-y-auto pb-24 md:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 py-5 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
        <BarraInferior />
      </div>
      <Toaster />
    </div>
  )
}
