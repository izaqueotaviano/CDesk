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
  const botao = (nome: string) => screen.getByRole('button', { name: nome })

  it('nasce em "sistema" e o primeiro clique troca o que está na tela', () => {
    sistemaPrefere(false)
    render(<BotaoTema />)

    // Padrão de fábrica: ninguém escolheu nada, então a aparência é a do SO.
    // O computador está claro — oferecer "claro" seria um clique morto.
    expect(usePrefs.getState().tema).toBe('sistema')
    fireEvent.click(botao('Usar tema escuro'))
    expect(usePrefs.getState().tema).toBe('escuro')
    expect(atributoResolv()).toBe('escuro')
  })

  it('num computador claro alterna sistema ↔ escuro, e volta ao automático', () => {
    sistemaPrefere(false)
    act(() => usePrefs.getState().setTema('escuro'))
    render(<BotaoTema />)

    // O degrau que evita ficar preso: sem ele, quem clicasse uma vez nunca
    // mais voltava a acompanhar o sistema.
    fireEvent.click(botao('Acompanhar o sistema'))
    expect(usePrefs.getState().tema).toBe('sistema')

    fireEvent.click(botao('Usar tema escuro'))
    expect(usePrefs.getState().tema).toBe('escuro')
  })

  it('num computador escuro, o automático oferece o claro', () => {
    sistemaPrefere(true)
    render(<BotaoTema />)

    fireEvent.click(botao('Usar tema claro'))
    expect(usePrefs.getState().tema).toBe('claro')
    fireEvent.click(botao('Acompanhar o sistema'))
    expect(usePrefs.getState().tema).toBe('sistema')
  })

  it('"claro" fixo num computador claro vai para o escuro, não para o automático', () => {
    // Voltar ao automático ali não mudaria nada na tela.
    sistemaPrefere(false)
    act(() => usePrefs.getState().setTema('claro'))
    render(<BotaoTema />)

    fireEvent.click(botao('Usar tema escuro'))
    expect(usePrefs.getState().tema).toBe('escuro')
  })

  it('em "sistema" deixa o atributo do Resolv ausente e resolve o do cvz em JS', () => {
    sistemaPrefere(true)
    act(() => usePrefs.getState().setTema('sistema'))
    render(<BotaoTema />)

    // Ausente de propósito: quem pinta é o `@media (prefers-color-scheme)` do
    // tokens.css, já no primeiro paint. O cvz não tem esse fallback.
    expect(atributoResolv()).toBeNull()
    expect(atributoCvz()).toBe('dark')
  })

  it('leva o shell cvz junto: /clientes e /relatorios não clareiam ao navegar', () => {
    // Regressão da colisão de tema: o cvz lê `data-theme` e não tem fallback
    // de prefers-color-scheme, então PRECISA ser carimbado em JS — senão o
    // Popover e o Modal do cvz que o shell Resolv reaproveita desenhariam
    // uma moldura branca em volta de painéis escuros.
    sistemaPrefere(false)
    act(() => usePrefs.getState().setTema('claro'))
    render(<BotaoTema />)

    fireEvent.click(botao('Usar tema escuro'))
    expect(atributoCvz()).toBe('dark')

    fireEvent.click(botao('Acompanhar o sistema'))
    expect(atributoCvz()).toBe('light')
  })

  it('quem escolheu claro ignora o sistema no escuro', () => {
    sistemaPrefere(true)
    act(() => usePrefs.getState().setTema('claro'))
    render(<BotaoTema />)

    expect(atributoResolv()).toBe('claro')
    expect(atributoCvz()).toBe('light')
  })

  it('quem escolheu para de acompanhar o sistema', () => {
    // O ouvinte que RE-CARIMBA em "sistema" é de módulo (prefs.ts), registrado
    // no import — antes deste stub existir —, então ele não está no conjunto
    // do `sistemaPrefere`. O que dá para observar aqui é o outro lado, que é
    // o que importa: depois da escolha, mexer no SO não muda mais nada.
    const so = sistemaPrefere(false)
    render(<BotaoTema />)

    act(() => usePrefs.getState().setTema('claro'))
    so.mudarPara(true)
    so.mudarPara(false)

    expect(atributoResolv()).toBe('claro')
    expect(atributoCvz()).toBe('light')
  })

  it('solta o ouvinte do sistema ao desmontar', () => {
    const so = sistemaPrefere(false)
    const { unmount } = render(<BotaoTema />)

    expect(so.quantidadeDeOuvintes()).toBe(1)
    unmount()
    expect(so.quantidadeDeOuvintes()).toBe(0)
  })

  it('renderiza sem matchMedia (SSR/jsdom cru) sem quebrar', () => {
    render(<BotaoTema />)

    // Sem matchMedia, "sistema" resolve para claro — o próximo é o escuro.
    expect(botao('Usar tema escuro')).toBeInTheDocument()
  })
})
