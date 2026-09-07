import { useState, type ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { useLogout } from '@/api/mutations/useLogout'
import { MiniChat } from '@/resolv/chat/MiniChat'
// Tudo do barrel (DESIGN.md: "Importe sempre de src/components, nunca do
// caminho profundo") — inclusive ToastProvider/useToast e initialsFrom, que
// antes vinham de caminhos internos dos componentes.
import { AppShell, Popover, ToastProvider, initialsFrom, useToast, type NavId } from './components'
// O reset/tokens (`--cvz-*`) agora carrega em App.tsx, na raiz — não só
// aqui. Ver o comentário lá: componentes cvz já são usados por rotas que
// não passam por este layout (Topbar, detalhe de ticket), então a folha não
// podia mais depender só deste import para existir.

/**
 * Ponte entre o AppShell real (cvzdesk) e os dados/rotas do Resolv. Hoje só
 * `inicio`, `tickets`, `chats`, `clientes`, `avisos`, `auditoria`,
 * `configuracoes` e `relatorios` têm tela — os demais itens da sidebar
 * disparam um toast "em construção" em vez de navegar para lugar nenhum
 * (nunca um link morto silencioso).
 *
 * `chats` aponta para a MESMA tela cheia de /chat do shell Resolv
 * (resolv/chat/PaginaChat) — não existe uma versão cvz separada, é só mais
 * uma porta de entrada pra ela.
 *
 * `conversations`/`notifications` ficam em 0 de propósito: inventar um número
 * ali seria o mesmo erro que a barra "3 conversas" fixa da base anterior — a
 * contagem real de chat/notificações não lidas ainda não foi ligada.
 */
const ROTA_POR_NAV: Partial<Record<NavId, string>> = {
  inicio: '/inicio',
  tickets: '/chamados',
  chats: '/chat',
  clientes: '/clientes',
  avisos: '/avisos',
  auditoria: '/auditoria',
  configuracoes: '/configuracoes',
  relatorios: '/relatorios',
}

function navIdAtivo(pathname: string): NavId {
  if (pathname.startsWith('/clientes')) return 'clientes'
  if (pathname.startsWith('/avisos')) return 'avisos'
  if (pathname.startsWith('/auditoria')) return 'auditoria'
  if (pathname.startsWith('/configuracoes')) return 'configuracoes'
  if (pathname.startsWith('/relatorios')) return 'relatorios'
  if (pathname.startsWith('/chamados')) return 'tickets'
  if (pathname.startsWith('/chat')) return 'chats'
  return 'inicio'
}

export function CvzAppLayout({
  children,
  variant = 'dashboard',
}: {
  children: ReactNode
  variant?: 'dashboard' | 'flush'
}) {
  // `useToast` (usado logo abaixo e por qualquer tela filha) precisa de um
  // <ToastProvider> acima na árvore — cada rota que monta o CvzAppLayout
  // ganha o seu, mesmo padrão de wrapping por rota já usado pelo NovoShell.
  return (
    <ToastProvider>
      <CvzAppShellBridge variant={variant}>{children}</CvzAppShellBridge>
    </ToastProvider>
  )
}

function CvzAppShellBridge({
  children,
  variant,
}: {
  children: ReactNode
  variant: 'dashboard' | 'flush'
}) {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const { push } = useToast()
  const logout = useLogout()
  const [menuPerfilAberto, setMenuPerfilAberto] = useState(false)

  const handleNavigate = (id: NavId) => {
    const rota = ROTA_POR_NAV[id]
    if (rota) navigate(rota)
    else push({ tone: 'info', title: 'Em construção', description: 'Esta área ainda não existe.' })
  }

  return (
    <>
      <AppShell
        variant={variant}
        active={navIdAtivo(location.pathname)}
        onNavigate={handleNavigate}
        user={{
          name: me?.full_name ?? '—',
          initials: me ? initialsFrom(me.full_name) : '—',
          presence: me?.presence ?? 'offline',
        }}
        conversations={0}
        notifications={0}
        onOpenProfile={() => setMenuPerfilAberto(true)}
        onRunCommand={(cmd) => {
          if (cmd.id === 'nav-inicio') navigate('/inicio')
          else if (cmd.id === 'nav-tickets') navigate('/chamados')
          else if (cmd.id === 'nav-chats') navigate('/chat')
          else if (cmd.id === 'nav-clientes') navigate('/clientes')
          else if (cmd.id === 'nav-avisos') navigate('/avisos')
          else if (cmd.id === 'nav-auditoria') navigate('/auditoria')
          else if (cmd.id === 'nav-configuracoes') navigate('/configuracoes')
          else if (cmd.id === 'nav-relatorios') navigate('/relatorios')
          else if (cmd.id !== 'advanced')
            push({ tone: 'info', title: 'Em construção', description: 'Esta área ainda não existe.' })
        }}
      >
        {children}
      </AppShell>

      {/* Âncora fora da árvore do AppShell — o shell genérico só sabe abrir o
          menu (onOpenProfile), quem sabe o que fazer com ele é a ponte com a
          API. Posição fixa no canto onde o avatar da Topbar sempre cai (topo
          = altura da barra, direita = mesmo respiro dela): mais simples que
          medir o botão real por ref, e o Popover só cuida do painel — o
          "gatilho" dele fica mudo (`null`) porque quem abre é o botão de
          verdade lá dentro do Topbar. */}
      <div className="app-shell__profile-anchor">
        <Popover
          align="end"
          open={menuPerfilAberto}
          onOpenChange={setMenuPerfilAberto}
          trigger={() => null}
        >
          {(fechar) => (
            <div className="app-shell__profile-menu" role="menu" aria-label="Menu da conta">
              <div className="app-shell__profile-menu-header">
                <strong>{me?.full_name ?? '—'}</strong>
                {me?.email && <span>{me.email}</span>}
              </div>
              <button
                type="button"
                role="menuitem"
                className="app-shell__profile-menu-item"
                disabled={logout.isPending}
                onClick={() => {
                  fechar()
                  logout.mutate()
                }}
              >
                Sair
              </button>
            </div>
          )}
        </Popover>
      </div>

      {/* irmão do shell, não filho do <main>: o mesmo mini chat do shell
          Resolv — a pessoa continua respondendo um atendimento enquanto
          olha um cliente ou um relatório aqui */}
      <MiniChat />
    </>
  )
}
