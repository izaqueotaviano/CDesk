import { describe, expect, it } from 'vitest'
import { direcaoVariacao, formatarMinutos, formatarPercentual, formatarVariacao } from './formato'

/**
 * Os dois formatadores de porcentagem do painel recebem contratos DIFERENTES
 * do mesmo backend, e é exatamente por isso que este arquivo existe: a
 * ausência dele deixou `formatarVariacao` multiplicar por 100 uma entrada que
 * já vinha em percentual, e o painel exibiu "+20000%" com dado real por
 * várias rodadas. Os números abaixo são os mesmos que
 * `apps/reports/tests/test_indicators.py` afirma para `indicators.variation`.
 */
describe('formatarVariacao (entrada em PERCENTUAL, como o backend manda)', () => {
  it('formata os casos que o backend testa, sem reescalar', () => {
    // indicators.variation(6, 4) == 50.0
    expect(formatarVariacao(50)).toBe('+50%')
    // indicators.variation(2, 4) == -50.0
    expect(formatarVariacao(-50)).toBe('-50%')
  })

  it('não inventa sinal para estável, e some quando não há o que comparar', () => {
    expect(formatarVariacao(0)).toBe('0%')
    // `variation` é null quando o período anterior foi zero: "estável" e
    // "+100%" seriam os dois mentira, então a UI não mostra nada.
    expect(formatarVariacao(null)).toBe('')
  })

  it('arredonda as casas decimais que o backend manda', () => {
    // o backend arredonda em 2 casas (round(..., 2)); a UI mostra inteiro
    expect(formatarVariacao(33.33)).toBe('+33%')
    expect(formatarVariacao(-12.5)).toBe('-12%')
  })
})

describe('formatarPercentual (entrada em FRAÇÃO 0–1, o contrato de on_time_rate)', () => {
  it('multiplica por 100 — é o contrato oposto, no mesmo painel', () => {
    expect(formatarPercentual(0.9)).toBe('90%')
    expect(formatarPercentual(1)).toBe('100%')
  })

  it('distingue "sem amostra" de zero', () => {
    // null é "o agente não tem ticket com SLA definido", não 0%
    expect(formatarPercentual(null)).toBe('—')
    expect(formatarPercentual(0)).toBe('0%')
  })
})

describe('formatarMinutos (contrato de ChatReportView: minutos, não segundos)', () => {
  it('reaproveita a escala de formatarDuracao, convertendo minutos em segundos', () => {
    expect(formatarMinutos(5)).toBe('5min')
    expect(formatarMinutos(90)).toBe('1h 30min')
  })

  it('sem amostra é traço, não zero', () => {
    expect(formatarMinutos(null)).toBe('—')
    expect(formatarMinutos(undefined)).toBe('—')
  })
})

describe('direcaoVariacao', () => {
  it('depende só do sinal, então não muda com a escala', () => {
    expect(direcaoVariacao(50)).toBe('up')
    expect(direcaoVariacao(-50)).toBe('down')
    expect(direcaoVariacao(0)).toBe('flat')
    expect(direcaoVariacao(null)).toBe('flat')
  })
})
