import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AtalhosGlobais } from './AtalhosGlobais'
import { ATALHOS, GRUPOS_ATALHOS, rotuloDaTecla } from './catalogo'
import { usePainelAtalhos } from './estado'
import { ESPERA_SEQUENCIA_MS, deveIgnorar } from './registro'
import { useAtalhos } from './useAtalhos'
import type { MapaDeAtalhos } from './registro'

function Registrar({ mapa, ativo }: { mapa: MapaDeAtalhos; ativo?: boolean }) {
  useAtalhos(mapa, ativo)
  return null
}

function teclar(key: string, extra: Partial<KeyboardEventInit> = {}, alvo: Element = document.body) {
  fireEvent.keyDown(alvo, { key, ...extra })
}

afterEach(() => {
  act(() => usePainelAtalhos.getState().fechar())
})

describe('catálogo', () => {
  it('lista os três grupos e nenhum id repetido', () => {
    expect(GRUPOS_ATALHOS.map((g) => g.titulo)).toEqual(['Geral', 'Lista de tickets', 'Ticket aberto'])
    const ids = ATALHOS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('escreve as teclas como a pessoa as vê', () => {
    expect(rotuloDaTecla('Escape')).toBe('Esc')
    expect(rotuloDaTecla('?')).toBe('?')
    expect(rotuloDaTecla('mod+z')).toMatch(/^(Ctrl|⌘) Z$/)
  })
})

describe('regras do despachante', () => {
  it('não dispara digitando em input, textarea, select ou contenteditable', () => {
    const r = vi.fn()
    render(
      <>
        <Registrar mapa={{ 'ticket.responder': r }} />
        <input aria-label="texto" />
        <textarea aria-label="area" />
        <select aria-label="lista">
          <option>a</option>
        </select>
        <div contentEditable aria-label="rico" suppressContentEditableWarning>
          x
        </div>
        <input type="checkbox" aria-label="marcar" />
      </>,
    )
    for (const nome of ['texto', 'area', 'lista', 'rico']) {
      teclar('r', {}, screen.getByLabelText(nome))
    }
    expect(r).not.toHaveBeenCalled()

    // caixa de marcar não recebe texto: a tecla continua sendo atalho
    teclar('r', {}, screen.getByLabelText('marcar'))
    expect(r).toHaveBeenCalledTimes(1)
  })

  it('não dispara com um diálogo modal aberto', () => {
    const r = vi.fn()
    render(
      <>
        <Registrar mapa={{ 'ticket.responder': r }} />
        <div role="dialog" aria-modal="true">
          <button>dentro</button>
        </div>
      </>,
    )
    teclar('r', {}, screen.getByText('dentro'))
    teclar('r')
    expect(r).not.toHaveBeenCalled()
  })

  it('não dispara com Ctrl, ⌘ ou Alt — só o `mod+z` declarado', () => {
    const r = vi.fn()
    const desfazer = vi.fn()
    render(<Registrar mapa={{ 'ticket.responder': r, 'geral.desfazer': desfazer }} />)
    teclar('r', { ctrlKey: true })
    teclar('r', { metaKey: true })
    teclar('r', { altKey: true })
    expect(r).not.toHaveBeenCalled()

    teclar('z', { ctrlKey: true })
    teclar('z', { metaKey: true })
    expect(desfazer).toHaveBeenCalledTimes(2)
    teclar('z')
    expect(desfazer).toHaveBeenCalledTimes(2)
  })

  it('ignora tecla segurada e evento que outro já tratou', () => {
    const e = new KeyboardEvent('keydown', { key: 'r', repeat: true })
    expect(deveIgnorar(e)).toBe(true)
    const tratado = new KeyboardEvent('keydown', { key: 'r', cancelable: true })
    tratado.preventDefault()
    expect(deveIgnorar(tratado)).toBe(true)
  })

  it('casa sequência de duas teclas dentro do prazo, e só dentro dele', () => {
    vi.useFakeTimers()
    const inicio = vi.fn()
    render(<Registrar mapa={{ 'geral.ir-inicio': inicio }} />)

    teclar('g')
    teclar('i')
    expect(inicio).toHaveBeenCalledTimes(1)

    teclar('g')
    act(() => {
      vi.advanceTimersByTime(ESPERA_SEQUENCIA_MS + 1)
    })
    teclar('i')
    expect(inicio).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('sequência que não completa deixa a tecla nova valer sozinha', () => {
    const ajuda = vi.fn()
    const inicio = vi.fn()
    render(<Registrar mapa={{ 'geral.ajuda': ajuda, 'geral.ir-inicio': inicio }} />)
    teclar('g')
    teclar('?', { shiftKey: true })
    expect(ajuda).toHaveBeenCalledTimes(1)
    expect(inicio).not.toHaveBeenCalled()
  })

  it('o registro mais recente ganha a tecla; sem ele, volta o de baixo', () => {
    const doShell = vi.fn()
    const daTela = vi.fn()
    const { rerender } = render(
      <>
        <Registrar mapa={{ 'geral.fechar': doShell }} />
        <Registrar mapa={{ 'geral.fechar': daTela }} />
      </>,
    )
    teclar('Escape')
    expect(daTela).toHaveBeenCalledTimes(1)
    expect(doShell).not.toHaveBeenCalled()

    // `undefined` = a tela não quer a tecla agora (nenhuma gaveta aberta)
    rerender(
      <>
        <Registrar mapa={{ 'geral.fechar': doShell }} />
        <Registrar mapa={{ 'geral.fechar': undefined }} />
      </>,
    )
    teclar('Escape')
    expect(doShell).toHaveBeenCalledTimes(1)
  })

  it('a tecla que vira comando não chega a digitar nada', () => {
    render(<Registrar mapa={{ 'geral.busca': vi.fn<() => void>() }} />)
    const e = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })
    document.body.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(true)
  })

  it('desmontado, não responde mais', () => {
    const r = vi.fn()
    const { unmount } = render(<Registrar mapa={{ 'ticket.responder': r }} />)
    unmount()
    teclar('r')
    expect(r).not.toHaveBeenCalled()
  })
})

describe('AtalhosGlobais e o painel', () => {
  function montar(onAbrirBusca = vi.fn()) {
    render(
      <MemoryRouter initialEntries={['/chamados/42']}>
        <AtalhosGlobais onAbrirBusca={onAbrirBusca} />
        <button>fora do painel</button>
        <Routes>
          <Route path="/inicio" element={<p>tela inicial</p>} />
          <Route path="/quadro" element={<p>tela do quadro</p>} />
          <Route path="*" element={<p>outra</p>} />
        </Routes>
      </MemoryRouter>,
    )
    return onAbrirBusca
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => vi.useRealTimers())

  it('`/` abre a busca; `g` `q` vai para o Quadro', () => {
    const busca = montar()
    teclar('/')
    expect(busca).toHaveBeenCalledTimes(1)

    teclar('g')
    teclar('q')
    expect(screen.getByText('tela do quadro')).toBeInTheDocument()
  })

  it('`?` abre um diálogo com TODOS os atalhos do catálogo; Esc fecha e devolve o foco', () => {
    montar()
    const origem = screen.getByRole('button', { name: 'fora do painel' })
    origem.focus()

    teclar('?', { shiftKey: true }, origem)
    const dialogo = screen.getByRole('dialog', { name: 'Atalhos de teclado' })
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    for (const a of ATALHOS) expect(dialogo).toHaveTextContent(a.descricao)
    act(() => {
      vi.runOnlyPendingTimers()
    })
    expect(screen.getByRole('button', { name: 'Fechar atalhos de teclado' })).toHaveFocus()

    // com o painel aberto os outros atalhos ficam quietos
    teclar('g', {}, dialogo)
    teclar('i', {}, dialogo)
    expect(screen.queryByText('tela inicial')).not.toBeInTheDocument()

    fireEvent.keyDown(dialogo, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(origem).toHaveFocus()
  })

  it('o painel também abre por fora da tecla (menu da conta)', () => {
    montar()
    act(() => usePainelAtalhos.getState().abrir())
    expect(screen.getByRole('dialog', { name: 'Atalhos de teclado' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar atalhos de teclado' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
