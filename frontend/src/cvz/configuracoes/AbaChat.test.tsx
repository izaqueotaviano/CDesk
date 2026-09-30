import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaChat } from './AbaChat'

/** O que o ChatConfigSerializer devolve pra interno, com os defaults do model. */
const CONFIG = {
  welcome_message: 'Olá {{nome_do_cliente}}, como podemos ajudar?',
  queue_timeout_minutes: 10,
  max_chats_per_agent: 3,
  score_min: 0,
  score_max: 10,
  low_score_threshold: 5,
  default_team: null,
  default_team_name: null,
  queue_open: true,
  queue_opens_at: null,
}

let chamadas: { url: string; metodo: string; corpo: unknown }[]
let respostaDoPut: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  respostaDoPut = () => jsonDe({ ...CONFIG, max_chats_per_agent: 5 })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (u.pathname === '/api/v1/settings/teams/') return Promise.resolve(jsonDe([{ id: 2, name: 'Suporte', slug: 'suporte', is_active: true }]))
      if (u.pathname === '/api/v1/chat/config/') return Promise.resolve(metodo === 'GET' ? jsonDe(CONFIG) : respostaDoPut())
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaChat />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const escritas = () => chamadas.filter((c) => c.metodo === 'PUT')

describe('AbaChat', () => {
  it('mostra o teto de atendimentos simultâneos vindo do servidor', async () => {
    montar()
    expect(await screen.findByLabelText('Atendimentos simultâneos por agente')).toHaveValue(3)
  })

  it('salvar manda só o campo que mudou', async () => {
    montar()
    fireEvent.change(await screen.findByLabelText('Atendimentos simultâneos por agente'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(escritas()).toHaveLength(1))
    expect(escritas()[0].url).toBe('/api/v1/chat/config/')
    expect(escritas()[0].corpo).toEqual({ max_chats_per_agent: 5 })
  })

  it('escala invertida não chega na API', async () => {
    montar()
    fireEvent.change(await screen.findByLabelText('Nota máxima'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText('O máximo da escala precisa ser maior que o mínimo.')).toBeInTheDocument()
    expect(escritas()).toHaveLength(0)
  })

  it('equipe do chamado automático vem da lista de equipes e vai como id', async () => {
    montar()
    const select = await screen.findByLabelText('Equipe do ticket automático')
    await screen.findByRole('option', { name: 'Suporte' })
    fireEvent.change(select, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(escritas()).toHaveLength(1))
    expect(escritas()[0].corpo).toEqual({ default_team: 2 })
  })

  it('pousa o erro do backend no campo que ele nomeia', async () => {
    respostaDoPut = () => jsonDe({ low_score_threshold: ['O gatilho da justificativa precisa caber na escala.'] }, 400)
    montar()
    fireEvent.change(await screen.findByLabelText('Justificativa obrigatória abaixo de'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    expect(await screen.findByText('O gatilho da justificativa precisa caber na escala.')).toBeInTheDocument()
  })
})
