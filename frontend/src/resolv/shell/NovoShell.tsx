import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAvisos } from '@/realtime/useAvisos'
import { useCanalPessoal } from '@/realtime/useCanalPessoal'
import { ToastProvider } from '@/cvz/components'
import { usePrefs } from '@/stores/prefs'
import { AtalhosGlobais } from '../atalhos/AtalhosGlobais'
import { MiniChat } from '../chat/MiniChat'
import '../styles/tokens.scss'
import '../styles/identidade.scss'
import './shell.scss'
import '../styles/controles.scss'
import '../styles/acabamento.scss'
import '../styles/tabelas.scss'
import { BarraDeAbas } from './BarraDeAbas'
import { BotaoTema } from './BotaoTema'
import { BuscaComando } from './BuscaComando'
import { PainelNotificacoes } from './PainelNotificacoes'
import { Sidebar } from './Sidebar'
import { CONSULTA_TELA_PEQUENA, useConsultaDeMidia } from './useConsultaDeMidia'

/**
 * Shell do console: sidebar fixa (expandida/recolhida, ou gaveta em tela
 * pequena) + corpo com uma barra superior e o painel de conteúdo, tudo no
 * mesmo plano, dividido por um fio de 1px (shell.scss). A classe
 * `resolv-scope` liga os tokens SCSS (tokens.scss) só aqui dentro: o login e
 * o resto do app (visual Tailwind) ficam de fora.
 *
 * A navegação mora na SIDEBAR; o que está aberto mora na BARRA SUPERIOR, como
 * num navegador: cada ticket e cada página aberta é uma aba (BarraDeAbas.tsx),
 * à esquerda, e o canto direito fica com os dois ícones fixos (notificações e
 * tema). Em tela pequena o botão de menu abre a sidebar como gaveta, antes das
 * abas. `buscaAberta` e `gavetaAberta` moram aqui, não dentro dos componentes,
 * porque dois lugares abrem cada um: o item "Buscar" da sidebar e o atalho
 * Ctrl/⌘K global abrem a busca; o botão de menu da barra superior abre a
 * gaveta, que a própria sidebar fecha.
 */
export function NovoShell({ children }: { children: ReactNode }) {
  // Toast do console inteiro — é o que dá "Desfazer" às ações do detalhe do
  // ticket. As telas cvz (SuperficieCvz) seguem com o provider delas por
  // dentro: `useToast()` pega o mais próximo, e os dois convivem.
  return (
    <ToastProvider>
      <CascaDoShell>{children}</CascaDoShell>
    </ToastProvider>
  )
}

function CascaDoShell({ children }: { children: ReactNode }) {
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

  return (
    <div className={'resolv-scope novo-shell' + (sidebarRecolhida ? ' novo-shell--recolhida' : '')}>
      <Sidebar
        onAbrirBusca={() => setBuscaAberta(true)}
        gaveta={
          telaPequena ? { aberta: gavetaAberta, onFechar: () => setGavetaAberta(false) } : undefined
        }
      />
      <div className="novo-shell__corpo">
        <header className="novo-shell__topo">
          {/* Só em tela pequena: lá a sidebar é gaveta e precisa de porta. */}
          {telaPequena && (
            <button
              type="button"
              className="novo-shell__icone"
              aria-label="Abrir menu de navegação"
              title="Menu"
              onClick={() => setGavetaAberta(true)}
            >
              <i className="ti ti-menu-2" aria-hidden="true" />
            </button>
          )}
          <BarraDeAbas />
          <div className="novo-shell__topo-lado">
            <PainelNotificacoes />
            <BotaoTema />
          </div>
        </header>
        <main className="novo-shell__painel" id="resolv-corpo">
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
      {/* `?` abre o painel de atalhos; `/` abre a mesma busca do Ctrl/⌘K */}
      <AtalhosGlobais onAbrirBusca={() => setBuscaAberta(true)} />
    </div>
  )
}
