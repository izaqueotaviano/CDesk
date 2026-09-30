import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoFranquias } from './SecaoFranquias'

const ME = {
  id: 4,
  full_name: 'Ana Almeida',
  email: 'ana@acme.test',
  company_name: 'Acme Marketing',
  is_internal: false,
  is_admin: false,
  teams: [],
  permissions: [],
  quota: { used: 3, limit: 10, period_start: '2026-09-01', period_end: '2026-09-30' },
}

const MANUTENCAO = { used_minutes: 330, limit_minutes: 500, period_start: '2026-09-01', period_end: '2026-09-30' }

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let respostaManutencao: () => Response

beforeEach(() => {
  respostaManutencao = () => jsonDe(MANUTENCAO)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/maintenance/') return Promise.resolve(respostaManutencao())
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecaoFranquias />
    </QueryClientProvider>,
  )
}

describe('SecaoFranquias', () => {
  it('mostra a cota de tickets e a franquia de manutenção lado a lado', async () => {
    montar()
    // o número usado fica em <span> dentro do <p>, então o texto do rótulo
    // some por trás de "Chamados" até o parágrafo carregar — daí o textContent
    // do elemento inteiro, não `findByText` de string exata.
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === '3 de 10 usados')).toBeInTheDocument()
    // 330 min = 5h30, 500 min = 8h20 — mesma leitura do backend
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === '5h30 de 8h20 usados')).toBeInTheDocument()
    expect(screen.getByText('Tickets')).toBeInTheDocument()
    expect(screen.getByText('Manutenção')).toBeInTheDocument()
  })

  it('sem limite de manutenção no plano: mostra a mensagem em vez da barra', async () => {
    respostaManutencao = () => jsonDe({ ...MANUTENCAO, limit_minutes: null })
    montar()
    expect(await screen.findByText('Sem limite neste plano.')).toBeInTheDocument()
  })

  it('erro ao carregar a manutenção mostra o alerta com Tentar de novo', async () => {
    respostaManutencao = () => jsonDe({ detail: 'falhou' }, 500)
    montar()
    expect(await screen.findByText('Não foi possível carregar a franquia de manutenção')).toBeInTheDocument()
  })
})
