import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import escalaDoTexto, { escalarFontSize } from './postcss-escala-texto.js'

async function processar(css) {
  const resultado = await postcss([escalaDoTexto()]).process(css, { from: undefined })
  return resultado.css
}

describe('escala do texto (PostCSS)', () => {
  it('multiplica px, rem e token pela escala', () => {
    expect(escalarFontSize('13px')).toBe('calc(13px * var(--escala-texto, 1))')
    expect(escalarFontSize('0.875rem')).toBe('calc(0.875rem * var(--escala-texto, 1))')
    expect(escalarFontSize('var(--fs-corpo)')).toBe('calc(var(--fs-corpo) * var(--escala-texto, 1))')
    expect(escalarFontSize('clamp(12px, 2vw, 16px)')).toBe(
      'calc(clamp(12px, 2vw, 16px) * var(--escala-texto, 1))',
    )
  })

  it('não mexe no que já é relativo ao pai (senão escala duas vezes)', () => {
    for (const v of ['1em', '0.9em', '100%', '85%', 'calc(1em + 2px)']) {
      expect(escalarFontSize(v)).toBe(v)
    }
  })

  it('não mexe em palavra-chave nem em zero', () => {
    for (const v of ['inherit', 'initial', 'unset', 'small', 'larger', '0', '0px']) {
      expect(escalarFontSize(v)).toBe(v)
    }
  })

  it('é idempotente: rodar duas vezes não multiplica duas vezes', () => {
    const uma = escalarFontSize('14px')
    expect(escalarFontSize(uma)).toBe(uma)
  })

  it('transforma a declaração e preserva !important; ignora outras propriedades', async () => {
    const css = await processar(
      '.a{font-size:12px!important;line-height:14px}.b{font-size-adjust:0.5;font:inherit}.c{--fs-corpo:14px}',
    )
    expect(css).toContain('font-size:calc(12px * var(--escala-texto, 1))!important')
    // altura de linha em px fica: caixas e alinhamentos não mudam de lugar
    expect(css).toContain('line-height:14px')
    expect(css).toContain('font-size-adjust:0.5')
    expect(css).toContain('font:inherit')
    // o token em si continua em px; quem o USA como font-size é escalado
    expect(css).toContain('--fs-corpo:14px')
  })
})
