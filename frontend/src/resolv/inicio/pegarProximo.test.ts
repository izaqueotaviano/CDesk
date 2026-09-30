import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Prioridade, TicketLinha } from '../tickets/tipos'
import { compararUrgencia, escolherProximo } from './pegarProximo'

function ticket(id: number, extra: { due?: string | null; priority?: Prioridade; created?: string } = {}): TicketLinha {
  return {
    id,
    reference: `T-${id}`,
    subject: `Assunto ${id}`,
    status: 'open',
    stage_name: 'Aberto',
    stage_color: '#888',
    priority: extra.priority ?? 'normal',
    source: 'web',
    requester_display: 'Cliente',
    company_name: 'Empresa',
    assignee_name: null,
    category_name: null,
    current_status_note: null,
    sla: {
      first_response: { due_at: null, state: 'none', minutes_left: null },
      resolution: { due_at: extra.due ?? null, state: extra.due ? 'ok' : 'none', minutes_left: null },
    },
    first_response_at: null,
    created_at: extra.created ?? '2026-09-01T10:00:00Z',
    is_restricted: false,
  }
}

describe('compararUrgencia', () => {
  it('prazo mais curto primeiro; sem prazo vai por último', () => {
    const lista = [
      ticket(1),
      ticket(2, { due: '2026-09-02T12:00:00Z' }),
      ticket(3, { due: '2026-09-02T09:00:00Z' }),
    ]
    expect([...lista].sort(compararUrgencia).map((t) => t.id)).toEqual([3, 2, 1])
  })

  it('mesmo prazo: prioridade mais alta, depois o mais antigo', () => {
    const due = '2026-09-02T12:00:00Z'
    const lista = [
      ticket(1, { due, priority: 'normal', created: '2026-09-01T08:00:00Z' }),
      ticket(2, { due, priority: 'urgent', created: '2026-09-01T11:00:00Z' }),
      ticket(3, { due, priority: 'urgent', created: '2026-09-01T09:00:00Z' }),
    ]
    expect([...lista].sort(compararUrgencia).map((t) => t.id)).toEqual([3, 2, 1])
  })
})

describe('escolherProximo', () => {
  let respostas: Record<string, TicketLinha[]>
  let pedidos: URLSearchParams[]

  beforeEach(() => {
    pedidos = []
    respostas = {}
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = new URL(String(url), 'http://x')
        pedidos.push(u.searchParams)
        const chave = [u.searchParams.get('ordering'), u.searchParams.get('priority')].filter(Boolean).join('|')
        const results = respostas[chave] ?? []
        return Promise.resolve(
          new Response(JSON.stringify({ count: results.length, next: null, previous: null, results }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        )
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('só olha sem responsável, novo ou aberto', async () => {
    await escolherProximo()
    expect(pedidos[0].get('assignee')).toBe('unassigned')
    expect(pedidos[0].get('status')).toBe('new,open')
  })

  it('nada sem responsável: devolve null', async () => {
    expect(await escolherProximo()).toBeNull()
    expect(pedidos).toHaveLength(1)
  })

  it('com prazo, fica com o que vence primeiro, desempatando na página', async () => {
    const due = '2026-09-02T12:00:00Z'
    respostas['sla'] = [
      ticket(1, { due, priority: 'low' }),
      ticket(2, { due, priority: 'high' }),
      ticket(3, { due: '2026-09-03T12:00:00Z', priority: 'urgent' }),
      ticket(4),
    ]
    expect((await escolherProximo())?.id).toBe(2)
    // resolveu com um pedido só
    expect(pedidos).toHaveLength(1)
  })

  it('sem prazo em ninguém: a prioridade mais alta e, dentro dela, o mais antigo', async () => {
    respostas['sla'] = [ticket(1, { priority: 'normal' }), ticket(2, { priority: 'high' })]
    respostas['-urgencia'] = [ticket(2, { priority: 'high', created: '2026-09-05T10:00:00Z' })]
    respostas['criado|high'] = [ticket(9, { priority: 'high', created: '2026-08-01T10:00:00Z' })]

    expect((await escolherProximo())?.id).toBe(9)
    expect(pedidos.map((p) => p.get('ordering'))).toEqual(['sla', '-urgencia', 'criado'])
    expect(pedidos[2].get('priority')).toBe('high')
  })
})
