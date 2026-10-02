import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, LinhaDeCliente, MensagemChat } from '@/api/chat'
import type { Me } from '@/api/types'
import type { MensagemLinhaDoTempo, SessaoLinhaDoTempo } from '@/portal/api/chats'
import { AvatarComPresenca } from './AvatarComPresenca'
import { ListaClientes } from './ListaClientes'
import { ThreadDoCliente } from './ThreadDoCliente'

/**
 * Correção 1: a conversa do agente é POR CLIENTE.
 *
 * O que estes testes protegem: uma linha por PESSOA na caixa; o histórico de
 * todas as aberturas dela numa rolagem só; e o marcador entre uma abertura e
 * a seguinte dizendo QUEM atendeu — o responsável muda de uma para outra, e
 * sem isso duas conversas de agentes diferentes viram uma massa só.
 *
 * E o que NÃO pode acontecer: a abertura de agora aparecer duas vezes (uma
 * pelo histórico costurado, outra pela conversa viva).
 */

const marcarThread = vi.hoisted(() => vi.fn())

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
let caixa: LinhaDeCliente[]

vi.mock('@/api/chat', () => ({
  LIMITE_MENSAGENS: 100,
  useChat: () => ({ data: chatAtual, isLoading: false, isError: false }),
  useMensagensChat: () => ({ data: mensagensDoChat, dataUpdatedAt: 0 }),
  useMarcarLidas: () => ({ mutate: vi.fn() }),
  useMarcarThreadLida: () => ({ mutate: marcarThread }),
  useCarregarAnteriores: () => ({ mutate: vi.fn(), isPending: false }),
  usePegarChat: () => ({ mutate: vi.fn(), isPending: false }),
  useReabrirChat: () => ({ mutate: vi.fn(), isPending: false }),
  useBuscaNaConversa: () => ({ data: [], isLoading: false }),
  useCarregarAoRedor: () => ({ mutate: vi.fn() }),
  useMidiaDoChat: () => ({ data: undefined, isLoading: false }),
  useCaixaDeClientes: () => ({ data: caixa, isLoading: false, isError: false, refetch: vi.fn() }),
  useEditarMensagemChat: () => ({ mutate: vi.fn(), isPending: false }),
  anexarMensagemNoCache: vi.fn(),
}))

let linhaDoTempo: { mensagens: MensagemLinhaDoTempo[]; sessoes: SessaoLinhaDoTempo[] }

vi.mock('@/portal/api/chats', () => ({
  useConversaContinua: () => ({
    mensagens: linhaDoTempo.mensagens,
    sessoes: linhaDoTempo.sessoes,
    carregando: false,
    erro: undefined,
    temMais: false,
  }),
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
    id: 82,
    status: 'active',
    name: '',
    client_id: 4,
    client_name: 'Ana Almeida',
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
    queued_at: '2026-09-08T10:00:00Z',
    accepted_at: '2026-09-08T10:01:00Z',
    closed_at: null,
    reopen_count: 0,
    close_reason: null,
    close_reason_name: null,
    close_note: '',
    closed_automatically: false,
    closed_by_name: null,
    agent_score: null,
    timeout_converted: false,
    unread_count: 0,
    last_message_preview: null,
    client_presence: 'available',
    agent_presence: 'available',
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  } as Chat
}

function mensagem(id: number, chatId: number, corpo: string, extra: Partial<MensagemChat> = {}) {
  return {
    id,
    chat_id: chatId,
    body: corpo,
    author_id: 4,
    author_name: 'Ana Almeida',
    author_avatar: null,
    author_is_internal: false,
    is_system: false,
    is_internal_note: false,
    sent_at: '2026-09-08T10:05:00Z',
    edited_at: null,
    is_deleted: false,
    delivered_at: null,
    read_at: null,
    can_edit: false,
    reply_preview: null,
    files: [],
    ...extra,
  } as unknown as MensagemLinhaDoTempo
}

function sessao(id: number, extra: Partial<SessaoLinhaDoTempo> = {}): SessaoLinhaDoTempo {
  return {
    id,
    status: 'closed',
    queued_at: '2026-09-01T09:00:00Z',
    closed_at: '2026-09-01T09:40:00Z',
    agent_name: 'Samuel Suporte',
    rating: null,
    close_reason_name: null,
    ticket_reference: null,
    ...extra,
  }
}

function linha(extra: Partial<LinhaDeCliente> = {}): LinhaDeCliente {
  return {
    client_id: 4,
    client_name: 'Ana Almeida',
    client_avatar: null,
    client_presence: 'available',
    company_name: 'Acme',
    last_activity: '2026-09-08T10:05:00Z',
    last_message_preview: 'segunda conversa',
    sessions: 2,
    open_chat_id: 82,
    open_agent_id: 9,
    last_chat_id: 82,
    unread: 3,
    ...extra,
  }
}

function montarThread() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ThreadDoCliente clienteId={4} chatAtualId={82} me={ME} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  marcarThread.mockClear()
  chatAtual = chat()
  mensagensDoChat = [mensagem(20, 82, 'segunda conversa')]
  caixa = [linha()]
  linhaDoTempo = {
    mensagens: [mensagem(10, 81, 'primeira conversa'), mensagem(20, 82, 'segunda conversa')],
    sessoes: [
      // o primeiro atendimento foi de OUTRO agente — é o que o marcador
      // precisa deixar visível
      sessao(81, { agent_name: 'Fátima Financeiro' }),
      sessao(82, {
        status: 'active',
        closed_at: null,
        agent_name: 'Samuel Suporte',
        queued_at: '2026-09-08T10:00:00Z',
      }),
    ],
  }
})

