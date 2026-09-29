import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAvisos } from '@/realtime/useAvisos'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { usePrefs } from '@/stores/prefs'
import { SpriteMarca } from '@/ui/marca/IconeMarca'
import { MiniChat } from '../chat/MiniChat'
import '../styles/tokens.scss'
import '../styles/identidade.scss'
import './shell.scss'
import { BarraDeAbas } from './BarraDeAbas'
import { BuscaComando } from './BuscaComando'
import { Sidebar } from './Sidebar'
import { CONSULTA_TELA_PEQUENA, useConsultaDeMidia } from './useConsultaDeMidia'

/**
 * Shell do design system Resolv: sidebar fixa (expandida/recolhida, ou
 * gaveta em tela pequena) + corpo com barra de abas de navegador e o painel
 * de conteúdo arredondado (shell.scss). A classe `resolv-scope` liga os
 * tokens SCSS (tokens.scss) só aqui dentro — o login e o resto do app (visual
 * Tailwind) ficam de fora.
 *
 * Fase 2 da unificação de shell: a Topbar saiu — a busca, notificações, tema
 * e presença/conta/sair migraram pra zona utilitária da Sidebar, e o espaço
 * que a Topbar ocupava é agora a `BarraDeAbas` (tickets + seções abertas,
 * como abas de navegador). `buscaAberta` e `gavetaAberta` moram aqui, não
 * dentro dos componentes, porque dois lugares abrem cada um — o ícone da
 * Sidebar e o atalho Ctrl/⌘K global abrem a busca; o botão de menu da barra
 * de abas abre a gaveta, que a própria Sidebar fecha.
 */
export function NovoShell({ children }: { children: ReactNode }) {
  // canal pessoal (ws/me/) — recebe os ticket_event do backend para o realtime.
  // Singleton na bridge: se o AppShell já abriu, reaproveita a mesma conexão.
  useCanalPessoal()
  // som, marca no título e notificação do sistema — só com a aba em segundo
  // plano (quem está olhando já viu chegar)
  useAvisos()

  const [buscaAberta, setBuscaAberta] = useState(false)
  const [gavetaPedida, setGavetaAberta] = useState(false)
  // A raiz precisa saber do estado da barra porque é ela que declara
  // `--largura-sidebar` — o recuo do conteúdo sai da MESMA variável que a
  // largura da barra (shell.scss).
  const sidebarRecolhida = usePrefs((s) => s.sidebarRecolhida)
  const telaPequena = useConsultaDeMidia(CONSULTA_TELA_PEQUENA)

  const { pathname } = useLocation()
  // Navegar fecha a gaveta (tocar num item da navegação é o caso comum).
  // Ajuste de estado durante o render, o padrão do React pra "reagir a uma
  // prop mudar" — um efeito faria a gaveta piscar aberta por um frame.
  const [rotaVista, setRotaVista] = useState(pathname)
  if (rotaVista !== pathname) {
    setRotaVista(pathname)
    setGavetaAberta(false)
  }
  // Sair da tela pequena também fecha — a gaveta não existe lá.
  const gavetaAberta = gavetaPedida && telaPequena

  // A aba Início é sempre a primeira: com ela ativa o canto esquerdo do
  // painel fica reto (é a aba que se funde ali); com qualquer outra, curvo.
  const inicioAtiva = pathname === '/inicio'

  return (
    <div
      className={'resolv-scope novo-shell' + (sidebarRecolhida ? ' novo-shell--recolhida' : '')}
    >
      {/* Os <symbol> precisam estar no documento antes de qualquer <use>;
          por isso o sprite entra aqui, uma vez, e não dentro do ícone. */}
      <SpriteMarca />
      <Sidebar
        onAbrirBusca={() => setBuscaAberta(true)}
        gaveta={telaPequena ? { aberta: gavetaAberta, onFechar: () => setGavetaAberta(false) } : undefined}
      />
      <div className="novo-shell__corpo">
        <BarraDeAbas onAbrirNavegacao={telaPequena ? () => setGavetaAberta(true) : undefined} />
        <main
          className={'novo-shell__painel' + (inicioAtiva ? '' : ' novo-shell__painel--canto-esquerdo')}
          id="resolv-corpo"
        >
          {children}
        </main>
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
