/**
 * Topbar Glass (56px) — design system Resolv. A busca central e o efeito glass
 * ao rolar vêm da referência. Diferença: o nome/avatar são do usuário REAL
 * (useMe), não mock; a busca abre foco no campo de busca da própria lista
 * (a command palette Ctrl+K é uma melhoria futura, não escopo desta tela).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLogout } from '@/api/mutations/useLogout'
import { useFilaChat, useMeusChats } from '@/api/chat'
import { useMe } from '@/api/queries/useMe'
import './topbar.scss'

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/)
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? (p.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function Topbar() {
  const navigate = useNavigate()
  const { data: usuario } = useMe()
  const logout = useLogout()
  // o contador é real: fila + meus atendimentos, atualizado pelo socket
  // (a bridge invalida as duas chaves a cada chat_queued/chat_taken)
  const { data: fila } = useFilaChat(usuario?.is_internal === true)
  const { data: meus } = useMeusChats(usuario?.is_internal === true)
  const conversas = (fila?.length ?? 0) + (meus?.length ?? 0)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const corpo = document.getElementById('resolv-corpo')
    if (!corpo) return
    const onScroll = () => setScrolled(corpo.scrollTop > 4)
    corpo.addEventListener('scroll', onScroll)
    return () => corpo.removeEventListener('scroll', onScroll)
  }, [])

  const nome = usuario?.full_name ?? '—'

  return (
    <header className={'topbar-glass' + (scrolled ? ' topbar-glass--scrolled' : '')}>
      <div className="topbar-glass__left" />

      <div className="topbar-glass__center">
        {/* Decorativa até o Ctrl+K existir de verdade — sem role/tabIndex:
            um "botão" que não reage a Enter/clique era pior que nenhum. */}
        <div className="topbar-glass__search">
          <i className="ti ti-search topbar-glass__search-icon" />
          <span className="topbar-glass__search-placeholder">Buscar…</span>
          <span className="topbar-glass__search-kbd">⌘K</span>
        </div>
      </div>

      <div className="topbar-glass__right">
        <button
          type="button"
          className="topbar-glass__chats"
          onClick={() => navigate('/chat')}
          title={`${fila?.length ?? 0} na fila · ${meus?.length ?? 0} em atendimento`}
        >
          <i className="ti ti-message-circle-2 topbar-glass__chats-icon" />
          <span className="topbar-glass__chats-label">
            <strong>{conversas}</strong> {conversas === 1 ? 'conversa' : 'conversas'}
          </span>
        </button>
        <div className="topbar-glass__sep" />
        {/* Sem badge de contagem: "2" era um número inventado, não a
            quantidade real de notificações (não existe painel ainda — ver
            item pendente de produto). Mentir um número é pior que não
            mostrar nenhum. */}
        <button type="button" className="topbar-glass__icon-btn" aria-label="Notificações">
          <i className="ti ti-bell" />
        </button>
        <div className="topbar-glass__sep" />
        <button type="button" className="topbar-glass__user" onClick={() => navigate('/conta')} title="Minha conta">
          <span className="topbar-glass__avatar topbar-glass__avatar--available">
            <span className="topbar-glass__avatar-initials">{iniciais(nome)}</span>
            <span className="topbar-glass__presence topbar-glass__presence--available" />
          </span>
          <span className="topbar-glass__user-name">{nome}</span>
        </button>
        <button
          type="button"
          className="topbar-glass__icon-btn"
          aria-label="Sair"
          title="Sair"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          <i className="ti ti-logout-2" />
        </button>
      </div>
    </header>
  )
}
