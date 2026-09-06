import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoAcessos } from './SecaoAcessos'

const HISTORICO = {
  events: [
    { kind: 'login', kind_label: 'Login', ip: '203.0.113.5', browser: 'Chrome · Windows', created_at: '2026-09-05T12:00:00Z', success: true },
    { kind: 'login_failed', kind_label: 'Login falhou', ip: '203.0.113.9', browser: 'Desconhecido', created_at: '2026-09-04T09:00:00Z', success: false },
  ],
  logins: [],
  sessions: [
    { key: 'atual', browser: 'Chrome · Windows', ip: '203.0.113.5', user_agent: 'UA', started_at: '2026-09-06T00:00:00Z', expires_at: '2026-09-06T12:00:00Z', current: true },
    { key: 'outra', browser: 'Safari · iOS', ip: '203.0.113.7', user_agent: 'UA2', started_at: '2026-09-05T00:00:00Z', expires_at: '2026-09-06T00:00:00Z', current: false },
  ],
  session_limit: 3,
}

let chamadas: { url: string; metodo: string }[]
let respostaHistorico: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  respostaHistorico = () => jsonDe(HISTORICO)
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/me/access-history/') return Promise.resolve(respostaHistorico())
      if (u.pathname.startsWith('/api/v1/me/sessions/') && metodo === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecaoAcessos />
    </QueryClientProvider>,
  )
}

describe('SecaoAcessos', () => {
  it('lista sessões vivas, marca a atual e mostra a atividade recente', async () => {
    montar()
    expect(await screen.findByText('Chrome · Windows')).toBeInTheDocument()
    expect(screen.getByText('Este dispositivo')).toBeInTheDocument()
    expect(screen.getByText('Safari · iOS')).toBeInTheDocument()
    expect(screen.getByText('2 de 3 no máximo')).toBeInTheDocument()

    expect(screen.getByText('Login')).toBeInTheDocument()
    expect(screen.getByText('Login falhou')).toBeInTheDocument()
  })

  it('a sessão atual não tem botão de encerrar; as outras têm', async () => {
    montar()
    await screen.findByText('Chrome · Windows')
    expect(screen.getAllByRole('button', { name: 'Encerrar' })).toHaveLength(1)
  })

  it('encerrar uma sessão pede confirmação e chama o DELETE certo', async () => {
    montar()
    await screen.findByText('Safari · iOS')
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }))
    await waitFor(() =>
      expect(chamadas.some((c) => c.url === '/api/v1/me/sessions/outra/' && c.metodo === 'DELETE')).toBe(true),
    )
  })

  it('erro ao carregar mostra o alerta com Tentar de novo', async () => {
    respostaHistorico = () => jsonDe({ detail: 'falhou' }, 500)
    montar()
    expect(await screen.findByText('Não foi possível carregar as sessões')).toBeInTheDocument()
  })
})
