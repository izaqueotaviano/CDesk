import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
afterEach(() => vi.unstubAllGlobals())

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
