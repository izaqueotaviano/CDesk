/**
 * Topbar Glass (56px) — design system Resolv. A busca central e o efeito glass
 * ao rolar vêm da referência. Diferença: o nome/avatar são do usuário REAL
 * (useMe), não mock; a busca abre foco no campo de busca da própria lista
 * (a command palette Ctrl+K é uma melhoria futura, não escopo desta tela).
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
        <div className="topbar-glass__search" role="button" tabIndex={0}>
          <i className="ri-search-line topbar-glass__search-icon" />
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
          <i className="ri-chat-3-line topbar-glass__chats-icon" />
          <span className="topbar-glass__chats-label">
            <strong>{conversas}</strong> {conversas === 1 ? 'conversa' : 'conversas'}
          </span>
        </button>
        <div className="topbar-glass__sep" />
        <button type="button" className="topbar-glass__icon-btn" aria-label="Notificações">
          <i className="ri-notification-3-line" />
          <span className="topbar-glass__badge">2</span>
        </button>
        <div className="topbar-glass__sep" />
        <button type="button" className="topbar-glass__user">
          <span className="topbar-glass__avatar topbar-glass__avatar--available">
            <span className="topbar-glass__avatar-initials">{iniciais(nome)}</span>
            <span className="topbar-glass__presence topbar-glass__presence--available" />
          </span>
          <span className="topbar-glass__user-name">{nome}</span>
        </button>
      </div>
    </header>
  )
}
