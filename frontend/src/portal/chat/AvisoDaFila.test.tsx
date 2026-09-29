import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssinanteSala } from '@/realtime/salaChat'
import { Conversa } from './Conversa'
import { tempoEstimado, textoDaFila } from './fila'

// a conversa fala com a sala por dois caminhos: o hook da conversa (mockado
// inteiro) e o ouvinte da fila, que entra na MESMA sala pelo registro — é
// esse ouvinte que o teste captura para simular a fila andando
const assinantes: AssinanteSala[] = []
vi.mock('@/realtime/salaChat', () => ({
  entrarNaSala: (_id: number, a: AssinanteSala) => {
    assinantes.push(a)
    return { enviar: vi.fn(), sair: vi.fn() }
  },
}))
vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({ status: 'aberto', digitando: null, erro: null, enviarMensagem: vi.fn(), enviarDigitando: vi.fn(), confirmarEntrega: vi.fn() }),
}))

const POSICAO = { position: 2, ahead: 1, estimated_wait_minutes: 4, queue_open: true, queue_opens_at: null }

let chatAtual: Record<string, unknown>

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  assinantes.length = 0
  chatAtual = {
    id: 7,
    status: 'queued',
    name: '',
    agent_name: null,
    agent_avatar: null,
    agent_presence: null,
    queued_at: '2026-09-01T10:00:00Z',
    accepted_at: null,
    closed_at: null,
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    unread_count: 0,
    queue_position: POSICAO,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/chat/chats/7/') return Promise.resolve(jsonDe(chatAtual))
      if (u.pathname === '/api/v1/chat/config/') {
        return Promise.resolve(jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: true, queue_opens_at: null }))
      }
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <Conversa chatId={7} />
    </QueryClientProvider>,
  )
}

describe('textoDaFila', () => {
  it('diz a posição e a estimativa', () => {
    expect(textoDaFila(POSICAO)).toEqual({ titulo: 'Você é o 2º da fila', detalhe: 'Tempo estimado: cerca de 4 min', fechada: false })
  })

  it('o primeiro é "o próximo", e sem base não inventa número', () => {
    expect(textoDaFila({ ...POSICAO, position: 1, ahead: 0, estimated_wait_minutes: null })).toEqual({
      titulo: 'Você é o próximo da fila',
      detalhe: null,
      fechada: false,
    })
  })

  it('fila fechada: diz quando volta e que a conversa continua na fila', () => {
    const t = textoDaFila({ ...POSICAO, queue_open: false, estimated_wait_minutes: null, queue_opens_at: '2026-09-02T11:00:00Z' })
    expect(t.fechada).toBe(true)
    expect(t.titulo).toBe('Fora do horário de atendimento')
    expect(t.detalhe).toMatch(/^Sua conversa continua na fila e está em 2º lugar\. O atendimento volta em 02\/09\/2026/)
  })

  it('tempo por extenso', () => {
    expect(tempoEstimado(4)).toBe('cerca de 4 min')
    expect(tempoEstimado(60)).toBe('cerca de 1 h')
    expect(tempoEstimado(80)).toBe('cerca de 1 h 20 min')
  })
})

describe('Conversa na fila', () => {
  it('mostra a posição e atualiza ao vivo quando a fila anda', async () => {
    montar()
    expect(await screen.findByText('Você é o 2º da fila.')).toBeInTheDocument()
    expect(screen.getByText('Tempo estimado: cerca de 4 min')).toBeInTheDocument()

    // alguém da frente foi atendido: o servidor manda a nova posição pela sala
    act(() => {
      for (const a of assinantes) {
        a.onEvento({ type: 'queue_position', chat_id: 7, position: 1, ahead: 0, estimated_wait_minutes: 2, queue_open: true, queue_opens_at: null })
      }
    })
    expect(await screen.findByText('Você é o próximo da fila.')).toBeInTheDocument()
    expect(screen.getByText('Tempo estimado: cerca de 2 min')).toBeInTheDocument()
  })

  it('ignora posição de outro chat', async () => {
    montar()
    await screen.findByText('Você é o 2º da fila.')
    act(() => {
      for (const a of assinantes) {
        a.onEvento({ type: 'queue_position', chat_id: 99, position: 1, ahead: 0, estimated_wait_minutes: 1, queue_open: true, queue_opens_at: null })
      }
    })
    expect(screen.getByText('Você é o 2º da fila.')).toBeInTheDocument()
  })

  it('backend sem posição: fica no "Aguardando um atendente" de sempre', async () => {
    chatAtual = { ...chatAtual, queue_position: undefined }
    montar()
    expect(await screen.findByText('Aguardando um atendente')).toBeInTheDocument()
    expect(screen.queryByText(/da fila/)).not.toBeInTheDocument()
  })

  it('em atendimento não mostra fila nem entra na sala por ela', async () => {
    chatAtual = { ...chatAtual, status: 'active', agent_name: 'Samuel Suporte', queue_position: null }
    montar()
    expect(await screen.findByText('Você está falando com Samuel Suporte')).toBeInTheDocument()
    expect(screen.queryByText(/da fila/)).not.toBeInTheDocument()
    expect(assinantes).toHaveLength(0)
  })
})
