import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '@/api/chat'
import type { Me } from '@/api/types'
import { ConversaChat } from './ConversaChat'
import { supervisaoDe } from './supervisao'

/**
 * Supervisão: quem abre a conversa de OUTRO agente deixava de ver só "você
 * está só acompanhando". Supervisor e admin (`can_supervise`, decidido no
 * servidor) ganham "Entrar na conversa" e "Assumir atendimento"; o agente
 * comum continua só lendo. Quem entrou escreve (compositor) e pode sair.
 */

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({
    status: 'aberto',
    digitando: null,
    erro: null,
    enviarMensagem: vi.fn(),
    enviarDigitando: vi.fn(),
    confirmarEntrega: vi.fn(),
  }),
}))

vi.mock('./dados', () => ({
  useMacros: () => ({ data: [] }),
  useAplicarMacroChat: () => ({ mutate: vi.fn(), isPending: false }),
}))

const SOFIA: Me = {
  id: 9,
  email: 'sofia@demo.test',
  full_name: 'Sofia Supervisora',
  kind: 'internal',
  internal_role: 'supervisor',
  client_role: null,
  company: null,
  company_name: '',
  plan_name: '',
  is_internal: true,
  is_admin: false,
  teams: ['suporte'],
  presence: 'available',
  permissions: [],
  ticket_scope: 'team',
  custom_role_name: '',
  avatar_url: '',
  job_title: '',
  phone: '',
  ui_density: 'comfortable',
  signature: '',
  signature_kind: '' as const,
  signature_html: '',
  signature_image_url: '',
  signature_render: '',
}

function chat(extra: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: 'active',
    name: '',
    client_id: 4,
    client_name: 'Ana Cliente',
    client_email: 'ana@acme.test',
    client_phone: '',
    client_avatar: null,
    company_name: 'Acme',
    agent_name: 'Samuel Suporte',
    agent_id: 3,
    agent_avatar: null,
    category: null,
    category_name: null,
    priority: 'normal',
    assignee: null,
    assignee_name: null,
    tag_ids: [],
    queued_at: '2026-09-01T10:00:00Z',
    accepted_at: '2026-09-01T10:01:00Z',
    closed_at: null,
    reopen_count: 0,
    timeout_converted: false,
    unread_count: 0,
    last_message_preview: '',
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    participants: [],
    can_supervise: true,
    ...extra,
  }
}

const jsonDe = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

let chatAtual: ReturnType<typeof chat>
let posts: string[]

beforeEach(() => {
  chatAtual = chat()
  posts = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      if (init?.method === 'POST') {
        posts.push(u.pathname)
        if (u.pathname.endsWith('/join/')) {
          chatAtual = chat({ participants: [{ id: SOFIA.id, full_name: SOFIA.full_name }] })
        }
        if (u.pathname.endsWith('/assume/')) {
          chatAtual = chat({ agent_id: SOFIA.id, agent_name: SOFIA.full_name })
        }
        return Promise.resolve(jsonDe(chatAtual))
      }
      if (/\/messages\/$/.test(u.pathname)) return Promise.resolve(jsonDe([]))
      if (/\/chats\/7\/$/.test(u.pathname)) return Promise.resolve(jsonDe(chatAtual))
      return Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [] }))
    }),
  )
})

function montar(me: Me = SOFIA) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConversaChat chatId={7} me={me} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('conversa de outro agente', () => {
  it('agente comum só acompanha: sem entrar nem assumir', async () => {
    chatAtual = chat({ can_supervise: false })
    montar({ ...SOFIA, internal_role: 'agent' })

    expect(await screen.findByText(/Você está só acompanhando/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Entrar na conversa/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assumir atendimento/ })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Escreva para o cliente/)).not.toBeInTheDocument()
  })

  it('supervisora entra na conversa e passa a ter o compositor', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Entrar na conversa/ }))

    await waitFor(() => expect(posts).toContain('/api/v1/chat/chats/7/join/'))
    expect(await screen.findByPlaceholderText(/Escreva para o cliente/)).toBeInTheDocument()
    expect(screen.getByText(/Você entrou na conversa/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sair da conversa/ })).toBeInTheDocument()
  })

  it('assumir pede confirmação antes de tirar a conversa do colega', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Assumir atendimento/ }))

    // o primeiro clique só pergunta
    expect(posts).toEqual([])
    expect(screen.getByRole('group', { name: 'Confirmar assumir atendimento' })).toHaveTextContent(
      'Assumir o atendimento de Samuel Suporte?',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Assumir' }))
    await waitFor(() => expect(posts).toContain('/api/v1/chat/chats/7/assume/'))
    expect(await screen.findByPlaceholderText(/Escreva para o cliente/)).toBeInTheDocument()
  })

  it('cancelar a confirmação não assume nada', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Assumir atendimento/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('group', { name: 'Confirmar assumir atendimento' })).not.toBeInTheDocument()
    expect(posts).toEqual([])
  })
})

describe('supervisaoDe', () => {
  const comoChat = (extra: Record<string, unknown>) => chat(extra) as unknown as Chat

  it('dono escreve e não supervisiona a própria conversa', () => {
    const s = supervisaoDe(comoChat({ agent_id: SOFIA.id }), SOFIA)
    expect(s).toMatchObject({ souOAgente: true, podeEscrever: true, podeEntrar: false, podeAssumir: false })
  })

  it('participante escreve e ainda pode assumir, mas não entra de novo', () => {
    const s = supervisaoDe(
      comoChat({ participants: [{ id: SOFIA.id, full_name: SOFIA.full_name }] }),
      SOFIA,
    )
    expect(s).toMatchObject({ participo: true, podeEscrever: true, podeEntrar: false, podeAssumir: true })
  })

  it('conversa encerrada não oferece nada', () => {
    const s = supervisaoDe(comoChat({ status: 'closed' }), SOFIA)
    expect(s).toMatchObject({ podeEscrever: false, podeEntrar: false, podeAssumir: false })
  })

  it('resposta sem os campos novos (cache antigo) é "ninguém entrou, não pode"', () => {
    const { participants: _p, can_supervise: _c, ...antigo } = chat()
    const s = supervisaoDe(antigo as unknown as Chat, SOFIA)
    expect(s).toMatchObject({ participantes: [], podeEntrar: false, podeAssumir: false })
  })
})
