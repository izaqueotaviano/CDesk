import { Outlet, Link } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { useLogout } from '@/api/mutations/useLogout'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { Avatar } from '@/ui/Avatar'
import { Botao } from '@/ui/Botao'
import { TabBar } from './TabBar'

const ITENS_NAV = [
  { rotulo: 'Início', para: '/app' },
  { rotulo: 'Tickets', para: '/app/tickets' },
  { rotulo: 'Chat', para: '/app/chat' },
  { rotulo: 'Kanban', para: '/app/kanban' },
  { rotulo: 'Relatórios', para: '/app/relatorios' },
]

/**
 * Shell interno (agente/supervisor/admin) — docs/01-arquitetura.md §6:
 * "O layout precisa de um shell persistente (AppShell → TabBar +
 * TabContentHost)". `<Outlet/>` do React Router faz de TabContentHost: as
 * demais abas ficam com estado preservado no store (useTabs), não
 * desmontadas — é o store, não o router, que guarda scroll/rascunho.
 *
 * O widget global de chat (docs/01: "vive fora do host de conteúdo... mantém
 * um único WebSocket aberto durante toda a sessão") mora um nível acima
 * deste componente (ver src/main.tsx), não aqui dentro — senão trocar de
 * rota o desmontaria junto com o conteúdo.
 */
export function AppShell() {
  const { data: usuario } = useMe()
  const logout = useLogout()
  useCanalPessoal()

  return (
    <div className="flex h-full">
      <aside
        className="flex w-sidebar-larga shrink-0 flex-col justify-between border-r
          border-divisoria bg-navegacao p-4"
      >
        <nav className="flex flex-col gap-1">
          <span className="mb-4 px-2 text-titulo-sm font-forte text-tinta">E-Desk</span>
          {ITENS_NAV.map((item) => (
            <Link
              key={item.para}
              to={item.para}
              className="rounded-md px-3 py-2 text-corpo text-tinta-secundaria transition-colors
                duration-padrao hover:bg-hover hover:text-tinta"
            >
              {item.rotulo}
            </Link>
          ))}
        </nav>

        {usuario ? (
          <div className="flex items-center gap-2 border-t border-divisoria pt-3">
            <Avatar nome={usuario.full_name} urlFoto={usuario.avatar_url || null} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-pequeno font-medio text-tinta">{usuario.full_name}</p>
              <p className="truncate text-micro text-tinta-terciaria">{usuario.company_name}</p>
            </div>
            <Botao
              variante="fantasma"
              className="px-2"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
            >
              Sair
            </Botao>
          </div>
        ) : null}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <TabBar />
        <main className="min-h-0 flex-1 overflow-auto bg-canvas p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
