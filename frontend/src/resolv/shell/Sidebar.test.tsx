import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'

function montar() {
  return render(
    <MemoryRouter initialEntries={['/inicio']}>
      <Routes>
        <Route path="/inicio" element={<Sidebar />} />
        <Route path="/clientes" element={<p>tela de clientes</p>} />
        <Route path="/configuracoes" element={<p>tela de configurações</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Sidebar — links que antes eram mortos', () => {
  it('"Clientes" leva pra /clientes, não pro /empresas inexistente', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Clientes' }))
    expect(screen.getByText('tela de clientes')).toBeInTheDocument()
  })

  it('"Configurações" leva pra /configuracoes, não pro /admin inexistente', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(screen.getByText('tela de configurações')).toBeInTheDocument()
  })

  it('os dois não ficam mais marcados como inertes', () => {
    montar()
    expect(screen.getByRole('button', { name: 'Clientes' })).not.toHaveAttribute('aria-disabled')
    expect(screen.getByRole('button', { name: 'Configurações' })).not.toHaveAttribute('aria-disabled')
  })
})
