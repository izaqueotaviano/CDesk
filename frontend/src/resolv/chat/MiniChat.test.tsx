import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatUi } from '@/stores/chatUi'
import { MiniChat } from './MiniChat'

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({ status: 'aberto', digitando: null, erro: null, enviarMensagem: vi.fn(), enviarDigitando: vi.fn() }),
}))

const AGENTE = { id: 3, full_name: 'Samuel Suporte', email: 's@x.test', is_internal: true, is_admin: false, kind: 'internal', permissions: [], presence: 'available' }
const CLIENTE = { id: 4, full_name: 'Ana', email: 'ana@acme.test', is_internal: false, is_admin: false, kind: 'client', permissions: [] }

function chat(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, status: 'active', name: '', client_id: 4, client_name: 'Ana Cliente', client_email: 'ana@acme.test', client_phone: '',
    client_avatar: null, company_name: 'Acme', agent_name: 'Samuel Suporte', agent_id: 3, agent_avatar: null, category: null,
    category_name: null, priority: 'normal', assignee: null, assignee_name: null, tag_ids: [], queued_at: '2026-09-01T10:00:00Z',
    accepted_at: '2026-09-01T10:01:00Z', closed_at: null, reopen_count: 0, timeout_converted: false, unread_count: 0,
    last_message_preview: 'oi', rating: null, rating_pending: false, ticket_id: null, ticket_reference: null, ws_url: '', ...extra,
  }
}

const MENSAGENS = [
  { id: 1, author_name: 'Ana Cliente', author_is_internal: false, body: 'oi, preciso de ajuda', is_system: false, sent_at: '2026-09-01T10:02:00Z', read_at: null, files: [], edited_at: null, is_deleted: false, can_edit: false },
]

let me: Record<string, unknown>
let meus: unknown[]
let fila: unknown[]
let chamadas: { url: string; search: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  useChatUi.setState({ abertos: [] })
  me = AGENTE
  meus = [chat(5), chat(6, { client_name: 'Bruno Cliente', company_name: 'Beta', unread_count: 2 })]
  fila = []
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/chat/config/') return Promise.resolve(jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: true, queue_opens_at: null, max_chats_per_agent: 3 }))
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('mine') === '1') return Promise.resolve(jsonDe(pagina(meus)))
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('status') === 'queued') return Promise.resolve(jsonDe(pagina(fila)))
      if (/\/api\/v1\/chat\/chats\/\d+\/$/.test(u.pathname)) {
        const id = Number(u.pathname.split('/').filter(Boolean).pop())
        return Promise.resolve(jsonDe((meus as { id: number }[]).find((c) => c.id === id) ?? chat(id)))
      }
      if (/\/messages\/$/.test(u.pathname)) return Promise.resolve(jsonDe(MENSAGENS))
      if (/\/mark-read\/$/.test(u.pathname) || /\/read\/$/.test(u.pathname)) return Promise.resolve(jsonDe({}))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/inicio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/inicio" element={<MiniChat />} />
          <Route path="/chat" element={<MiniChat />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MiniChat', () => {
  it('lista os atendimentos do agente como abas, com contador e badge de não lidas', async () => {
    montar()
    expect(await screen.findByRole('toolbar', { name: 'Meus atendimentos' })).toBeInTheDocument()
    expect(screen.getByText('2/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir conversa com Ana Cliente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir conversa com Bruno Cliente' })).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('clicar numa aba abre o painel com a conversa inteira e o compositor; minimizar fecha', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    const painel = await screen.findByRole('region', { name: 'Conversa com Ana Cliente' })
    expect(painel).toBeInTheDocument()
    expect(await screen.findByText('oi, preciso de ajuda')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Escreva para o cliente/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar conversa com Ana Cliente' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Conversa com Ana Cliente' })).not.toBeInTheDocument())
  })

  it('o painel some sozinho quando o chat deixa de ser meu (encerrado/transferido)', async () => {
    useChatUi.setState({ abertos: [99] })
    montar()
    await screen.findByRole('toolbar', { name: 'Meus atendimentos' })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('mostra a fila como atalho pro console', async () => {
    fila = [chat(9, { status: 'queued', agent_id: null, agent_name: null })]
    montar()
    expect(await screen.findByRole('button', { name: '1 na fila' })).toBeInTheDocument()
  })

  it('no console (/chat) não aparece nem consulta os atendimentos', async () => {
    montar('/chat')
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/')).toBe(true))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(chamadas.some((c) => c.search.includes('mine=1'))).toBe(false)
  })

  it('cliente (portal) não vê nada', async () => {
    me = CLIENTE
    montar()
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/')).toBe(true))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })
})
