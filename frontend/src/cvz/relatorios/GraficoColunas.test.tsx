import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GraficoColunas } from './GraficoColunas'
import { classeDoDelta, sentidoDoKpi } from './formato'

const SERIES = [
  { key: 'opened', label: 'Abertos', tom: 'acento' as const },
  { key: 'resolved', label: 'Resolvidos', tom: 'apoio' as const },
]

function grupos(valores: [number, number][]) {
  return valores.map(([opened, resolved], i) => ({
    key: `2026-09-0${i + 1}`,
    rotulo: `0${i + 1}/09`,
    rotuloLongo: `0${i + 1}/09/2026`,
    valores: { opened, resolved },
    extras: [{ label: 'No prazo', valor: resolved }],
  }))
}

describe('GraficoColunas', () => {
  it('um dia com movimento é UMA coluna por série, não um pico ligado aos zeros', () => {
    const { container } = render(
      <GraficoColunas titulo="Teste" series={SERIES} grupos={grupos([[0, 0], [3, 1], [0, 0]])} />,
    )
    expect(container.querySelectorAll('.grafico-colunas__coluna--acento')).toHaveLength(1)
    expect(container.querySelectorAll('.grafico-colunas__coluna--apoio')).toHaveLength(1)
    expect(container.querySelector('path:not([class])')).toBeNull()
  })

  it('duas séries têm legenda; a tabela de apoio traz todos os números', () => {
    render(<GraficoColunas titulo="Teste" series={SERIES} grupos={grupos([[2, 1], [0, 4]])} />)
    expect(screen.getByText('Abertos', { selector: '.grafico-colunas__chave' })).toBeInTheDocument()
    const linha = screen.getByRole('row', { name: /02\/09\/2026/ })
    expect(linha).toHaveTextContent('04')
  })

  it('o teclado lê dia a dia: setas mostram o tooltip com todas as séries', () => {
    render(<GraficoColunas titulo="Teste" series={SERIES} grupos={grupos([[2, 1], [5, 0]])} />)
    const grafico = screen.getByRole('img')
    grafico.focus()
    fireEvent.keyDown(grafico, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('01/09/2026')
    fireEvent.keyDown(grafico, { key: 'ArrowRight' })
    const tooltip = screen.getByRole('status')
    expect(tooltip).toHaveTextContent('02/09/2026')
    expect(tooltip).toHaveTextContent('5 abertos')
    expect(tooltip).toHaveTextContent('0 resolvidos')
    fireEvent.keyDown(grafico, { key: 'Escape' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('período sem nada convida a trocar o recorte', () => {
    render(<GraficoColunas titulo="Teste" unidade="ticket" series={SERIES} grupos={grupos([[0, 0], [0, 0]])} />)
    expect(screen.getByText('Nenhum ticket no período. Escolha outro período acima.')).toBeInTheDocument()
  })
})

describe('variação com sentido', () => {
  it('KPI de tempo (direction "down"): subir é ruim', () => {
    expect(sentidoDoKpi('down')).toBe('up-is-bad')
    expect(sentidoDoKpi('up')).toBe('up-is-good')
    expect(sentidoDoKpi(null)).toBe('neutral')
  })

  it('a classe só pinta quando a métrica tem lado bom', () => {
    expect(classeDoDelta(600, 'up-is-bad')).toBe('relatorios-delta relatorios-delta--ruim')
    expect(classeDoDelta(-20, 'up-is-bad')).toBe('relatorios-delta relatorios-delta--bom')
    expect(classeDoDelta(50, 'up-is-good')).toBe('relatorios-delta relatorios-delta--bom')
    expect(classeDoDelta(168, 'neutral')).toBe('relatorios-delta')
    expect(classeDoDelta(0, 'up-is-good')).toBe('relatorios-delta')
  })
})
