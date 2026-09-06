import type { ReactNode } from 'react'
import { useAvisosSonoros } from '@/realtime/useAvisosSonoros'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { MiniChat } from '../chat/MiniChat'
import '../styles/tokens.scss'
import './shell.scss'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

/**
 * Shell do design system Resolv: sidebar rail 56px + corpo com topbar sticky.
 * A classe `resolv-scope` liga os tokens SCSS (tokens.scss) só aqui dentro —
 * o login e o resto do app (visual Tailwind) ficam de fora.
 */
export function NovoShell({ children }: { children: ReactNode }) {
  // canal pessoal (ws/me/) — recebe os ticket_event do backend para o realtime.
  // Singleton na bridge: se o AppShell já abriu, reaproveita a mesma conexão.
  useCanalPessoal()
  // chat novo na fila toca (só) quando a aba está em segundo plano
  useAvisosSonoros()

  return (
    <div className="resolv-scope novo-shell">
      <Sidebar />
      <div className="novo-shell__corpo" id="resolv-corpo">
        <Topbar />
        <main className="novo-shell__conteudo">{children}</main>
      </div>
      {/* fora do <main>: trocar de tela não desmonta a conversa aberta (docs/07 §3.3) */}
      <MiniChat />
    </div>
  )
}
