import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaImportar } from './AbaImportar'

const ROTA = '/api/v1/ferramentas/importacao-movidesk/'

const job = (extra: Record<string, unknown> = {}) => ({
  id: 7, status: 'rodando', status_label: 'Em andamento', etapa: 'Baixando /tickets — página 2', progresso: null,
  log: [{ t: '2026-09-10T15:00:01', nivel: 'info', msg: '/tickets: página 1 — 200 recebidos, 200 novos' }],
  erro: '', created_at: '2026-09-10T15:00:00Z', started_at: '2026-09-10T15:00:00Z', finished_at: null,
  requested_by_name: 'Alice', team: 1, team_name: 'Suporte', plan: 2, plan_name: 'Gold', limite: 50,
  apenas_baixar: false, arquivo_url: null, tickets_baixados: 0, tickets_criados: 0, tickets_atualizados: 0,
  tickets_ignorados: 0, mensagens_importadas: 0, avisos: [],
  ...extra,
})

let chamadas: { url: string; metodo: string; corpo: unknown }[]
let emAndamento: ReturnType<typeof job> | null
let tokenNoServidor: boolean

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  emAndamento = null
  tokenNoServidor = false
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/settings/teams/') return Promise.resolve(jsonDe([{ id: 1, name: 'Suporte', is_active: true }]))
      if (u.pathname === '/api/v1/settings/plans/') return Promise.resolve(jsonDe([{ id: 2, name: 'Gold', is_active: true }]))
      if (u.pathname === ROTA && metodo === 'GET') return Promise.resolve(jsonDe({ em_andamento: emAndamento, recentes: emAndamento ? [emAndamento] : [], token_no_servidor: tokenNoServidor }))
      if (u.pathname === ROTA && metodo === 'POST') {
        emAndamento = job()
        return Promise.resolve(jsonDe(job({ status: 'pendente', status_label: 'Na fila', log: [] }), 201))
      }
      if (u.pathname.endsWith('/cancelar/')) {
        emAndamento = job({ status: 'cancelado', status_label: 'Cancelado' })
        return Promise.resolve(jsonDe(emAndamento))
      }
      return Promise.resolve(jsonDe({ detail: 'sem rota' }, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaImportar />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AbaImportar', () => {
  it('sem token em lugar nenhum, o botão fica travado; digitar destrava', async () => {
    montar()
    const botao = await screen.findByRole('button', { name: 'Importar' })
    expect(botao).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Token da API do Movidesk'), { target: { value: 'abc' } })
    expect(botao).toBeEnabled()
  })

  it('dispara com os campos certos, mostra o andamento e deixa cancelar', async () => {
    montar()
    await screen.findByRole('button', { name: 'Importar' })
    fireEvent.change(screen.getByLabelText('Token da API do Movidesk'), { target: { value: 'abc' } })
    fireEvent.change(screen.getByLabelText('Quantos tickets'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Importar' }))

    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)).toBeTruthy())
    const post = chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)!
    expect(post.corpo).toEqual({ token: 'abc', team: 1, limite: 50, apenas_baixar: false })

    // o polling traz o trabalho em andamento: etapa + log + cancelar
    expect(await screen.findByText('Importação em andamento')).toBeInTheDocument()
    expect(screen.getByText(/página 1 — 200 recebidos/)).toBeInTheDocument()
    expect(screen.getByText('Baixando /tickets — página 2')).toBeInTheDocument()
    // enquanto roda, não dá pra disparar outra
    expect(screen.getByRole('button', { name: 'Importar' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === `${ROTA}7/cancelar/` && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('Cancelado')).toBeInTheDocument()
  })

  it('com o token no servidor, o campo pode ficar vazio e o POST não manda token', async () => {
    tokenNoServidor = true
    montar()
    const botao = await screen.findByRole('button', { name: 'Importar' })
    expect(botao).toBeEnabled()
    fireEvent.click(botao)
    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)).toBeTruthy())
    const corpo = chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)!.corpo as Record<string, unknown>
    expect(corpo).not.toHaveProperty('token')
    expect(corpo.limite).toBeNull()
  })

  it('"só baixar" vai no pedido e muda o rótulo do botão', async () => {
    montar()
    await screen.findByRole('button', { name: 'Importar' })
    fireEvent.change(screen.getByLabelText('Token da API do Movidesk'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Só baixar o JSON/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Baixar' }))
    await waitFor(() => expect(chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)).toBeTruthy())
    expect((chamadas.find((c) => c.metodo === 'POST' && c.url === ROTA)!.corpo as { apenas_baixar: boolean }).apenas_baixar).toBe(true)
  })
})
