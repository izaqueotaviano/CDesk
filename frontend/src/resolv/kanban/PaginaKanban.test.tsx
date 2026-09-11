import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaKanban } from './PaginaKanban'

const QUADRO = {
  columns: [
    { key: 'new', name: 'Novo', color: '#888', category: 'new', kind: 'stage', stage: 1, lane: null, concludes: false },
    { key: 'lane-9', name: 'Prioridade alta', color: '#888', category: null, kind: 'lane', stage: null, lane: 9, concludes: false },
  ],
  entries: [],
}

let chamadas: { url: string; metodo: string }[]
let respostaDeApagarLane: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/kanban/boards/') return Promise.resolve(jsonDe([{ id: 1, name: 'Suporte', slug: 'suporte', team: null, team_slug: null, is_active: true }]))
      if (u.pathname === '/api/v1/kanban/boards/1/cards/') return Promise.resolve(jsonDe(QUADRO))
      if (u.pathname === '/api/v1/kanban/lanes/9/' && metodo === 'DELETE') return Promise.resolve(respostaDeApagarLane())
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PaginaKanban />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaKanban — feedback de erro', () => {
  it('apagar coluna que falha mostra um aviso dispensável, em vez de falhar em silêncio', async () => {
    respostaDeApagarLane = () => jsonDe({ detail: 'Esta coluna tem chamados fixados nela.' }, 400)
    montar()
    const apagar = await screen.findByRole('button', { name: 'Apagar coluna Prioridade alta' })
    fireEvent.click(apagar)
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta coluna tem chamados fixados nela.')

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('apagar com sucesso não deixa aviso nenhum', async () => {
    respostaDeApagarLane = () => new Response(null, { status: 204 })
    montar()
    const apagar = await screen.findByRole('button', { name: 'Apagar coluna Prioridade alta' })
    fireEvent.click(apagar)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/kanban/lanes/9/' && c.metodo === 'DELETE')).toBe(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
