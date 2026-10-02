import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaHistorico } from './PaginaHistorico'

function ticket(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    reference: `TD-${String(id).padStart(5, '0')}`,
    subject: `Assunto ${id}`,
    order_number: '',
    status: 'closed',
    stage_name: 'Fechado',
    stage_color: '#888',
    priority: 'normal',
    team: { id: 1, name: 'Suporte', slug: 'suporte' },
    category_name: 'Fiscal',
    requester_display: 'Ana',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-10T10:00:00Z',
    closed_at: '2026-08-10T10:00:00Z',
    auto_closed: false,
    first_response_at: '2026-08-01T11:00:00Z',
    reopen_count: 0,
    is_restricted: false,
    content_hidden: false,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: null, state: 'none', minutes_left: null } },
    satisfaction: null,
    ...extra,
  }
}

function chat(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'closed',
    name: '',
    client_id: 4,
    client_name: 'Ana',
    client_email: 'ana@acme.test',
    client_phone: '',
    client_avatar: null,
    company_name: 'Acme',
    agent_name: 'Fátima',
    agent_id: 2,
    agent_avatar: null,
    category: null,
    category_name: null,
    priority: 'normal',
    assignee: null,
    assignee_name: null,
    tag_ids: [],
    queued_at: '2026-08-20T13:00:00Z',
    accepted_at: '2026-08-20T13:02:00Z',
    closed_at: '2026-08-20T13:14:00Z',
    reopen_count: 0,
    timeout_converted: false,
    unread_count: 0,
    last_message_preview: 'Obrigada!',
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  }
}

const pagina = (results: unknown[], count = results.length) => ({ count, next: null, previous: null, results })

let urls: string[]
let tickets: ReturnType<typeof ticket>[]
let chats: ReturnType<typeof chat>[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function responder(url: string): Response {
  const u = new URL(url, 'http://x')
  if (u.pathname === '/api/v1/tickets/pending-ratings/') return jsonDe([{ ticket_id: 2, reference: 'TD-00002', subject: 'Assunto 2' }])
  if (u.pathname === '/api/v1/chat/chats/pending-ratings/') return jsonDe(chats.filter((c) => c.rating_pending))
  if (u.pathname === '/api/v1/chat/config/') return jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5 })
  if (u.pathname === '/api/v1/chat/chats/') return jsonDe(pagina(chats))
  if (u.pathname === '/api/v1/tickets/') {
    let saida = tickets
    const avaliacao = u.searchParams.get('avaliacao')
    if (avaliacao === 'sim') saida = saida.filter((t) => t.satisfaction !== null)
    if (avaliacao === 'nao') saida = saida.filter((t) => t.satisfaction === null)
    const q = u.searchParams.get('q')
    if (q) saida = saida.filter((t) => t.subject.toLowerCase().includes(q.toLowerCase()))
    return jsonDe(pagina(saida))
  }
  return jsonDe([])
}

