import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { SecaoTamanhoTexto } from './SecaoTamanhoTexto'

afterEach(() => {
  usePrefs.getState().setTamanhoTexto('padrao')
})

describe('Configurações do portal → Tamanho do texto', () => {
  it('aplica na hora no documento e volta limpo no padrão', () => {
    render(<SecaoTamanhoTexto />)
    const grupo = screen.getByRole('radiogroup', { name: 'Tamanho' })
    expect(within(grupo).getByRole('radio', { name: /Padrão/ })).toBeChecked()

    fireEvent.click(within(grupo).getByRole('radio', { name: /Maior/ }))
    const raiz = document.documentElement
    expect(usePrefs.getState().tamanhoTexto).toBe('maior')
    expect(raiz.style.getPropertyValue('--escala-texto')).toBe('1.25')
    expect(raiz.dataset.tamanhoTexto).toBe('maior')

    // no padrão o <html> fica como era antes da preferência existir
    fireEvent.click(within(grupo).getByRole('radio', { name: /Padrão/ }))
    expect(raiz.style.getPropertyValue('--escala-texto')).toBe('')
    expect(raiz.hasAttribute('data-tamanho-texto')).toBe(false)
  })

  it('é navegável pelo teclado como um grupo de rádio de verdade', () => {
    render(<SecaoTamanhoTexto />)
    // rádios nativos com o mesmo `name`: as setas andam entre eles sozinhas
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(new Set(radios.map((r) => r.getAttribute('name'))).size).toBe(1)
  })
})
