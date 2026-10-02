import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaInicio } from './PaginaInicio'

const ME = { id: 4, full_name: 'Ana Almeida', email: 'ana@acme.test', company_name: 'Acme Marketing', is_internal: false, is_admin: false, teams: [], permissions: [] }

function jsonDe(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
const pagina = (count: number, results: unknown[] = []) => ({ count, next: null, previous: null, results })

let chatsPendentes: unknown[]

beforeEach(() => {
  chatsPendentes = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/chat/chats/pending-ratings/') return Promise.resolve(jsonDe(chatsPendentes))
      if (u.pathname === '/api/v1/tickets/pending-ratings/') return Promise.resolve(jsonDe([]))
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe(pagina(0)))
      if (u.pathname === '/api/v1/tickets/') {
        const status = u.searchParams.get('status')
        return Promise.resolve(jsonDe(pagina(status === 'pending_customer' ? 3 : status === 'open' ? 2 : 0)))
      }
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal']}>
        <PaginaInicio />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaInicio (cliente)', () => {
  it('cumprimenta pelo primeiro nome e soma os cartões a partir dos recortes', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Olá, Ana' })).toBeInTheDocument()
    const aguardandoVoce = await screen.findByRole('link', { name: /Aguardando seu retorno/ })
    expect(aguardandoVoce).toHaveTextContent('3')
    // "Aguardando suporte" = novos (0) + em andamento (2)
    expect(screen.getByRole('link', { name: /Aguardando suporte/ })).toHaveTextContent('2')
    // o atalho do topo e o do vazio de "Conversas recentes" — nenhum travado
    expect(screen.getAllByRole('link', { name: /Iniciar chat/ }).length).toBeGreaterThan(0)
  })

  it('avaliação de chat pendente: alerta em destaque e "Iniciar chat" travado', async () => {
    chatsPendentes = [{ id: 9, status: 'closed', rating_pending: true, agent_name: 'Fátima' }]
    montar()
    expect(await screen.findByText('Você tem uma avaliação de chat pendente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Iniciar chat/ })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Avaliar agora' })).toHaveAttribute('href', '/portal/chat')
  })
})
