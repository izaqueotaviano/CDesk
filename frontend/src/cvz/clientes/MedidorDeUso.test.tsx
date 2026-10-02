import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MedidorDeUso } from './MedidorDeUso'

function montar(usado: number, limite: number | null) {
  const descricao = limite == null ? `${usado} tickets este mês, sem limite` : `${usado} de ${limite} tickets este mês`
  const { container } = render(
    <MedidorDeUso rotulo="Tickets" usado={usado} limite={limite} descricao={descricao} renova="1 out" />,
  )
  return container.querySelector('.empresa-uso') as HTMLElement
}

describe('MedidorDeUso', () => {
  it('17% é neutro: sem cor de perigo e sem aviso', () => {
    const raiz = montar(5, 30)
    expect(raiz).toHaveClass('empresa-uso--neutro')
    expect(screen.queryByText(/limite/i, { selector: '.empresa-uso__estado' })).not.toBeInTheDocument()
  })

  it('expõe a medida com o texto como valor, não a porcentagem', () => {
    montar(5, 30)
    const medidor = screen.getByRole('meter', { name: 'Tickets' })
    expect(medidor).toHaveAttribute('aria-valuenow', '5')
    expect(medidor).toHaveAttribute('aria-valuemax', '30')
    expect(medidor).toHaveAttribute('aria-valuetext', '5 de 30 tickets este mês')
    expect(screen.getByText('5 de 30 tickets este mês')).toBeInTheDocument()
    expect(screen.getByText('Renova em 1 out')).toBeInTheDocument()
  })

  it('a partir de 80% avisa em texto, não só na cor', () => {
    const raiz = montar(24, 30)
    expect(raiz).toHaveClass('empresa-uso--alerta')
    expect(screen.getByText('Perto do limite')).toBeInTheDocument()
  })

  it('no limite é perigo; acima dele, diz que passou', () => {
    const noLimite = montar(30, 30)
    expect(noLimite).toHaveClass('empresa-uso--perigo')
    expect(screen.getByText('Limite atingido')).toBeInTheDocument()
  })

  it('acima do limite a barra satura e o texto diz que passou', () => {
    const raiz = montar(39, 30)
    expect(raiz).toHaveClass('empresa-uso--perigo')
    expect(screen.getByText('Acima do limite')).toBeInTheDocument()
    const barra = raiz.querySelector('.empresa-uso__barra') as HTMLElement
    expect(barra.style.width).toBe('100%')
    // a medida continua válida (valor dentro do intervalo)
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuemax', '39')
  })

  it('sem limite não desenha barra, só o texto', () => {
    montar(5, null)
    expect(screen.queryByRole('meter')).not.toBeInTheDocument()
    expect(screen.getByText('5 tickets este mês, sem limite')).toBeInTheDocument()
  })
})
