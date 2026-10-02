import { describe, expect, it } from 'vitest'
import { quandoCurto } from './format'

/**
 * "há 20d" na lista obrigava a fazer a conta de volta. A lista agora diz
 * como mensageiro: minutos, hora de hoje, "ontem", dia da semana e, antes
 * disso, a data. Datas montadas no fuso LOCAL, como a tela as mostra.
 */
const agora = new Date(2026, 8, 29, 15, 0) // terça, 29/09/2026 15:00
const iso = (...partes: [number, number, number, number, number]) => new Date(...partes).toISOString()

describe('quandoCurto', () => {
  it('menos de um minuto é "agora"; menos de uma hora, minutos', () => {
    expect(quandoCurto(iso(2026, 8, 29, 14, 59), agora.getTime() - 30_000)).toBe('agora')
    expect(quandoCurto(iso(2026, 8, 29, 14, 48), agora.getTime())).toBe('12 min')
  })

  it('mais cedo hoje mostra a hora', () => {
    expect(quandoCurto(iso(2026, 8, 29, 9, 5), agora.getTime())).toBe('09:05')
  })

  it('ontem é "ontem", e na semana o dia abreviado', () => {
    expect(quandoCurto(iso(2026, 8, 28, 23, 50), agora.getTime())).toBe('ontem')
    expect(quandoCurto(iso(2026, 8, 25, 10, 0), agora.getTime())).toBe('sex.')
  })

  it('antes disso, a data — com o ano só quando é outro', () => {
    expect(quandoCurto(iso(2026, 8, 9, 10, 0), agora.getTime())).toBe('09/09')
    expect(quandoCurto(iso(2025, 11, 30, 10, 0), agora.getTime())).toBe('30/12/25')
  })

  it('sem data, nada', () => {
    expect(quandoCurto(null, agora.getTime())).toBe('')
  })
})
