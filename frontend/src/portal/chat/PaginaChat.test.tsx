import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaChat } from './PaginaChat'

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({ status: 'aberto', digitando: null, erro: null, enviarMensagem: vi.fn(), enviarDigitando: vi.fn() }),
}))

function chat(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'active',
    name: '',
    client_id: 4,
    client_name: 'Ana',
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
    last_message_preview: 'Olá, tudo bem?',
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  }
}

const CONFIG = { welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: true, queue_opens_at: null }

let vivo: unknown
let pendentesRating: unknown[]
let historico: unknown[]
let config: Record<string, unknown>
let chamadas: { url: string; metodo: string }[]
let encerramentos: unknown[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  vivo = null
  pendentesRating = []
  historico = []
  config = CONFIG
  chamadas = []
  encerramentos = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname + u.search, metodo: init?.method ?? 'GET' })
      if (u.pathname === '/api/v1/chat/config/') return Promise.resolve(jsonDe(config))
      if (u.pathname === '/api/v1/chat/chats/pending-ratings/') return Promise.resolve(jsonDe(pendentesRating))
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('status') === 'closed') return Promise.resolve(jsonDe(pagina(historico)))
      if (u.pathname === '/api/v1/chat/chats/' && init?.method === 'POST') {
        return vivo
          ? Promise.resolve(jsonDe(vivo))
          : Promise.resolve(jsonDe(chat(99), 201))
      }
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe(pagina(vivo ? [vivo] : [])))
      if (/\/api\/v1\/chat\/chats\/\d+\/$/.test(u.pathname)) {
        const id = Number(u.pathname.split('/').filter(Boolean).pop())
        const alvo = [vivo, ...historico].find((c: any) => c?.id === id)
        return Promise.resolve(jsonDe(alvo ?? chat(id)))
      }
      if (/\/close\/$/.test(u.pathname)) {
        encerramentos.push(JSON.parse(String(init?.body ?? '{}')))
        const fechado = chat((vivo as { id: number }).id, {
          status: 'closed',
          closed_at: '2026-09-01T12:00:00Z',
          rating: { service_score: 9, resolution_score: 9, justification: '', created_at: '' },
        })
        // é o que o servidor faz: encerrado, o chat sai da "conversa viva"
        vivo = null
        historico = [fechado]
        return Promise.resolve(jsonDe(fechado))
      }
      if (/\/messages\/$/.test(u.pathname)) return Promise.resolve(jsonDe([]))
      if (u.pathname === '/api/v1/chat/timeline/') return Promise.resolve(jsonDe({ messages: [], sessions: [], has_more: false }))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/chat']}>
        <PaginaChat />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaChat (cliente)', () => {
  it('sem conversa: mostra o vazio de histórico e permite iniciar um novo chat', async () => {
    montar()
    expect(await screen.findByText('Nenhuma conversa ainda')).toBeInTheDocument()
    const botao = screen.getByRole('button', { name: /Novo chat/ })
    expect(botao).not.toBeDisabled()
    fireEvent.click(botao)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/chats/' && c.metodo === 'POST')).toBe(true))
  })

  it('avaliação pendente: modal sem saída cobre a tela (some da árvore de acessibilidade) e trava "Novo chat"', async () => {
    pendentesRating = [chat(7, { status: 'closed', closed_at: '2026-09-01T12:00:00Z', rating_pending: true })]
    montar()
    expect(await screen.findByText('Como foi o atendimento?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fechar' })).not.toBeInTheDocument()
    // o resto da página vira aria-hidden enquanto o modal está aberto — é o
    // comportamento certo (leitor de tela não alcança o que está atrás),
    // então a busca aqui usa hidden:true só para inspecionar o atributo
    const botaoNovo = screen.getByRole('button', { name: /Novo chat/, hidden: true })
    expect(botaoNovo).toBeDisabled()
    expect(botaoNovo).toHaveAttribute('title', 'Avalie o último atendimento antes de iniciar outro')
  })

  it('avaliação: nota abaixa do gatilho exige justificativa antes de habilitar o envio', async () => {
    pendentesRating = [chat(7, { status: 'closed', closed_at: '2026-09-01T12:00:00Z', rating_pending: true })]
    montar()
    await screen.findByText('Como foi o atendimento?')
    fireEvent.click(screen.getAllByRole('radio', { name: '9' })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: '3' })[1])
    expect(screen.getByRole('button', { name: /Enviar avaliação/ })).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Comentário/), { target: { value: 'Não resolveu o problema.' } })
    expect(screen.getByRole('button', { name: /Enviar avaliação/ })).toBeEnabled()
  })

  it('encerrar É avaliar: as duas notas vão no mesmo POST /close/', async () => {
    vivo = chat(5, { status: 'active' })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Encerrar conversa/ }))
    await screen.findByText('Antes de encerrar, como foi?')
    fireEvent.click(screen.getAllByRole('radio', { name: '9' })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: '9' })[1])
    fireEvent.click(screen.getByRole('button', { name: /Avaliar e encerrar/ }))
    await waitFor(() => expect(encerramentos.length).toBe(1))
    expect(encerramentos[0]).toMatchObject({ service_score: 9, resolution_score: 9 })
  })

  it('a confirmação de encerramento sobrevive à conversa sumir da lista viva', async () => {
    // A regressão que este teste tranca: encerrado, o chat sai da consulta de
    // "conversa viva", a seleção caía para null e a `Conversa` desmontava —
    // levando junto a confirmação, e o cliente ia parar numa lista vazia sem
    // nenhum aviso de que tinha terminado.
    vivo = chat(5, { status: 'active' })
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Encerrar conversa/ }))
    await screen.findByText('Antes de encerrar, como foi?')
    fireEvent.click(screen.getAllByRole('radio', { name: '9' })[0])
    fireEvent.click(screen.getAllByRole('radio', { name: '9' })[1])
    fireEvent.click(screen.getByRole('button', { name: /Avaliar e encerrar/ }))
    expect(await screen.findByText('Conversa encerrada')).toBeInTheDocument()
    // ...e continua lá DEPOIS que a lista viva se atualiza e a conversa sai
    // dela. Sem esta espera o teste passaria mesmo com o defeito, porque
    // afirmaria antes do refetch chegar.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Encerrar conversa/, hidden: true })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('Conversa encerrada')).toBeInTheDocument()
  })

  it('conversa viva: abre selecionada e mostra o compositor', async () => {
    vivo = chat(5, { status: 'active' })
    montar()
    expect(await screen.findByText('Você está falando com Samuel Suporte')).toBeInTheDocument()
    expect(screen.getByLabelText('Escreva sua mensagem')).toBeInTheDocument()
    // "Novo chat" vira "Continuar" quando já existe uma conversa viva
    expect(screen.getByRole('button', { name: /Continuar/ })).toBeInTheDocument()
  })

  it('fila fechada e sem conversa viva: aponta para abrir um ticket', async () => {
    config = { ...CONFIG, queue_open: false, queue_opens_at: '2026-09-08T12:00:00Z' }
    montar()
    expect(await screen.findByText('Fora do horário de atendimento por chat')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abrir ticket' })).toHaveAttribute('href', '/portal/tickets/novo')
    expect(screen.getByRole('button', { name: /Novo chat/ })).toBeDisabled()
  })

  it('histórico: encerrada some da "conversa atual" e aparece com a pílula certa', async () => {
    historico = [chat(3, { status: 'closed', closed_at: '2026-09-01T12:00:00Z', agent_name: 'Fátima' })]
    montar()
    expect(await screen.findByText('Fátima')).toBeInTheDocument()
    expect(screen.getByText('Encerrada')).toBeInTheDocument()
    expect(screen.queryByText('Conversa atual')).not.toBeInTheDocument()
  })

  it('"Ver conversa completa" só aparece com histórico, e abre a linha do tempo costurada', async () => {
    montar()
    await screen.findByText('Nenhuma conversa ainda')
    expect(screen.queryByRole('button', { name: /Ver conversa completa/ })).not.toBeInTheDocument()
  })

  it('com histórico, "Ver conversa completa" abre a linha do tempo', async () => {
    historico = [chat(3, { status: 'closed', closed_at: '2026-09-01T12:00:00Z', agent_name: 'Fátima' })]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Ver conversa completa/ }))
    expect(await screen.findByText('Conversa completa')).toBeInTheDocument()
    await waitFor(() => expect(chamadas.some((c) => c.url.startsWith('/api/v1/chat/timeline/'))).toBe(true))
  })
})
