import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { ConversaChat } from './ConversaChat'

/**
 * A nota interna na TELA do agente.
 *
 * O servidor é quem garante que o cliente não recebe (ver
 * `chat_service.mensagens_visiveis` e a trava do consumer). O que estes
 * testes protegem é o outro erro, o humano: o agente escrever para a equipe
 * achando que fala com o cliente, ou o contrário. Por isso a tela diz o modo
 * de três jeitos ao mesmo tempo — aviso, cor e rótulo do botão — e é isso
 * que está travado aqui.
 */

const enviarMensagem = vi.fn()

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({
    status: 'aberto',
    digitando: null,
    erro: null,
    enviarMensagem,
    enviarDigitando: vi.fn(),
    confirmarEntrega: vi.fn(),
  }),
}))

vi.mock('./dados', () => ({
  useMacros: () => ({ data: [] }),
  useAplicarMacroChat: () => ({ mutate: vi.fn(), isPending: false }),
}))

const CHAT = {
  id: 7,
  status: 'active',
  name: '',
  client_id: 4,
  client_name: 'Ana Cliente',
  client_email: 'ana@acme.test',
  client_phone: '',
  client_avatar: null,
  client_presence: 'available',
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
}

function msg(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    author_name: 'Samuel Suporte',
    author_is_internal: true,
    body: `mensagem ${id}`,
    is_system: false,
    is_internal_note: false,
    sent_at: '2026-09-01T10:02:00Z',
    read_at: null,
    delivered_at: null,
    files: [],
    edited_at: null,
    is_deleted: false,
    can_edit: false,
    reply_to: null,
    reply_preview: null,
    ...extra,
  }
}

let mensagens: ReturnType<typeof msg>[]

const jsonDe = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

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
}

beforeEach(() => {
  mensagens = [msg(1)]
  enviarMensagem.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (/\/messages\/$/.test(u.pathname)) return Promise.resolve(jsonDe(mensagens))
      if (/\/chats\/7\/$/.test(u.pathname)) return Promise.resolve(jsonDe(CHAT))
      return Promise.resolve(jsonDe(pagina([])))
    }),
  )
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConversaChat chatId={7} me={ME} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const botaoModo = () => screen.getByRole('button', { name: /Nota interna/ })

describe('modo nota interna', () => {
  it('começa desligado — falar com o cliente é o padrão', async () => {
    montar()
    expect(await screen.findByPlaceholderText(/Escreva para o cliente/)).toBeInTheDocument()
    expect(botaoModo()).toHaveAttribute('aria-pressed', 'false')
  })

  it('ligado, a mensagem viaja marcada como interna', async () => {
    montar()
    await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.click(botaoModo())

    const campo = screen.getByPlaceholderText(/Anotação para a equipe/)
    fireEvent.change(campo, { target: { value: 'pedi o estorno' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(enviarMensagem).toHaveBeenCalledWith('pedi o estorno', null, true)
  })

  it('avisa por escrito para onde o texto vai', async () => {
    montar()
    await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.click(botaoModo())
    expect(screen.getByText(/o cliente não vê nota interna/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar nota' })).toBeInTheDocument()
  })

  it('o modo NÃO se desliga sozinho ao enviar', async () => {
    // quem está anotando o atendimento escreve mais de uma linha; voltar a
    // "público" a cada envio é o caminho curto para mandar a segunda nota
    // ao cliente
    montar()
    await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.click(botaoModo())
    const campo = screen.getByPlaceholderText(/Anotação para a equipe/)
    fireEvent.change(campo, { target: { value: 'primeira' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(botaoModo()).toHaveAttribute('aria-pressed', 'true')
  })

  it('desligar volta a falar com o cliente', async () => {
    montar()
    await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.click(botaoModo())
    fireEvent.click(botaoModo())
    const campo = screen.getByPlaceholderText(/Escreva para o cliente/)
    fireEvent.change(campo, { target: { value: 'oi Ana' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(enviarMensagem).toHaveBeenCalledWith('oi Ana', null, false)
  })

  it('o rascunho sobrevive à troca de modo', async () => {
    // quem começou a escrever e percebeu no meio que aquilo é recado para a
    // equipe não pode perder o texto
    montar()
    const campo = await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.change(campo, { target: { value: 'texto em andamento' } })
    fireEvent.click(botaoModo())
    expect(screen.getByPlaceholderText(/Anotação para a equipe/)).toHaveValue('texto em andamento')
  })
})

describe('nota interna recebida na thread', () => {
  it('vem com selo escrito, não só com cor de fundo', async () => {
    mensagens = [msg(1, { is_internal_note: true, body: 'pedi o estorno' })]
    montar()
    expect(await screen.findByText(/Nota interna — o cliente não vê/)).toBeInTheDocument()
  })

  it('não mostra escada de entrega — não há destinatário', async () => {
    mensagens = [msg(1, { is_internal_note: true, body: 'pedi o estorno' })]
    montar()
    await screen.findByText(/Nota interna — o cliente não vê/)
    expect(screen.queryByText('Enviada')).not.toBeInTheDocument()
  })

  it('mensagem normal ganha a escada normalmente', async () => {
    montar()
    expect(await screen.findByText('Enviada')).toBeInTheDocument()
  })

  it('mensagem normal não ganha selo nenhum', async () => {
    montar()
    await screen.findByText('mensagem 1')
    expect(screen.queryByText(/Nota interna — o cliente não vê/)).not.toBeInTheDocument()
  })
})

describe('presença do cliente no cabeçalho', () => {
  it('diz se o cliente ainda está na tela', async () => {
    montar()
    expect(await screen.findByText('cliente na tela')).toBeInTheDocument()
  })
})