describe('caixa de entrada agrupada por cliente', () => {
  it('desenha uma linha por PESSOA, com quantas aberturas ela costura', () => {
    render(<ListaClientes selecionado={null} onSelecionar={vi.fn()} agoraMs={Date.parse('2026-09-08T10:10:00Z')} />)

    const cards = screen.getAllByRole('button').filter((b) => b.textContent?.includes('Ana Almeida'))
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('2 atendimentos')
    expect(cards[0]).toHaveTextContent('segunda conversa')
  })

  it('soma as não lidas de todas as aberturas num contador só', () => {
    render(<ListaClientes selecionado={null} onSelecionar={vi.fn()} agoraMs={0} />)
    expect(screen.getByLabelText('3 não lidas')).toHaveTextContent('3')
  })

  it('avisa quando não há nenhuma abertura viva — não dá para escrever ali', () => {
    caixa = [linha({ open_chat_id: null, open_agent_id: null, last_chat_id: 81 })]
    render(<ListaClientes selecionado={null} onSelecionar={vi.fn()} agoraMs={0} />)
    expect(screen.getByRole('button', { name: /Ana Almeida/ })).toHaveTextContent('sem conversa aberta')
  })
})

describe('thread contínua do cliente', () => {
  it('costura as aberturas anteriores acima da conversa de agora', () => {
    montarThread()

    expect(screen.getByText('primeira conversa')).toBeInTheDocument()
    expect(screen.getByText('segunda conversa')).toBeInTheDocument()
  })

  it('não repete a abertura de agora — ela é desenhada uma vez só', () => {
    montarThread()
    // a mensagem viva vem do `ConversaChat`; o histórico costurado a exclui
    expect(screen.getAllByText('segunda conversa')).toHaveLength(1)
  })

  it('o marcador diz quem atendeu CADA abertura — o responsável muda', () => {
    montarThread()

    const marcos = screen.getAllByRole('separator')
    const textos = marcos.map((m) => m.textContent ?? '')
    expect(textos.some((t) => t.includes('#81') && t.includes('Fátima Financeiro'))).toBe(true)
    expect(textos.some((t) => t.includes('#82') && t.includes('Samuel Suporte'))).toBe(true)
  })

  it('marca o fim de cada atendimento encerrado, com motivo e nota', () => {
    linhaDoTempo.sessoes[0] = sessao(81, {
      close_reason_name: 'Resolvido',
      rating: { service_score: 9, resolution_score: 8, justification: '', created_at: '' },
    })
    montarThread()

    const fecho = screen
      .getAllByRole('separator')
      .find((m) => m.textContent?.includes('encerrado'))
    expect(fecho).toHaveTextContent('Resolvido')
    expect(fecho).toHaveTextContent('nota 9')
  })

  it('quando a abertura virou chamado, o marcador leva o protocolo do chamado', () => {
    linhaDoTempo.sessoes[0] = sessao(81, { ticket_reference: 'CVZ-4812' })
    montarThread()

    expect(
      screen.getAllByRole('separator').some((m) => m.textContent?.includes('CVZ-4812')),
    ).toBe(true)
  })

  it('dá as aberturas anteriores por lidas — elas estão na tela', () => {
    montarThread()
    expect(marcarThread).toHaveBeenCalledWith([81])
  })

  it('escrever continua sendo na abertura viva — um compositor só', () => {
    montarThread()
    expect(screen.getAllByPlaceholderText(/Escreva para o cliente/)).toHaveLength(1)
  })

  it('sem abertura viva a thread fica em leitura', () => {
    chatAtual = chat({ id: 81, status: 'closed', closed_at: '2026-09-01T09:40:00Z' })
    mensagensDoChat = []
    montarThread()

    expect(screen.getByText(/Conversa encerrada/)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Escreva para o cliente/)).not.toBeInTheDocument()
  })
})

describe('correção 2: a bolinha de disponibilidade', () => {
  it('sai no avatar, com o recorte na cor do fundo em volta', () => {
    const { container } = render(<AvatarComPresenca nome="Ana Almeida" presenca="away" />)
    const ponto = container.querySelector('.cc-avatar__ponto')

    expect(ponto).toHaveClass('cc-avatar__ponto--away')
    expect(ponto).toHaveClass('cc-avatar__ponto--em-card')
  })

  it('diz o estado por extenso — a cor sozinha não é informação', () => {
    render(<AvatarComPresenca nome="Ana Almeida" presenca="offline" />)
    expect(screen.getByText('offline')).toBeInTheDocument()
  })

  it('sem presença conhecida não desenha nada — cinza afirmaria "offline"', () => {
    const { container } = render(<AvatarComPresenca nome="Ana Almeida" presenca={null} />)
    expect(container.querySelector('.cc-avatar__ponto')).toBeNull()
  })

  it('a caixa por cliente leva a bolinha do cliente', () => {
    const { container } = render(
      <ListaClientes selecionado={null} onSelecionar={vi.fn()} agoraMs={0} />,
    )
    const card = screen.getByRole('button', { name: /Ana Almeida/ })
    expect(within(card).getByText('disponível')).toBeInTheDocument()
    expect(container.querySelector('.cc-avatar__ponto--available')).not.toBeNull()
  })
})
