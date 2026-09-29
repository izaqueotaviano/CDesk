import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabs, type Aba } from '@/stores/tabs'
import { ListaRecentes } from './ListaRecentes'

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

function ticket(id: number, ref: string, draft = ''): Aba {
  return { tipo: 'ticket', ticketId: id, resumo: resumo(id, ref), scroll: 0, draft }
}

/** Mostra a rota atual — é por ela que se confere para onde fechar levou. */
function Rota() {
  return <output data-testid="rota">{useLocation().pathname}</output>
}

function montar(abas: Aba[], rota = '/chamados/1') {
  useTabs.setState({ tabs: abas, active: null, reconciliando: false })
  return render(
    <MemoryRouter initialEntries={[rota]}>
      <ListaRecentes />
      <Routes>
        <Route path="*" element={<Rota />} />
      </Routes>
    </MemoryRouter>,
  )
}

const rota = () => screen.getByTestId('rota').textContent

/** O × de cada linha. Não dá para achar por papel e nome: fora do hover e
 *  sem ser o ticket atual ele está em display:none (lista-recentes.scss, e o
 *  jsdom não simula :hover), e um nó oculto tem nome acessível vazio. */
function fecharDe(rotulo: string) {
  const botao = document.querySelector<HTMLButtonElement>(`button[aria-label="${rotulo}"]`)
  if (!botao) throw new Error(`sem botão "${rotulo}"`)
  return botao
}
const idsNoStore = () => useTabs.getState().tabs.flatMap((a) => (a.tipo === 'ticket' ? [a.ticketId] : []))

let confirmar: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
})

