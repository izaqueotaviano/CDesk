import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { Sidebar } from './Sidebar'

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

// A Sidebar ganhou a zona utilitária na Fase 2 (busca, notificações, tema,
// presença) — monta `useMe`, chat (fila/meus) e notificações de verdade, daí
// o stub de fetch que os testes anteriores (só navegação) não precisavam.
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
      if (u.pathname === '/api/v1/notifications/') return Promise.resolve(jsonDe({ results: [], unread_count: 0 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  // A preferência é um singleton de módulo persistido: sem devolver ao padrão,
  // a barra recolhida num teste vaza para o seguinte.
  usePrefs.setState({ sidebarRecolhida: false })
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<Sidebar onAbrirBusca={vi.fn()} />} />
          <Route path="/clientes" element={<p>tela de clientes</p>} />
          <Route path="/configuracoes" element={<p>tela de configurações</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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

describe('Sidebar — zona utilitária (Fase 2: absorveu a Topbar)', () => {
  it('clicar em "Buscar" chama o gatilho recebido por prop, não abre o próprio painel', () => {
    const abrirBusca = vi.fn()
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/inicio']}>
          <Sidebar onAbrirBusca={abrirBusca} />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Buscar e navegar' }))
    expect(abrirBusca).toHaveBeenCalledOnce()
  })

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

  it('recolhida, os itens continuam nomeados para o teclado e o leitor de tela', () => {
    usePrefs.setState({ sidebarRecolhida: true })
    montar()

    // O rótulo visível some no CSS, mas o nome acessível não depende dele:
    // é o `aria-label` do botão que responde por ele nos dois estados.
    expect(screen.getByRole('button', { name: 'Clientes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurações' })).toBeInTheDocument()
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
        if (u.pathname === '/api/v1/notifications/') return Promise.resolve(jsonDe({ results: [], unread_count: 0 }))
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
