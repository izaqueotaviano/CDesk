import { describe, expect, it } from 'vitest'
import { rotuloAbrirChamado } from './format'

describe('rotuloAbrirChamado — nome acessível do link de protocolo (item 26)', () => {
  it('junta referência, assunto e empresa — o mesmo contexto que quem enxerga pega na linha', () => {
    expect(
      rotuloAbrirChamado({ reference: 'TCK-0012', subject: 'Teclado sem resposta', company_name: 'Acme Marketing' }),
    ).toBe('Abrir chamado TCK-0012: Teclado sem resposta (Acme Marketing)')
  })

  it('sem empresa (campo vazio), não deixa um "—" pendurado no fim', () => {
    expect(rotuloAbrirChamado({ reference: 'TCK-0013', subject: 'Sem empresa vinculada', company_name: '' })).toBe(
      'Abrir chamado TCK-0013: Sem empresa vinculada',
    )
  })
})
