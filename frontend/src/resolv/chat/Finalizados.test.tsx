import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Finalizados } from './Finalizados'

/**
 * A aba "Finalizados" (item 2 do brief). O que estes testes protegem:
 * o encerrado aparece com o desfecho legível (motivo, quem encerrou, nota),
 * e TODO recorte vira parâmetro para o servidor — filtrar no navegador só
 * funcionaria na página já baixada, e esta lista cresce para sempre.
 */

function fechado(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    status: 'closed',
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
    closed_at: '2026-09-01T10:30:00Z',
    reopen_count: 0,
    close_reason: 1,
    close_reason_name: 'Resolvido',
    closed_automatically: false,
    closed_by_name: 'Samuel Suporte',
    timeout_converted: false,
    unread_count: 0,
    last_message_preview: 'obrigado!',
    rating: { service_score: 9, resolution_score: 8, justification: '', created_at: '' },
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  }
}

let encerrados: ReturnType<typeof fechado>[]
let buscas: string[]

const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })
const jsonDe = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  encerrados = [fechado(11), fechado(12, { client_name: 'Bruno', rating: null, close_reason_name: null })]
  buscas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/chat/close-reasons/') {
        return Promise.resolve(
          jsonDe(pagina([{ id: 1, name: 'Resolvido', slug: 'resolvido', requires_note: false, is_active: true, order: 0 }])),
        )
      }
      if (u.pathname === '/api/v1/users/') {
        return Promise.resolve(
          jsonDe(pagina([{ id: 3, full_name: 'Samuel Suporte', email: 's@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'available' }])),
        )
      }
      if (u.pathname === '/api/v1/chat/chats/') {
        buscas.push(u.search)
        return Promise.resolve(jsonDe(pagina(encerrados)))
      }
      return Promise.resolve(jsonDe(pagina([])))
    }),
  )
})

function montar(onSelecionar = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <Finalizados selecionado={null} onSelecionar={onSelecionar} />
    </QueryClientProvider>,
  )
  return onSelecionar
}

describe('Finalizados', () => {
  it('pede ao servidor só os encerrados, nunca a fila', async () => {
    montar()
    await waitFor(() => expect(buscas.length).toBeGreaterThan(0))
    expect(buscas[0]).toContain('status=closed')
  })

  it('mostra protocolo, motivo, quem encerrou e a nota do cliente', async () => {
    montar()
    expect(await screen.findByText('#11')).toBeInTheDocument()
    expect(screen.getByText('Resolvido')).toBeInTheDocument()
    // os dois cards são do mesmo agente — por isso `getAllByText`
    expect(screen.getAllByText('Samuel Suporte').length).toBeGreaterThan(0)
    expect(screen.getByText('9')).toBeInTheDocument()
  })

  it('quem não foi avaliado diz isso por extenso, não só por cor', async () => {
    montar()
    expect(await screen.findByText('sem avaliação')).toBeInTheDocument()
  })

  it('selecionar avisa quem abriu a lista', async () => {
    const onSelecionar = montar()
    fireEvent.click(await screen.findByText('#11'))
    expect(onSelecionar).toHaveBeenCalledWith(11)
  })

  it('a busca vira parâmetro do servidor', async () => {
    montar()
    await waitFor(() => expect(buscas.length).toBeGreaterThan(0))
    fireEvent.change(screen.getByLabelText('Buscar em finalizados'), {
      target: { value: 'nota fiscal' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(buscas.at(-1)).toContain('q=nota+fiscal'))
  })

  it('filtro de motivo e ordenação também são do servidor', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Filtros/ }))

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: '1' } })
    await waitFor(() => expect(buscas.at(-1)).toContain('reason=1'))

    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'duracao' } })
    await waitFor(() => expect(buscas.at(-1)).toContain('ordering=duracao'))
  })

  it('sem resultado, o vazio explica se foi filtro ou se não há nada', async () => {
    encerrados = []
    montar()
    expect(await screen.findByText('Nenhum atendimento encerrado ainda.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Buscar em finalizados'), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Nada encontrado com esses filtros.')).toBeInTheDocument()
  })

  it('limpar filtros devolve os campos ao estado inicial', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Filtros/ }))
    const motivo = screen.getByLabelText('Motivo') as HTMLSelectElement
    fireEvent.change(motivo, { target: { value: '1' } })
    await waitFor(() => expect(buscas.at(-1)).toContain('reason=1'))

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
    // o recorte anterior já está em cache, então voltar a ele não gera um
    // request novo (é o TanStack fazendo o certo) — o que se verifica aqui é
    // o ESTADO da tela: o seletor voltou a "Todos"
    await waitFor(() => expect(motivo.value).toBe(''))
  })
})
