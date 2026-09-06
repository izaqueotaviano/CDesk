import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabs } from '@/stores/tabs'
import { TicketTabs } from './TicketTabs'

// O espelho no servidor é irrelevante aqui (e `fechar` o agenda com 2s de
// folga): a aba é local e síncrona por contrato — docs/06-abas-frontend.md.
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(() => new Promise(() => {})),
  putTabsServidor: vi.fn(() => new Promise(() => {})),
}))

function resumo(id: number, ref: string) {
  return {
    id,
    reference: ref,
    subject: `Assunto ${ref}`,
    status: 'open',
    requester_display: 'Beto Barros',
    company_name: `Empresa ${ref}`,
  }
}

/** `draft` só existe do lado do cliente — é o que o "· rascunho" mostra. */
function montar(abas: { id: number; ref: string; draft: string }[], ativo = 1) {
  useTabs.setState({
    tabs: abas.map((a) => ({
      ticketId: a.id,
      resumo: resumo(a.id, a.ref),
      scroll: 0,
      draft: a.draft,
    })),
    active: ativo,
    reconciliando: false,
  })
  return render(
    <MemoryRouter initialEntries={[`/chamados/${ativo}`]}>
      <Routes>
        <Route path="/chamados/:id" element={<TicketTabs idAtivo={ativo} />} />
        <Route path="/chamados" element={<p>lista de chamados</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

let confirmar: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
})

describe('TicketTabs', () => {
  it('pergunta antes de fechar uma aba com rascunho e não fecha quando a pessoa desiste', () => {
    confirmar.mockReturnValue(false)
    montar([
      { id: 1, ref: '#1001', draft: 'já escrevi metade da resposta' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba #1001' }))

    expect(confirmar).toHaveBeenCalledWith(
      'A aba #1001 tem um rascunho não enviado. Fechar descarta esse texto.',
    )
    expect(screen.getByText('#1001')).toBeInTheDocument()
    expect(useTabs.getState().tabs.map((t) => t.ticketId)).toEqual([1, 2])
    // o rascunho continua inteiro para quem voltar à aba
    expect(useTabs.getState().tabs[0].draft).toBe('já escrevi metade da resposta')
  })

  it('fecha a aba com rascunho quando a pessoa confirma', () => {
    montar([
      { id: 1, ref: '#1001', draft: 'texto não enviado' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba #1001' }))

    expect(confirmar).toHaveBeenCalledOnce()
    expect(useTabs.getState().tabs.map((t) => t.ticketId)).toEqual([2])
  })

  it('fecha aba sem rascunho na hora, sem perguntar nada', () => {
    montar([
      { id: 1, ref: '#1001', draft: '' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba #1001' }))

    expect(confirmar).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs.map((t) => t.ticketId)).toEqual([2])
  })

  it('espaço em branco não conta como rascunho — nem no rótulo, nem na pergunta', () => {
    montar([{ id: 1, ref: '#1001', draft: '   \n ' }])

    expect(screen.queryByText('· rascunho')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba #1001' }))

    expect(confirmar).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs).toEqual([])
  })
})
