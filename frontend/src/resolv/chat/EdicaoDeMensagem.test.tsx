import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, MensagemChat } from '@/api/chat'
import type { Me } from '@/api/types'
import { useChatUi } from '@/stores/chatUi'
import { ConversaChat } from './ConversaChat'

const editarMock = vi.hoisted(() => vi.fn())

vi.mock('./dados', () => ({
  useMacros: () => ({ data: [] }),
  useAplicarMacroChat: () => ({ mutate: vi.fn(), isPending: false }),
}))

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

let chatAtual: Chat
let mensagensDoChat: MensagemChat[]

vi.mock('@/api/chat', () => ({
  LIMITE_MENSAGENS: 100,
  useChat: () => ({ data: chatAtual, isLoading: false, isError: false }),
  useMensagensChat: () => ({ data: mensagensDoChat, dataUpdatedAt: 0 }),
  useMarcarLidas: () => ({ mutate: vi.fn() }),
  useCarregarAnteriores: () => ({ mutate: vi.fn(), isPending: false }),
  usePegarChat: () => ({ mutate: vi.fn(), isPending: false }),
  useReabrirChat: () => ({ mutate: vi.fn(), isPending: false }),
  useBuscaNaConversa: () => ({ data: [], isLoading: false }),
  useCarregarAoRedor: () => ({ mutate: vi.fn() }),
  useMidiaDoChat: () => ({ data: undefined, isLoading: false }),
  useEditarMensagemChat: () => ({ mutate: editarMock, isPending: false }),
  anexarMensagemNoCache: vi.fn(),
}))

const ME: Me = {
  id: 3,
  email: 'samuel@demo.test',
  full_name: 'Samuel Suporte',
  kind: 'internal',
  internal_role: 'agent',
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

function chat(extra: Partial<Chat> = {}): Chat {
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
    agent_id: ME.id,
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
    last_message_preview: null,
    rating: null,
    close_reason: null,
    close_reason_name: null,
    closed_automatically: false,
    closed_by_name: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  }
}

function msg(extra: Partial<MensagemChat> = {}): MensagemChat {
  return {
    id: 1,
    author_name: 'Samuel Suporte',
    author_is_internal: true,
    body: 'oi, tudo bem?',
    is_system: false,
    is_internal_note: false,
    sent_at: '2026-09-01T10:05:00Z',
    read_at: null,
    delivered_at: null,
    files: [],
    edited_at: null,
    is_deleted: false,
    can_edit: true,
    reply_to: null,
    reply_preview: null,
    ...extra,
  }
}

function montar(me: Me = ME) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConversaChat chatId={7} me={me} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useChatUi.setState({ rascunhos: {}, abertos: [], filaAberta: false })
  editarMock.mockReset()
  chatAtual = chat()
})

describe('ConversaChat — editar mensagem', () => {
  it('mensagem com can_edit mostra o botão de editar; sem can_edit, não mostra', () => {
    mensagensDoChat = [
      msg({ id: 1, body: 'antiga', can_edit: false }),
      msg({ id: 2, body: 'última', can_edit: true }),
    ]
    montar()

    expect(screen.queryByRole('button', { name: 'Editar esta mensagem' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Editar esta mensagem' })).toHaveLength(1)
  })

  it('clicar em editar troca a bolha por um campo de texto com o corpo atual', () => {
    mensagensDoChat = [msg({ id: 2, body: 'última' })]
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Editar esta mensagem' }))

    expect(screen.getByLabelText('Editar mensagem')).toHaveValue('última')
    // a bolha original some — só o campo de edição fica na tela
    expect(screen.queryByRole('button', { name: 'Editar esta mensagem' })).not.toBeInTheDocument()
  })

  it('salvar chama a mutation com o texto corrigido', () => {
    mensagensDoChat = [msg({ id: 2, body: 'última' })]
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Editar esta mensagem' }))
    fireEvent.change(screen.getByLabelText('Editar mensagem'), { target: { value: 'última, corrigida' } })
    fireEvent.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(editarMock).toHaveBeenCalledWith(
      { id: 2, body: 'última, corrigida' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })

  it('cancelar volta a mostrar a bolha sem chamar a mutation', () => {
    mensagensDoChat = [msg({ id: 2, body: 'última' })]
    montar()

    fireEvent.click(screen.getByRole('button', { name: 'Editar esta mensagem' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.getByText('última')).toBeInTheDocument()
    expect(editarMock).not.toHaveBeenCalled()
  })

  it('mensagem apagada nunca mostra o botão de editar, mesmo se can_edit viesse true', () => {
    mensagensDoChat = [msg({ id: 2, is_deleted: true, can_edit: true })]
    montar()

    expect(screen.queryByRole('button', { name: 'Editar esta mensagem' })).not.toBeInTheDocument()
  })

  it('sem estar atendendo o chat (só acompanhando), não mostra editar mesmo sendo a última', () => {
    mensagensDoChat = [msg({ id: 2, body: 'última' })]
    chatAtual = chat({ agent_id: 999 }) // outro agente pegou o chat
    montar()

    expect(screen.queryByRole('button', { name: 'Editar esta mensagem' })).not.toBeInTheDocument()
  })
})
