import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaInicio } from './PaginaInicio'

const ME = { id: 2, full_name: 'Samuel Suporte', email: 'samuel@x.test', is_internal: true, is_admin: false, kind: 'internal', permissions: [] }

function linhaTicket(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, reference: `T-000${id}`, subject: `Assunto ${id}`, status: 'open', stage_name: 'Em andamento', stage_color: '#888',
    priority: 'high', source: 'web', requester_display: 'Cliente X', company_name: 'Empresa X', assignee_name: null,
    category_name: null, current_status_note: null,
    sla: { first_response: { due_at: null, state: 'none', minutes_left: null }, resolution: { due_at: null, state: 'at_risk', minutes_left: 60 } },
    first_response_at: null, created_at: '2026-09-06T10:00:00Z', is_restricted: false, ...extra,
  }
}

let filaAberta: boolean
let queueOpensAt: string | null
/** Chamados sem responsável (novo/aberto) que a listagem devolve. */
let semDono: ReturnType<typeof linhaTicket>[]
let atribuicoes: { id: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  filaAberta = true
  queueOpensAt = null
  semDono = []
  atribuicoes = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      // "Pegar o próximo": escolha e atribuição numa ação só do servidor
      if (u.pathname === '/api/v1/tickets/take-next/' && init?.method === 'POST') {
        const proximo = semDono[0]
        if (!proximo) {
          return Promise.resolve(jsonDe({ code: 'nada_para_pegar', detail: 'Nenhum chamado sem responsável agora.' }, 409))
        }
        atribuicoes.push({ id: String(proximo.id), corpo: null })
        return Promise.resolve(jsonDe(proximo))
      }
      if (u.pathname === '/api/v1/tickets/' && u.searchParams.get('assignee') === 'unassigned') {
        return Promise.resolve(jsonDe(pagina(semDono)))
      }
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/announcements/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/chat/config/') {
        return Promise.resolve(jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: filaAberta, queue_opens_at: queueOpensAt }))
      }
      if (u.pathname === '/api/v1/reports/indicators/') {
        return Promise.resolve(jsonDe({ kpis: [{ key: 'resolved', label: 'Tickets resolvidos', description: '', unit: 'count', direction: 'up', value: 8, variation: 14 }] }))
      }
      if (u.pathname === '/api/v1/tickets/' && u.searchParams.get('view') === 'meus-nao-resolvidos') {
        return Promise.resolve(jsonDe(pagina([linhaTicket(1)])))
      }
      if (u.pathname === '/api/v1/tickets/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/chat/chats/') return Promise.resolve(jsonDe(pagina([])))
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([]))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<PaginaInicio />} />
          <Route path="/chamados/:id" element={<p>detalhe do chamado</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaInicio', () => {
  it('saúda pelo primeiro nome e mostra a fila aberta', async () => {
    montar()
    expect(await screen.findByText('Olá, Samuel')).toBeInTheDocument()
    expect(screen.getByText('Fila de chat aberta')).toBeInTheDocument()
  })

  it('fila fechada mostra quando volta', async () => {
    filaAberta = false
    queueOpensAt = '2026-09-08T12:00:00Z'
    montar()
    expect(await screen.findByText(/Fila de chat fechada.*volta/)).toBeInTheDocument()
  })

  it('não repete as ações da sidebar (Novo ticket, Chat) no cabeçalho', async () => {
    montar()
    await screen.findByText('Olá, Samuel')
    expect(screen.queryByRole('button', { name: /novo ticket/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^chat$/i })).not.toBeInTheDocument()
  })

  it('"Pegar o próximo" atribui a quem clicou e abre o chamado', async () => {
    semDono = [linhaTicket(7, { status: 'new' })]
    montar()
    expect(await screen.findByText('1 sem responsável, o mais urgente primeiro')).toBeInTheDocument()

    const botao = screen.getByRole('button', { name: 'Pegar o próximo' })
    await waitFor(() => expect(botao).not.toHaveAttribute('aria-disabled'))
    fireEvent.click(botao)

    expect(await screen.findByText('detalhe do chamado')).toBeInTheDocument()
    expect(atribuicoes).toEqual([{ id: '7', corpo: null }])
  })

  it('sem nada para pegar, o botão diz por quê e não faz nada', async () => {
    montar()
    const dica = await screen.findByText('Nenhum chamado sem responsável agora')
    const botao = screen.getByRole('button', { name: 'Pegar o próximo' })
    expect(botao).toHaveAttribute('aria-disabled', 'true')
    expect(botao).toHaveAttribute('aria-describedby', dica.id)

    fireEvent.click(botao)
    expect(atribuicoes).toEqual([])
    expect(screen.queryByText('detalhe do chamado')).not.toBeInTheDocument()
  })

  it('mostra a fila de prioridade própria', async () => {
    montar()
    expect(await screen.findByText('Seus próximos')).toBeInTheDocument()
    expect(await screen.findByText('Assunto 1')).toBeInTheDocument()
  })

  it('mostra o resumo "resolvidos hoje" com a variação', async () => {
    montar()
    expect(await screen.findByText('Resolvidos hoje')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText(/\+14%.*vs ontem/)).toBeInTheDocument()
  })

  it('ainda mostra a faixa de KPI de sempre', async () => {
    montar()
    expect(await screen.findByText('Não resolvidos')).toBeInTheDocument()
    expect(screen.getByText('Meus tickets')).toBeInTheDocument()
  })
})
