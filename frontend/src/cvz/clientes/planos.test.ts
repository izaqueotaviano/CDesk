import { describe, expect, it } from 'vitest'
import { toneDoPlano } from './planos'

describe('tom do selo de plano', () => {
  it('os três planos conhecidos têm tons distintos e fixos (por conotação)', () => {
    const tons = [toneDoPlano('Black'), toneDoPlano('Gold'), toneDoPlano('Platinum')]
    expect(new Set(tons).size).toBe(3)
    expect(toneDoPlano('Black')).toBe('identity-5')
    expect(toneDoPlano('Gold')).toBe('identity-4')
    expect(toneDoPlano('Platinum')).toBe('identity-3')
  })

  it('não depende de caixa nem de espaço em volta', () => {
    expect(toneDoPlano('  GOLD ')).toBe(toneDoPlano('gold'))
  })

  it('plano desconhecido cai no hash — determinístico, e sempre um tom de identidade', () => {
    expect(toneDoPlano('Enterprise')).toBe(toneDoPlano('Enterprise'))
    expect(toneDoPlano('Enterprise')).toMatch(/^identity-[1-6]$/)
    expect(toneDoPlano(null)).toMatch(/^identity-[1-6]$/)
  })
})
