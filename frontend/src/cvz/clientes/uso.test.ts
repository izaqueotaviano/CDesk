import { describe, expect, it } from 'vitest'
import {
  clienteDesde,
  formatarMinutos,
  formatarQuando,
  porcentagemDoUso,
  renovacaoDoPeriodo,
  restanteDoSla,
  tomDoUso,
  trechoDoPeriodo,
} from './uso'

describe('tomDoUso', () => {
  it('é neutro abaixo de 80% — 17% não é problema', () => {
    expect(tomDoUso(0)).toBe('neutro')
    expect(tomDoUso(17)).toBe('neutro')
    expect(tomDoUso(79)).toBe('neutro')
  })

  it('alerta a partir de 80% e perigo a partir de 100%', () => {
    expect(tomDoUso(80)).toBe('alerta')
    expect(tomDoUso(99)).toBe('alerta')
    expect(tomDoUso(100)).toBe('perigo')
    expect(tomDoUso(130)).toBe('perigo')
  })
})

describe('porcentagemDoUso', () => {
  it('arredonda e não põe teto', () => {
    expect(porcentagemDoUso(5, 30)).toBe(17)
    expect(porcentagemDoUso(39, 30)).toBe(130)
  })

  it('sem limite não tem porcentagem', () => {
    expect(porcentagemDoUso(5, null)).toBeNull()
  })

  it('limite zero com uso é limite atingido, não divisão por zero', () => {
    expect(porcentagemDoUso(1, 0)).toBe(100)
    expect(porcentagemDoUso(0, 0)).toBe(0)
  })
})

describe('textos de período e duração', () => {
  it('fala o período da empresa', () => {
    expect(trechoDoPeriodo('weekly')).toBe('esta semana')
    expect(trechoDoPeriodo('monthly')).toBe('este mês')
    expect(trechoDoPeriodo('')).toBe('este mês')
  })

  it('minutos viram horas legíveis', () => {
    expect(formatarMinutos(0)).toBe('0h')
    expect(formatarMinutos(45)).toBe('45min')
    expect(formatarMinutos(60)).toBe('1h')
    expect(formatarMinutos(90)).toBe('1h 30min')
    expect(formatarMinutos(600)).toBe('10h')
  })

  it('renova no dia seguinte ao fim do período, sem escorregar de fuso', () => {
    expect(renovacaoDoPeriodo('2026-09-30')).toBe('1 out')
    expect(renovacaoDoPeriodo('2026-12-31')).toBe('1 jan')
    expect(renovacaoDoPeriodo('lixo')).toBeNull()
  })
})

describe('clienteDesde', () => {
  it('prefere o início do contrato', () => {
    expect(clienteDesde('2024-03-01', '2025-01-10T12:00:00Z')).toBe('março de 2024')
  })

  it('sem contrato, usa o cadastro', () => {
    expect(clienteDesde(null, '2025-01-10T12:00:00Z')).toBe('janeiro de 2025')
  })

  it('sem nenhum dos dois, não inventa', () => {
    expect(clienteDesde(null, undefined)).toBeNull()
  })
})

describe('formatarQuando', () => {
  const agora = new Date(2026, 8, 29, 18, 0)

  it('hoje e ontem com hora', () => {
    expect(formatarQuando(new Date(2026, 8, 29, 14, 32).toISOString(), agora)).toBe('hoje, 14:32')
    expect(formatarQuando(new Date(2026, 8, 28, 9, 5).toISOString(), agora)).toBe('ontem, 09:05')
  })

  it('mais antigo vira dia e mês; outro ano leva o ano', () => {
    expect(formatarQuando(new Date(2026, 8, 12, 9, 0).toISOString(), agora)).toBe('12 set')
    expect(formatarQuando(new Date(2025, 8, 12, 9, 0).toISOString(), agora)).toBe('12 set 2025')
  })

  it('sem data, nada', () => {
    expect(formatarQuando(null, agora)).toBeNull()
  })
})

describe('restanteDoSla', () => {
  it('no formato do SlaBadge', () => {
    expect(restanteDoSla(45)).toBe('45min')
    expect(restanteDoSla(134)).toBe('2h14')
    expect(restanteDoSla(120)).toBe('2h')
    expect(restanteDoSla(60 * 50)).toBe('2d')
    expect(restanteDoSla(null)).toBeUndefined()
  })
})
