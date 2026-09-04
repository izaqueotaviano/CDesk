import { Link, Outlet } from 'react-router-dom'
import { useLogout } from '@/api/mutations/useLogout'
import { useMe } from '@/api/queries/useMe'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { Botao } from '@/ui/Botao'

/**
 * Shell do cliente — SEM abas (F4 em docs/07-arquitetura-frontend.md:
 * "Recomendo portal sem abas (navegação simples)"). Navegação simples de
 * topo em vez de sidebar + TabBar do AppShell.
 */
export function PortalShell() {
  const { data: usuario } = useMe()
  const logout = useLogout()
  useCanalPessoal()

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-divisoria bg-navegacao px-6 py-3">
        <Link to="/portal" className="text-titulo-sm font-forte text-tinta">
          resolv — Suporte
        </Link>
        <nav className="flex items-center gap-4 text-corpo text-tinta-secundaria">
          <Link to="/portal/tickets/novo">Abrir chamado</Link>
          <Link to="/portal/tickets">Meus chamados</Link>
          {usuario ? (
            <Botao variante="fantasma" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Sair
            </Botao>
          ) : null}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto bg-canvas p-6">
        <Outlet />
      </main>
    </div>
  )
}