beforeEach(() => {
  urls = []
  tickets = [
    ticket(1, { subject: 'Boleto errado', satisfaction: { score: 9, comment: 'Rápido e claro', responded_at: '2026-08-11T10:00:00Z' } }),
    ticket(2, { subject: 'Assunto 2' }),
    ticket(3, { subject: 'Fechado sozinho', auto_closed: true }),
  ]
  chats = [
    chat(10, { rating: { service_score: 8, resolution_score: 10, justification: 'Resolveu na hora', created_at: '2026-08-20T13:15:00Z' } }),
    chat(11, { agent_name: 'Samuel', rating_pending: true }),
    chat(12, { agent_name: null, timeout_converted: true, ticket_id: 7, ticket_reference: 'TD-00007' }),
  ]
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      urls.push(String(url))
      return Promise.resolve(responder(String(url)))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/portal/historico') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/portal/historico" element={<PaginaHistorico />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaHistorico', () => {
  it('mostra os encerrados com a nota e o comentário, e o botão de avaliar em quem ainda deve', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Histórico' })).toBeInTheDocument()
    expect(await screen.findByText('Boleto errado')).toBeInTheDocument()
    expect(screen.getByText('Nota 9 de 10')).toBeInTheDocument()
    expect(screen.getByText('“Rápido e claro”')).toBeInTheDocument()
    // TD-00002 está na pesquisa aberta → "Avaliar" leva ao chamado
    const linha = screen.getByText('Assunto 2', { selector: 'a' }).closest('li')!
    expect(within(linha).getByRole('link', { name: /Avaliar/ })).toHaveAttribute('href', '/portal/tickets/2')
    // fechado automaticamente, fora da pesquisa: sem avaliação, sem botão
    const fechado = screen.getByText('Fechado sozinho').closest('li')!
    expect(within(fechado).getByText('Sem avaliação')).toBeInTheDocument()
    expect(within(fechado).queryByRole('link', { name: /Avaliar/ })).not.toBeInTheDocument()
    // pediu o recorte certo ao servidor
    expect(urls.some((u) => u.includes('/api/v1/tickets/') && u.includes('status=closed'))).toBe(true)
  })

  it('junta as pendências de ticket e de chat num bloco só, cada uma com o seu caminho', async () => {
    montar()
    const bloco = (await screen.findByText('2 avaliações pendentes')).closest('[aria-labelledby]') as HTMLElement
    expect(within(bloco).getByRole('link', { name: 'Avaliar chat' })).toHaveAttribute('href', '/portal/chat')
    expect(within(bloco).getByRole('link', { name: 'Avaliar' })).toHaveAttribute('href', '/portal/tickets/2')
    expect(within(bloco).getByText(/Chat com Samuel/)).toBeInTheDocument()
  })

  it('os cartões do topo somam a partir dos recortes do servidor', async () => {
    montar()
    await screen.findByText('Boleto errado')
    const resumo = screen.getByRole('region', { name: 'Resumo' })
    const cartao = (rotulo: string) => within(resumo).getByText(rotulo).parentElement!.parentElement as HTMLElement
    await waitFor(() => expect(cartao('Tickets encerrados')).toHaveTextContent('3'))
    expect(cartao('Tickets avaliados')).toHaveTextContent('1')
    expect(cartao('Conversas encerradas')).toHaveTextContent('3')
  })

  it('a aba de chats mostra as duas notas, o "Avaliar" do pendente e o destino do convertido', async () => {
    montar('/portal/historico?aba=chats')
    expect(await screen.findByText('Conversa com Fátima')).toBeInTheDocument()
    expect(screen.getByText('Atendimento 8/10')).toBeInTheDocument()
    expect(screen.getByText('Resolução 10/10')).toBeInTheDocument()
    expect(screen.getByText('“Resolveu na hora”')).toBeInTheDocument()
    const pendente = screen.getByText('Conversa com Samuel').closest('li')!
    expect(within(pendente).getByRole('link', { name: /Avaliar/ })).toHaveAttribute('href', '/portal/chat')
    const convertido = screen.getByText('Conversa sem atendimento').closest('li')!
    expect(within(convertido).getByRole('link', { name: /Continuou no ticket TD-00007/ })).toHaveAttribute('href', '/portal/tickets/7')
    expect(screen.getAllByText('12 min de atendimento', { exact: false }).length).toBeGreaterThan(0)
  })

  it('o filtro de avaliação vai para o servidor nos tickets e recorta na tela nos chats', async () => {
    montar()
    await screen.findByText('Boleto errado')
    fireEvent.change(screen.getByLabelText('Avaliação'), { target: { value: 'sim' } })
    await waitFor(() => expect(urls.some((u) => u.includes('avaliacao=sim'))).toBe(true))
    await waitFor(() => expect(screen.queryByText('Assunto 2', { selector: 'a' })).not.toBeInTheDocument())
    expect(screen.getByText('Boleto errado')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('tab', { name: /Chats/ }))
    fireEvent.click(screen.getByRole('tab', { name: /Chats/ }))
    expect(await screen.findByText('Conversa com Fátima')).toBeInTheDocument()
    expect(screen.queryByText('Conversa com Samuel')).not.toBeInTheDocument()
    expect(screen.getByText('1 de 3 conversas')).toBeInTheDocument()
  })

  it('busca com folga de digitação e o "sem resultado" oferece limpar', async () => {
    montar()
    await screen.findByText('Boleto errado')
    fireEvent.change(screen.getByLabelText('Buscar no histórico'), { target: { value: 'nada disso' } })
    await waitFor(() => expect(urls.some((u) => u.includes('q=nada+disso'))).toBe(true))
    expect(await screen.findByText('Nenhum ticket encontrado')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca e filtros' }))
    expect(await screen.findByText('Boleto errado')).toBeInTheDocument()
  })

  it('sem nada encerrado ainda: explica e aponta para os chamados em aberto', async () => {
    tickets = []
    chats = []
    montar()
    expect(await screen.findByText('Nenhum ticket encerrado ainda')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver tickets em aberto' })).toHaveAttribute('href', '/portal/tickets')
  })
})
