import { useState, type ReactNode } from 'react'
import { useAvisos } from '@/realtime/useAvisos'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { usePrefs } from '@/stores/prefs'
import { MiniChat } from '../chat/MiniChat'
import '../styles/tokens.scss'
import './shell.scss'
import { BarraDeAbas } from './BarraDeAbas'
import { BuscaComando } from './BuscaComando'
import { Sidebar } from './Sidebar'

/**
 * Shell do design system Resolv: sidebar rail 56px + corpo com barra de abas
 * sticky. A classe `resolv-scope` liga os tokens SCSS (tokens.scss) só aqui
 * dentro — o login e o resto do app (visual Tailwind) ficam de fora.
 *
 * Fase 2 da unificação de shell: a Topbar saiu — a busca, notificações, tema
 * e presença/conta/sair migraram pra zona utilitária da Sidebar, e o espaço
 * que a Topbar ocupava é agora a `BarraDeAbas` (tickets + seções abertas,
 * como abas de navegador). `buscaAberta` mora aqui, não dentro de
 * `BuscaComando`, porque dois lugares abrem o mesmo painel — o ícone da
 * Sidebar e o atalho Ctrl/⌘K global — e um `useState` local não dava pra
 * Sidebar acionar de fora.
 */
export function NovoShell({ children }: { children: ReactNode }) {
  // canal pessoal (ws/me/) — recebe os ticket_event do backend para o realtime.
  // Singleton na bridge: se o AppShell já abriu, reaproveita a mesma conexão.
  useCanalPessoal()
  // som, marca no título e notificação do sistema — só com a aba em segundo
  // plano (quem está olhando já viu chegar)
  useAvisos()

  const [buscaAberta, setBuscaAberta] = useState(false)
  // A raiz precisa saber do estado da barra porque é ela que declara
  // `--largura-sidebar` — o recuo do conteúdo sai da MESMA variável que a
  // largura da barra (shell.scss).
  const sidebarRecolhida = usePrefs((s) => s.sidebarRecolhida)

  return (
    <div
      className={'resolv-scope novo-shell' + (sidebarRecolhida ? ' novo-shell--recolhida' : '')}
    >
      <Sidebar onAbrirBusca={() => setBuscaAberta(true)} />
      <div className="novo-shell__corpo" id="resolv-corpo">
        <BarraDeAbas />
        <main className="novo-shell__conteudo">{children}</main>
      </div>
      {/* fora do <main>: trocar de tela não desmonta a conversa aberta (docs/07 §3.3) */}
      <MiniChat />
      <BuscaComando
        aberto={buscaAberta}
        onAbrir={() => setBuscaAberta(true)}
        onFechar={() => setBuscaAberta(false)}
      />
    </div>
  )
}
