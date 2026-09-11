import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { DataTable, type Column } from './DataTable'

interface Linha {
  id: string
  nome: string
}

const LINHAS: Linha[] = [
  { id: '1', nome: 'Acme' },
  { id: '2', nome: 'Globex' },
]

const COLUNAS: Column<Linha>[] = [{ key: 'nome', header: 'Nome', render: (l) => l.nome }]

function montar() {
  return render(<DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} />)
}

afterEach(() => {
  // A preferência é um singleton de módulo persistido (mesmo padrão de
  // Sidebar.test.tsx) — sem devolver ao padrão, a escolha de um teste vaza
  // para o seguinte.
  usePrefs.setState({ densidade: 'compacta' })
})

describe('DataTable — alternador de densidade', () => {
  it('sem prop `density`, mostra o alternador e começa em "Tabela padrão"', () => {
    const { container } = montar()

    const padrao = screen.getByRole('button', { name: 'Tabela padrão' })
    const confortavel = screen.getByRole('button', { name: /Tabela confortável/ })
    expect(padrao).toHaveAttribute('aria-pressed', 'true')
    expect(confortavel).toHaveAttribute('aria-pressed', 'false')
    // Sem escolha nenhuma, a tabela renderiza EXATAMENTE como antes de a
    // preferência existir — nenhum modificador de densidade na classe.
    expect(container.querySelector('.data-table')).not.toHaveClass('data-table--relaxed')
    expect(container.querySelector('.data-table')).not.toHaveClass('data-table--compact')
  })

  it('clicar em "Tabela confortável" aplica o modificador `relaxed` e grava a preferência global', () => {
    const { container } = montar()

    fireEvent.click(screen.getByRole('button', { name: /Tabela confortável/ }))

    expect(container.querySelector('.data-table')).toHaveClass('data-table--relaxed')
    expect(usePrefs.getState().densidade).toBe('confortavel')
    expect(screen.getByRole('button', { name: /Tabela confortável/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('a preferência já gravada por outra tela chega marcada nesta', () => {
    usePrefs.setState({ densidade: 'confortavel' })
    const { container } = montar()

    expect(container.querySelector('.data-table')).toHaveClass('data-table--relaxed')
    expect(screen.getByRole('button', { name: 'Tabela padrão' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('com `density` explícito, a página manda e o alternador não aparece', () => {
    const { container } = render(
      <DataTable rows={LINHAS} columns={COLUNAS} rowKey={(l) => l.id} density="compact" />,
    )

    expect(container.querySelector('.data-table')).toHaveClass('data-table--compact')
    expect(screen.queryByRole('button', { name: 'Tabela padrão' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tabela confortável/ })).not.toBeInTheDocument()
  })
})
