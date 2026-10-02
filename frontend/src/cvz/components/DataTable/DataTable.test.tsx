import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { DataTable, DensityToggle, type Column } from './DataTable'

interface Linha {
  id: string
  nome: string
  usuarios: number
}

const LINHAS: Linha[] = [
  { id: '1', nome: 'Acme', usuarios: 3 },
  { id: '2', nome: 'Globex', usuarios: 12 },
]

const COLUNAS: Column<Linha>[] = [
  { key: 'nome', header: 'Nome', render: (l) => l.nome },
  { key: 'usuarios', header: 'Usuários', numeric: true, render: (l) => l.usuarios },
]

function montar() {
  return render(<DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} />)
}

afterEach(() => {
  // A preferência é um singleton de módulo persistido — sem devolver ao
  // padrão, a escolha de um teste vaza para o seguinte.
  usePrefs.setState({ densidade: 'compacta' })
})

describe('DataTable — densidade', () => {
  it('não desenha mais a faixa de ferramentas vazia em cima da tabela', () => {
    const { container } = montar()

    expect(container.querySelector('.data-table__toolbar')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tabela padrão' })).not.toBeInTheDocument()
    // Sem escolha nenhuma, nenhum modificador de densidade na classe.
    expect(container.querySelector('.data-table')).not.toHaveClass('data-table--relaxed')
    expect(container.querySelector('.data-table')).not.toHaveClass('data-table--compact')
  })

  it('a faixa volta quando a página manda conteúdo para ela', () => {
    const { container } = render(
      <DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} toolbar={<span>Filtro</span>} />,
    )
    expect(container.querySelector('.data-table__toolbar')).toHaveTextContent('Filtro')
  })

  it('o DensityToggle da página grava a preferência e a tabela segue', () => {
    const { container } = render(
      <>
        <DensityToggle />
        <DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} />
      </>,
    )

    expect(screen.getByRole('button', { name: 'Tabela padrão' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Tabela confortável/ }))

    expect(container.querySelector('.data-table')).toHaveClass('data-table--relaxed')
    expect(usePrefs.getState().densidade).toBe('confortavel')
    expect(screen.getByRole('button', { name: /Tabela confortável/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a preferência já gravada por outra tela chega aplicada nesta', () => {
    usePrefs.setState({ densidade: 'confortavel' })
    const { container } = montar()

    expect(container.querySelector('.data-table')).toHaveClass('data-table--relaxed')
  })

  it('com `density` explícito, a página manda e a preferência não pesa', () => {
    usePrefs.setState({ densidade: 'confortavel' })
    const { container } = render(
      <DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} density="compact" />,
    )

    expect(container.querySelector('.data-table')).toHaveClass('data-table--compact')
    expect(container.querySelector('.data-table')).not.toHaveClass('data-table--relaxed')
  })
})

describe('DataTable — coluna numérica', () => {
  it('cabeçalho e valor ficam do mesmo lado (a classe vale para os dois)', () => {
    montar()

    expect(screen.getByRole('columnheader', { name: 'Usuários' })).toHaveClass('data-table__num')
    expect(screen.getByRole('cell', { name: '12' })).toHaveClass('data-table__num')
    expect(screen.getByRole('columnheader', { name: 'Nome' })).not.toHaveClass('data-table__num')
  })
})

describe('DataTable — linha clicável', () => {
  // Endereço em fragmento (`#/…`): o jsdom não navega para outro documento
  // e reclamaria no console no teste do Ctrl+clique, que deixa o link seguir.
  function montarClicavel(onRowClick = vi.fn()) {
    const colunas: Column<Linha>[] = [
      ...COLUNAS,
      {
        key: 'acoes',
        header: '',
        render: () => (
          <button type="button" onClick={() => {}}>
            Editar
          </button>
        ),
      },
    ]
    render(
      <DataTable
        rows={LINHAS}
        columns={colunas}
        rowKey={(l) => l.id}
        onRowClick={onRowClick}
        rowHref={(l) => `#/clientes/${l.id}`}
      />,
    )
    return onRowClick
  }

  it('a célula principal vira um link de verdade, com o endereço da linha', () => {
    montarClicavel()

    const link = screen.getByRole('link', { name: 'Globex' })
    expect(link).toHaveAttribute('href', '#/clientes/2')
  })

  it('clicar em qualquer ponto da linha abre', () => {
    const onRowClick = montarClicavel()

    fireEvent.click(screen.getByRole('cell', { name: '12' }))
    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledWith(LINHAS[1])
  })

  it('o link abre uma vez só (não soma o clique da linha) e fica na SPA', () => {
    const onRowClick = montarClicavel()

    const link = screen.getByRole('link', { name: 'Acme' })
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(evento)

    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick).toHaveBeenCalledWith(LINHAS[0])
    expect(evento.defaultPrevented).toBe(true)
  })

  it('Ctrl+clique no link fica com o navegador (outra aba), sem abrir na SPA', () => {
    const onRowClick = montarClicavel()

    const link = screen.getByRole('link', { name: 'Acme' })
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true })
    link.dispatchEvent(evento)

    expect(onRowClick).not.toHaveBeenCalled()
    expect(evento.defaultPrevented).toBe(false)
  })

  it('um botão dentro da linha é só dele — não abre a linha', () => {
    const onRowClick = montarClicavel()

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0])
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('sem `rowHref`, o alvo de teclado é um botão (Enter abre)', () => {
    const onRowClick = vi.fn()
    render(<DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} onRowClick={onRowClick} />)

    const alvo = screen.getByRole('button', { name: 'Acme' })
    alvo.focus()
    expect(alvo).toHaveFocus()
    // Enter num <button> dispara click no navegador; o jsdom não simula isso,
    // então o click representa a tecla.
    fireEvent.click(alvo)
    expect(onRowClick).toHaveBeenCalledWith(LINHAS[0])
  })

  it('sem `onRowClick`, nenhuma célula vira link', () => {
    montar()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Acme' })).not.toBeInTheDocument()
  })
})
