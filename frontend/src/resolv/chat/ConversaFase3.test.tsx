import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { ConversaChat } from './ConversaChat'

/**
 * Fase 3 na tela do console: busca com destaque e navegação, resposta citada,
 * indicador de estado, régua de não lidas e miniatura de imagem.
 *
 * O que estes testes protegem é sobretudo o CONTRATO com o servidor: a busca
 * tem de virar `?q=` (procurar no que está carregado responde "não achei"
 * para algo que existe) e a resposta tem de viajar com `reply_to`.
 */

const enviarMensagem = vi.fn()
const confirmarEntrega = vi.fn()

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({
    status: 'aberto',
    digitando: null,
    erro: null,
    enviarMensagem,
    enviarDigitando: vi.fn(),
    confirmarEntrega,
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
    author_name: 'Ana Cliente',
    author_is_internal: false,
    body: `mensagem ${id}`,
    is_system: false,
    sent_at: '2026-09-01T10:02:00Z',
    read_at: '2026-09-01T10:03:00Z',
    delivered_at: '2026-09-01T10:02:30Z',
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
let buscas: string[]
let resultadosDaBusca: ReturnType<typeof msg>[]

const jsonDe = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
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
  mensagens = [msg(1), msg(2)]
  buscas = []
  resultadosDaBusca = []
  enviarMensagem.mockClear()
  confirmarEntrega.mockClear()
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (/\/messages\/$/.test(u.pathname)) {
        if (u.searchParams.get('q')) {
          buscas.push(u.searchParams.get('q')!)
          return Promise.resolve(jsonDe({ results: resultadosDaBusca }))
        }
        if (u.searchParams.get('around')) return Promise.resolve(jsonDe(mensagens))
        return Promise.resolve(jsonDe(mensagens))
      }
      if (/\/media\/$/.test(u.pathname)) {
        return Promise.resolve(
          jsonDe({
            files: [
              {
                id: 5,
                filename: 'nota.pdf',
                content_type: 'application/pdf',
                size_bytes: 1024,
                scan_status: 'clean',
                url: '/media/nota.pdf',
                is_downloadable: true,
                chat_id: 7,
                message_id: 2,
                sent_at: '2026-09-01T10:04:00Z',
              },
            ],
            links: [
              {
                url: 'https://correios.test/abc',
                chat_id: 7,
                message_id: 1,
                sent_at: '2026-09-01T10:02:00Z',
                author_name: 'Ana Cliente',
              },
            ],
          }),
        )
      }
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

describe('busca dentro da conversa', () => {
  it('manda o termo para o SERVIDOR, não filtra o que está na tela', async () => {
    resultadosDaBusca = [msg(1, { body: 'o boleto venceu' })]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar nesta conversa' }))
    fireEvent.change(screen.getByLabelText('Termo da busca'), { target: { value: 'boleto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(buscas).toContain('boleto'))
  })

  it('mostra em que ocorrência a navegação está', async () => {
    resultadosDaBusca = [msg(1), msg(2)]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar nesta conversa' }))
    fireEvent.change(screen.getByLabelText('Termo da busca'), { target: { value: 'mensagem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('1 de 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Próximo resultado' }))
    expect(await screen.findByText('2 de 2')).toBeInTheDocument()
  })

  it('sem resultado diz isso por extenso', async () => {
    resultadosDaBusca = []
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar nesta conversa' }))
    fireEvent.change(screen.getByLabelText('Termo da busca'), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('nada encontrado')).toBeInTheDocument()
  })

  it('destaca o trecho achado dentro do balão', async () => {
    resultadosDaBusca = [msg(1)]
    montar()
    await screen.findByText('mensagem 1')
    fireEvent.click(screen.getByRole('button', { name: 'Buscar nesta conversa' }))
    fireEvent.change(screen.getByLabelText('Termo da busca'), { target: { value: 'mensagem' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(document.querySelectorAll('mark').length).toBeGreaterThan(0))
  })

  it('um caractere não vai para o servidor — seria rolagem, não busca', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Buscar nesta conversa' }))
    fireEvent.change(screen.getByLabelText('Termo da busca'), { target: { value: 'a' } })
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeDisabled()
  })
})

describe('resposta citada', () => {
  it('o texto viaja com o id da mensagem citada', async () => {
    montar()
    await screen.findByText('mensagem 1')
    fireEvent.click(screen.getAllByRole('button', { name: /Responder à mensagem/ })[0])
    expect(await screen.findByText('Respondendo Ana Cliente')).toBeInTheDocument()

    const campo = screen.getByPlaceholderText(/Escreva para o cliente/)
    fireEvent.change(campo, { target: { value: 'já verifiquei' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(enviarMensagem).toHaveBeenCalledWith('já verifiquei', 1)
  })

  it('desistir da citação manda sem `reply_to`', async () => {
    montar()
    await screen.findByText('mensagem 1')
    fireEvent.click(screen.getAllByRole('button', { name: /Responder à mensagem/ })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar resposta' }))

    const campo = screen.getByPlaceholderText(/Escreva para o cliente/)
    fireEvent.change(campo, { target: { value: 'sem citar' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    expect(enviarMensagem).toHaveBeenCalledWith('sem citar', null)
  })

  it('a citação recebida aparece com autor e trecho', async () => {
    mensagens = [
      msg(1),
      msg(2, {
        reply_to: 1,
        reply_preview: { id: 1, author_name: 'Ana Cliente', excerpt: 'o pedido 998', is_deleted: false, has_files: false },
      }),
    ]
    montar()
    expect(await screen.findByText('o pedido 998')).toBeInTheDocument()
  })
})

describe('estado da mensagem e régua', () => {
  it('só a mensagem de quem escreveu ganha indicador', async () => {
    mensagens = [
      msg(1, { author_is_internal: false }),
      msg(2, { author_is_internal: true, author_name: 'Samuel Suporte', read_at: null, delivered_at: null }),
    ]
    montar()
    await screen.findByText('mensagem 2')
    // a do cliente (recebida) não tem escada de status; a minha tem
    expect(screen.getAllByText('Enviada')).toHaveLength(1)
  })

  it('lida aparece por extenso, não só por cor', async () => {
    mensagens = [msg(1, { author_is_internal: true, author_name: 'Samuel Suporte' })]
    montar()
    expect(await screen.findByText('Lida')).toBeInTheDocument()
  })

  it('a régua "Novas mensagens" abre na primeira não lida do outro lado', async () => {
    mensagens = [msg(1), msg(2, { read_at: null })]
    montar()
    expect(await screen.findByText('Novas mensagens')).toBeInTheDocument()
  })

  it('confirma a entrega do que chegou sem carimbo', async () => {
    mensagens = [msg(1, { delivered_at: null })]
    montar()
    await waitFor(() => expect(confirmarEntrega).toHaveBeenCalledWith([1]))
  })
})

describe('painel de anexos e links', () => {
  it('lista o que passou por esta conversa', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Anexos e links da conversa' }))
    const painel = await screen.findByRole('complementary', { name: 'Anexos e links desta conversa' })
    expect(await within(painel).findByText('nota.pdf')).toBeInTheDocument()
    expect(within(painel).getByText('https://correios.test/abc')).toBeInTheDocument()
  })
})
