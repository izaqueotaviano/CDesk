import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversaContinua } from './ConversaContinua'

function msg(id: number, chat_id: number, extra: Record<string, unknown> = {}) {
  return {
    id, chat_id, author_name: 'Ana', author_is_internal: false, body: `mensagem ${id}`,
    is_system: false, sent_at: '2026-09-01T10:00:00Z', read_at: null, files: [],
    edited_at: null, is_deleted: false, can_edit: false, ...extra,
  }
}

function sessao(id: number, extra: Record<string, unknown> = {}) {
  return { id, status: 'closed', queued_at: '2026-09-01T09:00:00Z', closed_at: '2026-09-01T10:05:00Z', agent_name: 'Samuel', rating: null, ...extra }
}

let paginas: Record<string, { messages: unknown[]; sessions: unknown[]; has_more: boolean }>
let chamadas: { url: string; search: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  paginas = {
    inicial: { messages: [msg(2, 10), msg(3, 10)], sessions: [sessao(10)], has_more: true },
    antiga: { messages: [msg(1, 9, { body: 'oi antigo' })], sessions: [sessao(9, { id: 9, agent_name: 'Fátima' })], has_more: false },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/chat/timeline/') {
        const before = u.searchParams.get('before')
        return Promise.resolve(jsonDe(before ? paginas.antiga : paginas.inicial))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ConversaContinua />
    </QueryClientProvider>,
  )
}

describe('ConversaContinua', () => {
  it('mostra as mensagens e o marcador da sessão', async () => {
    montar()
    expect(await screen.findByText('mensagem 2')).toBeInTheDocument()
    expect(screen.getByText('mensagem 3')).toBeInTheDocument()
    expect(screen.getByText(/Atendimento com Samuel/)).toBeInTheDocument()
  })

  it('"Carregar conversas anteriores" busca a página antes da mensagem mais antiga carregada', async () => {
    montar()
    await screen.findByText('mensagem 2')
    fireEvent.click(screen.getByRole('button', { name: 'Carregar conversas anteriores' }))
    await waitFor(() => expect(chamadas.some((c) => c.search.includes('before=2'))).toBe(true))
    expect(await screen.findByText('oi antigo')).toBeInTheDocument()
    // depois de carregar tudo (has_more:false na página antiga), o botão some
    expect(screen.queryByRole('button', { name: 'Carregar conversas anteriores' })).not.toBeInTheDocument()
  })

  it('buscar reinicia a paginação com q= na chamada', async () => {
    montar()
    await screen.findByText('mensagem 2')
    fireEvent.change(screen.getByLabelText('Buscar nas mensagens'), { target: { value: 'reembolso' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(chamadas.some((c) => c.search.includes('q=reembolso'))).toBe(true))
  })

  it('o link de PDF aponta para o endpoint de export', async () => {
    montar()
    await screen.findByText('mensagem 2')
    const link = screen.getByRole('link', { name: /PDF/ })
    expect(link).toHaveAttribute('href', '/api/v1/chat/timeline/export/')
  })

  it('sem mensagens, mostra o vazio', async () => {
    paginas.inicial = { messages: [], sessions: [], has_more: false }
    montar()
    expect(await screen.findByText('Nada por aqui ainda')).toBeInTheDocument()
  })
})
