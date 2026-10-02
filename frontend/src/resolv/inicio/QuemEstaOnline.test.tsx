import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuemEstaOnline } from './QuemEstaOnline'

const AGENTES = [
  { id: 1, full_name: 'Alice Admin', email: 'alice@x.test', kind: 'internal', internal_role: 'admin', company: null, presence: 'available' },
  { id: 2, full_name: 'Samuel Suporte', email: 'samuel@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'away' },
  { id: 3, full_name: 'Fátima Financeiro', email: 'fatima@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'offline' },
]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe(AGENTES))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <QuemEstaOnline />
    </QueryClientProvider>,
  )
}

describe('QuemEstaOnline', () => {
  it('mostra disponível e ausente, mas não offline', async () => {
    montar()
    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Samuel')).toBeInTheDocument()
    expect(screen.queryByText('Fátima')).not.toBeInTheDocument()
  })

  it('o contador reflete só quem está online', async () => {
    montar()
    await screen.findByText('Alice')
    expect(screen.getByText('2')).toBeInTheDocument()
  })
})
