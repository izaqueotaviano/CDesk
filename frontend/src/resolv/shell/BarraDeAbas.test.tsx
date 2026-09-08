import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTabs } from '@/stores/tabs'
import { BarraDeAbas } from './BarraDeAbas'

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

/** `draft` só existe do lado do cliente — é o que o "· rascunho" mostra. A
 *  rota inicial é sempre a do ticket ATIVO: quem decide qual aba acende é a
 *  URL (comentário em BarraDeAbas.tsx), não mais uma prop. */
function montar(abas: { id: number; ref: string; draft: string }[], ativo = 1) {
  useTabs.setState({
    tabs: abas.map((a) => ({
      tipo: 'ticket' as const,
      ticketId: a.id,
      resumo: resumo(a.id, a.ref),
      scroll: 0,
      draft: a.draft,
    })),
    active: `ticket:${ativo}`,
    reconciliando: false,
  })
  return render(
    <MemoryRouter initialEntries={[`/chamados/${ativo}`]}>
      <Routes>
        <Route path="/chamados/:id" element={<BarraDeAbas />} />
        <Route path="/chamados" element={<BarraDeAbas />} />
        <Route path="/inicio" element={<p>início</p>} />
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

describe('BarraDeAbas — abas de ticket', () => {
  it('pergunta antes de fechar uma aba com rascunho e não fecha quando a pessoa desiste', () => {
    confirmar.mockReturnValue(false)
    montar([
      { id: 1, ref: '#1001', draft: 'já escrevi metade da resposta' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Empresa #1001' }))

    expect(confirmar).toHaveBeenCalledWith(
      'A aba #1001 tem um rascunho não enviado. Fechar descarta esse texto.',
    )
    expect(screen.getByText('#1001')).toBeInTheDocument()
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([1, 2])
    // o rascunho continua inteiro para quem voltar à aba
    const primeira = useTabs.getState().tabs[0]
    expect(primeira?.tipo === 'ticket' && primeira.draft).toBe('já escrevi metade da resposta')
  })

  it('fecha a aba com rascunho quando a pessoa confirma', () => {
    montar([
      { id: 1, ref: '#1001', draft: 'texto não enviado' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Empresa #1001' }))

    expect(confirmar).toHaveBeenCalledOnce()
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([2])
  })

  it('fecha aba sem rascunho na hora, sem perguntar nada', () => {
    montar([
      { id: 1, ref: '#1001', draft: '' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Empresa #1001' }))

    expect(confirmar).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([2])
  })

  it('espaço em branco não conta como rascunho — nem no rótulo, nem na pergunta', () => {
    montar([{ id: 1, ref: '#1001', draft: '   \n ' }])

    expect(screen.queryByText('· rascunho')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aba Empresa #1001' }))

    expect(confirmar).not.toHaveBeenCalled()
    expect(useTabs.getState().tabs).toEqual([])
  })
})

describe('BarraDeAbas — abas operáveis por teclado, padrão WAI-ARIA', () => {
  it('só a aba ativa entra na ordem de tabulação (tabIndex 0); as outras ficam -1', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
        { id: 3, ref: '#1003', draft: '' },
      ],
      2,
    )

    // A primeira aba é sempre a Início (fixa) — daí quatro no total.
    const abas = screen.getAllByRole('tab')
    expect(abas.map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1'])
    expect(abas[2]).toHaveAttribute('aria-selected', 'true')
  })

  it('seta direita move o FOCO para a próxima aba sem navegar (ativação manual)', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
      ],
      1,
    )

    // [0] é a Início; as abas de ticket vêm depois dela.
    const [, aba1, aba2] = screen.getAllByRole('tab')
    aba1!.focus()
    fireEvent.keyDown(aba1!, { key: 'ArrowRight' })

    expect(aba2).toHaveFocus()
    expect(aba2).toHaveAttribute('tabindex', '0')
    expect(aba1).toHaveAttribute('tabindex', '-1')
    // Só moveu o foco — não ativou a aba nem trocou de rota.
    expect(useTabs.getState().active).toBe('ticket:1')
  })

  it('seta esquerda na primeira aba (Início) dá a volta para a última (wrap-around)', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
        { id: 3, ref: '#1003', draft: '' },
      ],
      1,
    )

    const abas = screen.getAllByRole('tab')
    abas[0]!.focus()
    fireEvent.keyDown(abas[0]!, { key: 'ArrowLeft' })

    expect(abas[3]).toHaveFocus()
  })

  it('o botão de fechar é irmão do role="tab", nunca filho dele', () => {
    montar([{ id: 1, ref: '#1001', draft: '' }])

    const aba = screen.getAllByRole('tab')[1]!
    const fechar = screen.getByRole('button', { name: 'Fechar aba Empresa #1001' })

    expect(aba.contains(fechar)).toBe(false)
    expect(aba.parentElement).toBe(fechar.parentElement)
  })
})

describe('BarraDeAbas — aba fixa do Início e atalho de novo ticket', () => {
  it('a Início é sempre a primeira aba, mesmo sem nenhuma outra aberta', () => {
    render(
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<BarraDeAbas />} />
        </Routes>
      </MemoryRouter>,
    )

    const abas = screen.getAllByRole('tab')
    expect(abas).toHaveLength(1)
    expect(abas[0]).toHaveAccessibleName(/Início/)
    expect(abas[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('a Início não tem botão de fechar — é o destino de fallback das outras', () => {
    montar([{ id: 1, ref: '#1001', draft: '' }])

    expect(screen.getByRole('button', { name: 'Fechar aba Empresa #1001' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fechar aba Início' })).not.toBeInTheDocument()
  })

  it('o "+" no fim da barra abre a tela de novo ticket', () => {
    render(
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<BarraDeAbas />} />
          <Route path="/chamados/novo" element={<p>abertura de chamado</p>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Abrir novo ticket' }))

    expect(screen.getByText('abertura de chamado')).toBeInTheDocument()
  })
})

describe('BarraDeAbas — abas de seção', () => {
  it('abre uma aba de seção ao navegar para uma rota da Sidebar, e não duplica ao voltar', () => {
    render(
      <MemoryRouter initialEntries={['/clientes']}>
        <Routes>
          <Route path="/clientes" element={<BarraDeAbas />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('tab', { name: /Clientes/ })).toBeInTheDocument()
    expect(useTabs.getState().tabs).toHaveLength(1)
    expect(useTabs.getState().active).toBe('secao:/clientes')
  })

  it('ticket e seção convivem na mesma barra, cada um com sua própria aba', () => {
    useTabs.setState({
      tabs: [
        { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
        { tipo: 'ticket', ticketId: 7, resumo: resumo(7, '#1007'), scroll: 0, draft: '' },
      ],
      active: 'ticket:7',
      reconciliando: false,
    })

    render(
      <MemoryRouter initialEntries={['/chamados/7']}>
        <Routes>
          <Route path="/chamados/:id" element={<BarraDeAbas />} />
        </Routes>
      </MemoryRouter>,
    )

    // Início + a seção + o ticket.
    const abas = screen.getAllByRole('tab')
    expect(abas).toHaveLength(3)
    expect(screen.getByRole('tab', { name: /Clientes/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: /#1007/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('BarraDeAbas — atalhos de navegador: clique do meio, Delete, menu de contexto', () => {
  it('clique do meio fecha a aba, como no navegador', () => {
    montar([
      { id: 1, ref: '#1001', draft: '' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    // A testing-library não tem atalho pra `auxclick`; é o evento nativo que
    // o navegador dispara no botão do meio (button 1).
    fireEvent(screen.getByRole('tab', { name: /#1002/ }), new MouseEvent('auxclick', { button: 1, bubbles: true }))

    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([1])
  })

  it('Delete com a aba focada fecha; na Início não faz nada', () => {
    montar([
      { id: 1, ref: '#1001', draft: '' },
      { id: 2, ref: '#1002', draft: '' },
    ])

    fireEvent.keyDown(screen.getByRole('tab', { name: /#1002/ }), { key: 'Delete' })
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([1])

    fireEvent.keyDown(screen.getByRole('tab', { name: /Início/ }), { key: 'Delete' })
    expect(useTabs.getState().tabs).toHaveLength(1)
  })

  it('botão direito abre o menu de contexto; "fechar as outras" deixa só a escolhida', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
        { id: 3, ref: '#1003', draft: '' },
      ],
      2,
    )

    fireEvent.contextMenu(screen.getByRole('tab', { name: /#1002/ }))
    const menu = screen.getByRole('menu', { name: 'Ações da aba' })
    expect(menu).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar as outras abas' }))

    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([2])
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('"fechar as abas à direita" e "à esquerda" respeitam a posição; a Início nunca conta', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
        { id: 3, ref: '#1003', draft: '' },
      ],
      2,
    )

    fireEvent.contextMenu(screen.getByRole('tab', { name: /#1002/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar as abas à direita' }))
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([1, 2])

    fireEvent.contextMenu(screen.getByRole('tab', { name: /#1002/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar as abas à esquerda' }))
    expect(useTabs.getState().tabs.map((t) => (t.tipo === 'ticket' ? t.ticketId : null))).toEqual([2])

    // Só sobrou a própria: nada à esquerda (a Início não fecha), nada à direita.
    fireEvent.contextMenu(screen.getByRole('tab', { name: /#1002/ }))
    expect(screen.getByRole('menuitem', { name: 'Fechar as abas à esquerda' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Fechar as abas à direita' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Fechar as outras abas' })).toBeDisabled()
  })

  it('fechar em lote pergunta UMA vez pelo conjunto quando há rascunho, e desiste se a pessoa recusar', () => {
    confirmar.mockReturnValue(false)
    montar(
      [
        { id: 1, ref: '#1001', draft: 'meio escrito' },
        { id: 2, ref: '#1002', draft: '' },
        { id: 3, ref: '#1003', draft: 'outro rascunho' },
      ],
      2,
    )

    fireEvent.contextMenu(screen.getByRole('tab', { name: /#1002/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar as outras abas' }))

    expect(confirmar).toHaveBeenCalledOnce()
    expect(confirmar).toHaveBeenCalledWith('2 abas têm rascunho não enviado. Fechar descarta esses textos.')
    expect(useTabs.getState().tabs).toHaveLength(3)
  })
})

describe('BarraDeAbas — "+" com abertura rápida e "…" com fechar todas', () => {
  it('seta pra baixo no "+" abre a lista de seções; escolher uma navega pra ela', () => {
    render(
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<BarraDeAbas />} />
          <Route path="/clientes" element={<p>tela de clientes</p>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.keyDown(screen.getByRole('button', { name: 'Abrir novo ticket' }), { key: 'ArrowDown' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clientes' }))

    expect(screen.getByText('tela de clientes')).toBeInTheDocument()
  })

  it('"fechar todas as abas" no menu "…" esvazia o store e volta pro Início', () => {
    montar(
      [
        { id: 1, ref: '#1001', draft: '' },
        { id: 2, ref: '#1002', draft: '' },
      ],
      2,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações das abas' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fechar todas as abas' }))

    expect(useTabs.getState().tabs).toEqual([])
    expect(screen.getByText('início')).toBeInTheDocument()
  })

  it('sem nenhuma aba fechável, "fechar todas" fica desabilitado', () => {
    render(
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<BarraDeAbas />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações das abas' }))
    expect(screen.getByRole('menuitem', { name: 'Fechar todas as abas' })).toBeDisabled()
  })
})

describe('stores/tabs — reordenar', () => {
  it('aplica a nova ordem e manda pro fim o que a lista esqueceu', () => {
    useTabs.setState({
      tabs: [
        { tipo: 'ticket', ticketId: 1, resumo: resumo(1, '#1001'), scroll: 0, draft: '' },
        { tipo: 'secao', rota: '/clientes', titulo: 'Clientes', icone: 'ti ti-users' },
        { tipo: 'ticket', ticketId: 2, resumo: resumo(2, '#1002'), scroll: 0, draft: '' },
      ],
      active: 'ticket:1',
      reconciliando: false,
    })

    useTabs.getState().reordenar(['ticket:2', 'secao:/clientes', 'chave:inventada'])

    expect(useTabs.getState().tabs.map((a) => (a.tipo === 'ticket' ? a.ticketId : a.rota))).toEqual([2, '/clientes', 1])
    expect(useTabs.getState().active).toBe('ticket:1')
  })
})
