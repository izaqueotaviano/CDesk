/**
 * Topbar Glass — agora é quase só COMPOSIÇÃO. Busca, presença, notificações e
 * tema são peças com arquivo próprio; o que ainda nasce aqui é o contador de
 * conversas, o Sair e o efeito glass ao rolar.
 *
 * As duas trocas desta rodada: a caixa "Buscar… ⌘K" era decorativa (não abria
 * nada, e o ⌘ estava errado para quem não usa Mac) e virou <BuscaGlobal />; o
 * avatar cravava `--available` para todo mundo — a própria pessoa aparecia
 * sempre verde enquanto "Equipe agora" mostrava a presença real dos colegas —
 * e virou <MenuPresenca />, que mostra e troca a presença de verdade.
 *
 * Abaixo de 768px a barra passa a ter DUAS linhas (controles em cima, busca
 * ocupando a linha inteira embaixo). O porquê está em topbar.scss, junto das
 * media queries.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogout } from '@/api/mutations/useLogout'
import { useFilaChat, useMeusChats } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import { BotaoTema } from './BotaoTema'
import { BuscaGlobal } from './BuscaGlobal'
import { MenuPresenca } from './MenuPresenca'
import { PainelNotificacoes } from './PainelNotificacoes'
import './topbar.scss'

export function Topbar() {
  const navigate = useNavigate()
  const { data: usuario } = useMe()
  const logout = useLogout()
  // o contador é real: fila + meus atendimentos, atualizado pelo socket
  // (a bridge invalida as duas chaves a cada chat_queued/chat_taken)
  const { data: fila } = useFilaChat(usuario?.is_internal === true)
  const { data: meus } = useMeusChats(usuario?.is_internal === true)
  const naFila = fila?.length ?? 0
  const emAtendimento = meus?.length ?? 0
  const conversas = naFila + emAtendimento
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const corpo = document.getElementById('resolv-corpo')
    if (!corpo) return
    const onScroll = () => setScrolled(corpo.scrollTop > 4)
    corpo.addEventListener('scroll', onScroll)
    return () => corpo.removeEventListener('scroll', onScroll)
  }, [])

  // Abaixo de 768px a palavra "conversas" some do rótulo visível e sobra só o
  // número, então o nome acessível não pode ser derivado dele — fica explícito
  // aqui, igual em qualquer largura. Começa pelo texto que aparece na tela de
  // propósito (WCAG 2.5.3): quem comanda por voz diz o que lê.
  const rotuloConversas = `${conversas} ${conversas === 1 ? 'conversa' : 'conversas'}: ${naFila} na fila, ${emAtendimento} em atendimento`

  return (
    <header className={'topbar-glass' + (scrolled ? ' topbar-glass--scrolled' : '')}>
      {/* Espaçador: só existe para a busca cair no centro da tela com o mesmo
          vão dos dois lados. Some quando a busca passa a ocupar a sobra. */}
      <div className="topbar-glass__left" />

      <div className="topbar-glass__center">
        <BuscaGlobal />
      </div>

      <div className="topbar-glass__right">
        <button
          type="button"
          className="topbar-glass__chats"
          onClick={() => navigate('/chat')}
          aria-label={rotuloConversas}
          title={rotuloConversas}
        >
          <i className="ti ti-message-circle-2" aria-hidden="true" />
          <span className="topbar-glass__chats-label">
            <strong>{conversas}</strong>
            <span className="topbar-glass__chats-palavra">{conversas === 1 ? 'conversa' : 'conversas'}</span>
          </span>
        </button>

        <div className="topbar-glass__sep" />
        <PainelNotificacoes />
        <div className="topbar-glass__sep" />

        {/* O separador marca a divisa entre dois blocos: o que é TRABALHO
            chegando (conversas, notificações) e o que é MEU (como a tela se
            parece, qual é o meu status, encerrar minha sessão). O tema abre o
            segundo bloco porque é preferência de exibição de quem está logado,
            não um alerta — e fica entre o sino e o Sair, como pedido. */}
        <BotaoTema />
        <MenuPresenca />
        <button
          type="button"
          className="topbar-glass__icon-btn"
          aria-label="Sair"
          title="Sair"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <i className="ti ti-logout-2" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
