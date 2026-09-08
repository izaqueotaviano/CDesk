import { fireEvent, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { MenuFlutuante, type ItemDoMenu } from './MenuFlutuante'

function Cenario({ itens }: { itens: ItemDoMenu[] }) {
  const [aberto, setAberto] = useState(false)
  const gatilho = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={gatilho} type="button" onClick={() => setAberto(true)}>
        abrir
      </button>
      <MenuFlutuante
        aberto={aberto}
        onFechar={() => setAberto(false)}
        itens={itens}
        rotulo="Menu de teste"
        obterAncora={() => gatilho.current}
      />
    </>
  )
}

describe('MenuFlutuante — menu WAI-ARIA', () => {
  it('abre com o foco no primeiro item habilitado, pula os desabilitados com as setas e dá a volta', () => {
    render(
      <Cenario
        itens={[
          { rotulo: 'Desligado', onSelecionar: vi.fn(), desabilitado: true },
          { rotulo: 'Um', onSelecionar: vi.fn() },
          { tipo: 'separador' },
          { rotulo: 'Dois', onSelecionar: vi.fn() },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }))

    const menu = screen.getByRole('menu', { name: 'Menu de teste' })
    expect(screen.getByRole('menuitem', { name: 'Um' })).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Dois' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: 'Um' })).toHaveFocus()
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(screen.getByRole('menuitem', { name: 'Dois' })).toHaveFocus()
  })

  it('escolher um item fecha, chama a ação e devolve o foco pro gatilho; Esc só fecha e devolve', () => {
    const acao = vi.fn()
    render(<Cenario itens={[{ rotulo: 'Agir', onSelecionar: acao }]} />)
    const gatilho = screen.getByRole('button', { name: 'abrir' })

    fireEvent.click(gatilho)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agir' }))
    expect(acao).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()

    fireEvent.click(gatilho)
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(gatilho).toHaveFocus()
    expect(acao).toHaveBeenCalledOnce()
  })

  it('clique fora fecha', () => {
    render(
      <>
        <p>fora</p>
        <Cenario itens={[{ rotulo: 'Agir', onSelecionar: vi.fn() }]} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('fora'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
