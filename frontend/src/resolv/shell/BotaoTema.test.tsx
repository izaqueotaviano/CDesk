import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { BotaoTema } from './BotaoTema'

/**
 * jsdom não implementa matchMedia — cada teste diz explicitamente o que o
 * sistema operacional prefere (ou não stuba nada, e o hook tem que aguentar).
 */
function sistemaPrefere(escuro: boolean) {
  const ouvintes = new Set<(e: MediaQueryListEvent) => void>()
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: escuro,
    media: consulta,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.add(fn),
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => ouvintes.delete(fn),
  }))
  return {
    quantidadeDeOuvintes: () => ouvintes.size,
    // act(): a troca de tema do SO vem de fora do React, como no navegador
    mudarPara: (agoraEscuro: boolean) =>
      act(() => ouvintes.forEach((fn) => fn({ matches: agoraEscuro } as MediaQueryListEvent))),
  }
}

/** O que o CSS lê: `data-tema` serve tokens.scss (Resolv) e tokens.css
 *  (portal); `data-theme` serve o _theme.scss do cvz. */
const atributoResolv = () => document.documentElement.getAttribute('data-tema')
const atributoCvz = () => document.documentElement.getAttribute('data-theme')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-tema')
  document.documentElement.removeAttribute('data-theme')
})
afterEach(() => {
  vi.unstubAllGlobals()
  // A preferência é um singleton de módulo: sem devolver ao padrão, o tema
  // escolhido num teste vaza para o seguinte (e para os outros arquivos).
  usePrefs.setState({ tema: 'sistema' })
})

describe('Botão de tema (shell Resolv)', () => {
  it('oferece o tema escuro quando a tela está clara', () => {
    sistemaPrefere(false)
    render(<BotaoTema />)

    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
  })

  it('alterna para o escuro, guarda a escolha e passa a oferecer a volta', () => {
    sistemaPrefere(false)
    render(<BotaoTema />)

    fireEvent.click(screen.getByRole('button', { name: 'Usar tema escuro' }))

    expect(atributoResolv()).toBe('escuro')
    expect(usePrefs.getState().tema).toBe('escuro')
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toBeInTheDocument()
  })

  it('leva o shell cvz junto: as telas de /clientes e /relatorios não clareiam ao navegar', () => {
    // Regressão da colisão de tema: o cvz lê `data-theme` e não tem fallback de
    // prefers-color-scheme nenhum, então ele PRECISA ser carimbado em JS —
    // senão o Popover e o Modal do cvz que o shell Resolv reaproveita
    // desenhariam uma moldura branca em volta de painéis escuros.
    sistemaPrefere(false)
    render(<BotaoTema />)

    fireEvent.click(screen.getByRole('button', { name: 'Usar tema escuro' }))
    expect(atributoCvz()).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Usar tema claro' }))
    expect(atributoCvz()).toBe('light')
  })

  it('nasce escuro quando ninguém escolheu e o sistema está no escuro', () => {
    sistemaPrefere(true)
    act(() => usePrefs.getState().setTema('sistema'))
    render(<BotaoTema />)

    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toBeInTheDocument()
    // Em "sistema" o atributo do Resolv fica AUSENTE de propósito: quem pinta
    // é o `@media (prefers-color-scheme: dark)` do tokens.scss, já no primeiro
    // paint. O do cvz não tem esse fallback, então é resolvido aqui.
    expect(atributoResolv()).toBeNull()
    expect(atributoCvz()).toBe('dark')
  })

  it('mantém o claro de quem escolheu claro mesmo com o sistema no escuro', () => {
    sistemaPrefere(true)
    act(() => usePrefs.getState().setTema('claro'))
    render(<BotaoTema />)

    expect(atributoResolv()).toBe('claro')
    expect(atributoCvz()).toBe('light')
    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
  })

  it('acompanha o sistema ao vivo enquanto ninguém escolheu, e para de acompanhar depois da escolha', () => {
    const so = sistemaPrefere(false)
    render(<BotaoTema />)

    so.mudarPara(true)
    expect(screen.getByRole('button', { name: 'Usar tema claro' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Usar tema claro' }))
    so.mudarPara(false)
    so.mudarPara(true)
    expect(atributoResolv()).toBe('claro')
    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
  })

  it('solta o ouvinte do sistema ao desmontar', () => {
    const so = sistemaPrefere(false)
    const { unmount } = render(<BotaoTema />)

    expect(so.quantidadeDeOuvintes()).toBe(1)
    unmount()
    expect(so.quantidadeDeOuvintes()).toBe(0)
  })

  it('renderiza no claro quando o ambiente não tem matchMedia (SSR/jsdom cru)', () => {
    render(<BotaoTema />)

    expect(screen.getByRole('button', { name: 'Usar tema escuro' })).toBeInTheDocument()
  })
})
