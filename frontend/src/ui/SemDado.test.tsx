import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SemDado } from './SemDado'

// Regra de voz/tom: ausência de dado é "—", NUNCA "0" (DESIGN_SYSTEM.md §7).
describe('SemDado', () => {
  it('mostra — quando o valor é null', () => {
    render(<SemDado valor={null} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('mostra o valor quando ele é 0 de verdade — não confunde com ausência', () => {
    render(<SemDado valor={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('mostra ··· enquanto carrega', () => {
    render(<SemDado valor={undefined} carregando />)
    expect(screen.getByText('···')).toBeInTheDocument()
  })
})
