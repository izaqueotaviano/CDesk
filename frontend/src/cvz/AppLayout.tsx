import type { ReactNode } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useMe } from '@/api/queries/useMe'
import { MiniChat } from '@/resolv/chat/MiniChat'
// Tudo do barrel (DESIGN.md: "Importe sempre de src/components, nunca do
// caminho profundo") — inclusive ToastProvider/useToast e initialsFrom, que
// antes vinham de caminhos internos dos componentes.
import { AppShell, ToastProvider, initialsFrom, useToast, type NavId } from './components'
import './styles/global.scss'

/**
 * Ponte entre o AppShell real (cvzdesk) e os dados/rotas do Resolv. Hoje só
 * `inicio`, `tickets`, `clientes`, `avisos`, `auditoria`, `configuracoes` e
 * `relatorios` têm tela — os demais itens da sidebar disparam um toast "em
 * construção" em vez de navegar para lugar nenhum (nunca um link morto
 * silencioso).
 *
 * `conversations`/`notifications` ficam em 0 de propósito: inventar um número
 * ali seria o mesmo erro que a barra "3 conversas" fixa da base anterior — a
 * contagem real de chat/notificações não lidas ainda não foi ligada.
 */
const ROTA_POR_NAV: Partial<Record<NavId, string>> = {
  inicio: '/inicio',
  tickets: '/chamados',
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
        onRunCommand={(cmd) => {
          if (cmd.id === 'nav-inicio') navigate('/inicio')
          else if (cmd.id === 'nav-tickets') navigate('/chamados')
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
      {/* irmão do shell, não filho do <main>: o mesmo mini chat do shell
          Resolv — a pessoa continua respondendo um atendimento enquanto
          olha um cliente ou um relatório aqui */}
      <MiniChat />
    </>
  )
}

// NOTA: o AppShell não expõe `onOpenProfile` (só chega até o Topbar sem
// prop pra fora) — clicar no avatar/nome não faz nada ainda. Sair continua
// só na sidebar da base antiga (/app) até o cvzdesk ganhar o Menu/Popover
// que faltam nesta base para um menu de conta de verdade.
