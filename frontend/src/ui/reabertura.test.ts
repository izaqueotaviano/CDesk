import { describe, expect, it } from 'vitest'
import { quandoReabre } from './reabertura'

// quarta-feira, 30/09/2026, 09:15 (hora local)
const AGORA = new Date(2026, 8, 30, 9, 15)
const em = (dia: number, mes: number, h: number, ano = 2026) => new Date(ano, mes - 1, dia, h, 0).toISOString()

describe('quandoReabre', () => {
  it('fala hoje, amanhã e o dia da semana, sem a data inteira', () => {
    expect(quandoReabre(em(30, 9, 12), AGORA)).toBe('hoje às 12:00')
    expect(quandoReabre(em(1, 10, 8), AGORA)).toBe('amanhã às 08:00')
    expect(quandoReabre(em(5, 10, 8), AGORA)).toBe('na segunda às 08:00')
    expect(quandoReabre(em(3, 10, 8), AGORA)).toBe('no sábado às 08:00')
  })

  it('passada a semana, dá a data; o ano só quando não é o corrente', () => {
    expect(quandoReabre(em(12, 10, 8), AGORA)).toBe('em 12/10 às 08:00')
    expect(quandoReabre(em(4, 1, 8, 2027), AGORA)).toBe('em 04/01/2027 às 08:00')
  })
  it('horário que já passou (configuração velha) mostra a data, não "hoje"', () => {
    expect(quandoReabre(em(2, 9, 8), AGORA)).toBe('em 02/09 às 08:00')
  })
})
