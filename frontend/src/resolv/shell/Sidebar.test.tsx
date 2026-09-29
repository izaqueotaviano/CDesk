import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { useTabs } from '@/stores/tabs'
import { Sidebar } from './Sidebar'

// Recentes lê o store de abas, que importa o espelho no servidor — aqui ele
// não entra (docs/06-abas-frontend.md).
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(() => new Promise(() => {})),
  putTabsServidor: vi.fn(() => new Promise(() => {})),
}))

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// A Sidebar monta `useMe`, o chat (fila/meus, para o selo) e a presença de
// verdade, daí o stub de fetch.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/auth/me/') {
        return Promise.resolve(
          jsonDe({
            id: 1,
            full_name: 'Alice Admin',
            email: 'alice@x.test',
            kind: 'internal',
            is_internal: true,
            is_admin: true,
            permissions: [],
            presence: 'available',
          }),
        )
      }
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe([]))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  // A preferência é um singleton de módulo persistido: sem devolver ao padrão,
  // a barra recolhida num teste vaza para o seguinte.
  usePrefs.setState({ sidebarRecolhida: false })
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
})

function montar(rota = '/inicio', onAbrirBusca = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Sidebar onAbrirBusca={onAbrirBusca} />
        <Routes>
          <Route path="*" element={<Rota />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function Rota() {
  return <output data-testid="rota">{useLocation().pathname}</output>
}
const rota = () => screen.getByTestId('rota').textContent

function abrirMais() {
  fireEvent.click(screen.getByRole('button', { name: /^Mais/ }))
  return screen.getByRole('menu', { name: 'Mais seções' })
}

describe('Sidebar — navegação principal', () => {
  it('"Novo ticket" é a ação primária e abre a tela de novo ticket', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Novo ticket' }))
    expect(rota()).toBe('/chamados/novo')
  })

  it('os destinos do dia a dia ficam na coluna: "Clientes" leva pra /clientes', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Clientes' }))
    expect(rota()).toBe('/clientes')
  })

  it('clicar em "Buscar" chama o gatilho recebido por prop, não abre o próprio painel', () => {
    const abrirBusca = vi.fn()
    montar('/inicio', abrirBusca)
    fireEvent.click(screen.getByRole('button', { name: 'Buscar e navegar' }))
    expect(abrirBusca).toHaveBeenCalledOnce()
  })

  it('o item da tela atual é o único com aria-current', () => {
    montar('/clientes')
    expect(screen.getByRole('button', { name: 'Clientes' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar — menu "Mais"', () => {
  it('guarda os destinos secundários, fora da coluna', () => {
    montar()
    expect(screen.queryByRole('button', { name: 'Configurações' })).not.toBeInTheDocument()
    const menu = abrirMais()
    for (const nome of ['Avisos', 'Notas', 'Relatórios', 'Auditoria e LGPD', 'Configurações']) {
      expect(within(menu).getByRole('menuitem', { name: nome })).toBeInTheDocument()
    }
  })

  it('"Configurações" leva pra /configuracoes', () => {
    montar()
    fireEvent.click(within(abrirMais()).getByRole('menuitem', { name: 'Configurações' }))
    expect(rota()).toBe('/configuracoes')
  })

  it('"Calendário" continua inerte — sem rota real ainda', () => {
    montar()
    expect(within(abrirMais()).getByRole('menuitem', { name: /Calendário/ })).toHaveAttribute('aria-disabled', 'true')
  })

  it('numa tela secundária, "Mais" acende e diz onde a pessoa está', () => {
    montar('/notas')
    expect(screen.getByRole('button', { name: 'Mais — você está em Notas' })).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('Sidebar — um estado ativo por vez', () => {
  const abrirTicket = () =>
    useTabs.setState({
      tabs: [{ tipo: 'ticket', ticketId: 5, resumo: { id: 5, reference: '#1005', subject: 'Impressora', status: 'open', requester_display: 'Beto' }, scroll: 0, draft: '' }],
      active: 'ticket:5',
      reconciliando: false,
    })

  it('com o ticket em Recentes, é ele que acende — "Tickets" não', () => {
    abrirTicket()
    montar('/chamados/5')
    expect(screen.getByRole('button', { name: '#1005 · Impressora' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Tickets' })).not.toHaveAttribute('aria-current')
  })

  it('recolhida, Recentes some e quem acende no ticket é "Tickets"', () => {
    abrirTicket()
    usePrefs.setState({ sidebarRecolhida: true })
    montar('/chamados/5')
    expect(screen.queryByRole('region', { name: 'Recentes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tickets' })).toHaveAttribute('aria-current', 'page')
  })

  it('na tela de novo ticket acende "Novo ticket", não "Tickets"', () => {
    montar('/chamados/novo')
    expect(screen.getByRole('button', { name: 'Novo ticket' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Tickets' })).not.toHaveAttribute('aria-current')
  })
})

describe('Sidebar — recolher, e o selo de conversas', () => {
  it('recolhe e expande, guardando a escolha na preferência do app', () => {
    const { container } = montar()

    const barra = container.querySelector('.sidebar-rail')!
    expect(barra).not.toHaveClass('sidebar-rail--recolhida')

    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }))

    expect(barra).toHaveClass('sidebar-rail--recolhida')
    expect(usePrefs.getState().sidebarRecolhida).toBe(true)
    // O botão passa a oferecer a volta — rótulo de AÇÃO, não de estado.
    fireEvent.click(screen.getByRole('button', { name: 'Expandir menu' }))
    expect(barra).not.toHaveClass('sidebar-rail--recolhida')
  })

  it('recolhida, os itens continuam nomeados e a marca sai do topo', () => {
    usePrefs.setState({ sidebarRecolhida: true })
    montar()

    // O rótulo visível some no CSS, mas o nome acessível não depende dele:
    // é o `aria-label` do botão que responde por ele nos dois estados.
    expect(screen.getByRole('button', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Novo ticket' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ir para o Início/ })).not.toBeInTheDocument()
  })

  it('o selo de conversas some quando a fila e os atendimentos estão vazios', async () => {
    montar()
    expect(await screen.findByRole('button', { name: 'Chats' })).toBeInTheDocument()
  })

  it('mostra o selo de conversas no ícone de Chats quando há fila ou atendimento', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = new URL(String(url), 'http://x')
        if (u.pathname === '/api/v1/auth/me/') {
          return Promise.resolve(
            jsonDe({
              id: 1,
              full_name: 'Alice Admin',
              kind: 'internal',
              is_internal: true,
              is_admin: true,
              permissions: [],
              presence: 'available',
            }),
          )
        }
        if (u.pathname === '/api/v1/chat/chats/') {
          const status = u.searchParams.get('status')
          return Promise.resolve(jsonDe(status === 'queued' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }]))
        }
        return Promise.resolve(jsonDe({}, 404))
      }),
    )
    montar()

    // 2 na fila + 1 em atendimento = 3
    expect(await screen.findByRole('button', { name: /Chats — 3 conversas/ })).toBeInTheDocument()
  })
})

describe('Sidebar — gaveta em tela pequena', () => {
  it('aberta, é um diálogo modal com o foco no botão de fechar; Esc fecha', () => {
    const onFechar = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/inicio']}>
          <Sidebar onAbrirBusca={vi.fn()} gaveta={{ aberta: true, onFechar }} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const gaveta = screen.getByRole('dialog', { name: 'Navegação principal' })
    expect(gaveta).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toHaveFocus()
    // Na gaveta não existe "recolher": ela abre sempre inteira.
    expect(screen.queryByRole('button', { name: 'Recolher menu' })).not.toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onFechar).toHaveBeenCalledOnce()
  })

  it('fechada, some da árvore acessível (está fora da tela)', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/inicio']}>
          <Sidebar onAbrirBusca={vi.fn()} gaveta={{ aberta: false, onFechar: vi.fn() }} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(container.querySelector('.sidebar-rail')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a preferência "recolhida" não vale na gaveta — ela abre com os rótulos', () => {
    usePrefs.setState({ sidebarRecolhida: true })
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/inicio']}>
          <Sidebar onAbrirBusca={vi.fn()} gaveta={{ aberta: true, onFechar: vi.fn() }} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(container.querySelector('.sidebar-rail')).not.toHaveClass('sidebar-rail--recolhida')
  })
})