describe('ListaRecentes — o que aparece', () => {
  it('sem ticket aberto não renderiza nada — nem o título da seção', () => {
    montar([{ tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' }], '/clientes')
    expect(screen.queryByText('Recentes')).not.toBeInTheDocument()
  })

  it('mostra só os tickets, pelo assunto; abas de seção herdadas ficam de fora', () => {
    montar([
      ticket(1, '#1001'),
      { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
      ticket(2, '#1002'),
    ])
    const lista = screen.getByRole('region', { name: 'Recentes' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lista).getByText('Assunto #1001')).toBeInTheDocument()
    expect(within(lista).queryByText('Clientes')).not.toBeInTheDocument()
  })

  it('o ticket da URL é o atual (aria-current), e o nome acessível leva a referência', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002')], '/chamados/2')
    expect(screen.getByRole('button', { name: '#1002 · Assunto #1002' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '#1001 · Assunto #1001' })).not.toHaveAttribute('aria-current')
  })

  it('rascunho não enviado entra no nome acessível; espaço em branco não conta', () => {
    montar([ticket(1, '#1001', 'metade da resposta'), ticket(2, '#1002', '   ')])
    expect(screen.getByRole('button', { name: '#1001 · Assunto #1001 (rascunho não enviado)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '#1002 · Assunto #1002' })).toBeInTheDocument()
  })

  it('clicar abre o ticket', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002')])
    fireEvent.click(screen.getByRole('button', { name: '#1002 · Assunto #1002' }))
    expect(rota()).toBe('/chamados/2')
  })
})

describe('ListaRecentes — fechar', () => {
  it('pergunta antes de fechar um ticket com rascunho e não fecha quando a pessoa desiste', () => {
    confirmar.mockReturnValue(false)
    montar([ticket(1, '#1001', 'já escrevi metade da resposta'), ticket(2, '#1002')])

    fireEvent.click(fecharDe('Fechar #1001'))

    expect(confirmar).toHaveBeenCalledWith(
      'O ticket #1001 tem um rascunho não enviado. Fechar descarta esse texto.',
    )
    expect(idsNoStore()).toEqual([1, 2])
  })

  it('fecha sem perguntar quando não há rascunho', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002')], '/chamados/2')
    fireEvent.click(fecharDe('Fechar #1001'))
    expect(confirmar).not.toHaveBeenCalled()
    expect(idsNoStore()).toEqual([2])
    // não era o da tela: a pessoa fica onde está
    expect(rota()).toBe('/chamados/2')
  })

  it('fechar o ticket da tela leva ao último que sobrou; fechar o último leva à lista', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002'), ticket(3, '#1003')], '/chamados/3')

    fireEvent.click(fecharDe('Fechar #1003'))
    expect(rota()).toBe('/chamados/2')

    fireEvent.click(fecharDe('Fechar #1002'))
    fireEvent.click(fecharDe('Fechar #1001'))
    expect(rota()).toBe('/chamados')
    expect(idsNoStore()).toEqual([])
  })

  it('Delete com o item focado fecha, e o clique do meio também', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002'), ticket(3, '#1003')], '/chamados/3')

    fireEvent.keyDown(screen.getByRole('button', { name: '#1001 · Assunto #1001' }), { key: 'Delete' })
    expect(idsNoStore()).toEqual([2, 3])

    fireEvent(
      screen.getByRole('button', { name: '#1002 · Assunto #1002' }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    )
    expect(idsNoStore()).toEqual([3])
  })

  it('o × fica fora do Tab — o atalho é o Delete, anunciado no nome', () => {
    montar([ticket(1, '#1001')])
    expect(fecharDe('Fechar #1001')).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('button', { name: '#1001 · Assunto #1001' })).toHaveAttribute('aria-keyshortcuts', 'Delete')
  })
})

describe('ListaRecentes — teclado', () => {
  it('só um item entra na ordem de tabulação: o ticket da tela', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002'), ticket(3, '#1003')], '/chamados/2')
    const [a, b, c] = within(screen.getByRole('list')).getAllByRole('button', { name: /· Assunto/ })
    expect([a, b, c].map((el) => el!.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('setas movem o foco sem navegar, dando a volta nas pontas', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002')], '/chamados/1')
    const primeiro = screen.getByRole('button', { name: '#1001 · Assunto #1001' })
    const segundo = screen.getByRole('button', { name: '#1002 · Assunto #1002' })

    primeiro.focus()
    fireEvent.keyDown(primeiro, { key: 'ArrowDown' })
    expect(segundo).toHaveFocus()
    fireEvent.keyDown(segundo, { key: 'ArrowDown' })
    expect(primeiro).toHaveFocus()
    fireEvent.keyDown(primeiro, { key: 'ArrowUp' })
    expect(segundo).toHaveFocus()
    expect(rota()).toBe('/chamados/1')
  })
})

describe('ListaRecentes — menu de contexto', () => {
  it('"Fechar os outros" deixa só o escolhido', () => {
    montar([ticket(1, '#1001'), ticket(2, '#1002'), ticket(3, '#1003')], '/chamados/1')
    fireEvent.contextMenu(screen.getByRole('button', { name: '#1002 · Assunto #1002' }), { clientX: 40, clientY: 80 })
    fireEvent.click(within(screen.getByRole('menu', { name: 'Ações do ticket' })).getByRole('menuitem', { name: /Fechar os outros/ }))

    expect(idsNoStore()).toEqual([2])
    // o da tela (1) fechou junto: vai para o que sobrou
    expect(rota()).toBe('/chamados/2')
  })

  it('em lote pergunta UMA vez pelo conjunto e desiste se a pessoa recusar', () => {
    confirmar.mockReturnValue(false)
    montar([ticket(1, '#1001', 'a'), ticket(2, '#1002', 'b'), ticket(3, '#1003')])
    fireEvent.contextMenu(screen.getByRole('button', { name: /#1003 · Assunto #1003/ }), { clientX: 40, clientY: 80 })
    fireEvent.click(screen.getByRole('menuitem', { name: /Fechar todos/ }))

    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(confirmar).toHaveBeenCalledWith('2 tickets têm rascunho não enviado. Fechar descarta esses textos.')
    expect(idsNoStore()).toEqual([1, 2, 3])
  })

  it('com um ticket só, "Fechar os outros" vem desabilitado', () => {
    montar([ticket(1, '#1001')])
    fireEvent.contextMenu(screen.getByRole('button', { name: '#1001 · Assunto #1001' }), { clientX: 40, clientY: 80 })
    expect(screen.getByRole('menuitem', { name: /Fechar os outros/ })).toHaveAttribute('aria-disabled', 'true')
  })
})
