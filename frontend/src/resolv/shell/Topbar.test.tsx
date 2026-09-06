import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Topbar } from './Topbar'

const ME = { id: 2, full_name: 'Samuel Suporte', email: 'samuel@x.test', is_internal: true, is_admin: false, kind: 'internal', permissions: [] }

let chamadas: { url: string; metodo: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/auth/logout/') return Promise.resolve(new Response(null, { status: 204 }))
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [] }))
      return Promise.resolve(jsonDe([]))
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
          <Route path="/inicio" element={<Topbar />} />
          <Route path="/login" element={<p>tela de login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Topbar (equipe)', () => {
  it('tem um botão de Sair que desloga e manda para o login', async () => {
    montar()
    const sair = await screen.findByRole('button', { name: 'Sair' })
    fireEvent.click(sair)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/logout/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })
})
