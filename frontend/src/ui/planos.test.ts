import { describe, expect, it } from 'vitest'
import { indiceDoPlano } from './planos'

describe('tom de identidade do plano', () => {
  it('os três planos conhecidos têm tons distintos e fixos (por conotação)', () => {
    expect(indiceDoPlano('Black')).toBe(5)
    expect(indiceDoPlano('Gold')).toBe(4)
    expect(indiceDoPlano('Platinum')).toBe(3)
  })

  it('não depende de caixa nem de espaço em volta', () => {
    expect(indiceDoPlano('  GOLD ')).toBe(indiceDoPlano('gold'))
  })

  it('plano desconhecido cai no hash — determinístico, e sempre 1..6', () => {
    expect(indiceDoPlano('Enterprise')).toBe(indiceDoPlano('Enterprise'))
    expect(indiceDoPlano('Enterprise')).toBeGreaterThanOrEqual(1)
    expect(indiceDoPlano('Enterprise')).toBeLessThanOrEqual(6)
    expect(indiceDoPlano(null)).toBeGreaterThanOrEqual(1)
  })
})
