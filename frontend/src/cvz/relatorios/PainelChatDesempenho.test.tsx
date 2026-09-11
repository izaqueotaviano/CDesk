import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PainelChatDesempenho } from './PainelChatDesempenho'

let chamadas: { url: string; search: string }[]

const POR_EMPRESA = [
  {
    rotulo: 'Acme', total: 10, fechados: 8, convertidos: 2, nao_atendidos: 1,
    nota_atendimento: 9.2, nota_resolucao: 8.5,
    espera_media_minutos: 5, atendimento_medio_minutos: 12,
  },
]

const POR_AGENTE = [
  {
    rotulo: 'Bruno', total: 6, fechados: 6, convertidos: 0, nao_atendidos: 0,
    nota_atendimento: 9, nota_resolucao: 9, nota_do_agente: 8,
    espera_media_minutos: 3, atendimento_medio_minutos: 10,
  },
]

const POR_NOTA = [{ rotulo: 9, quantidade: 4, nota_resolucao: 8.7 }]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/chat/reports/') {
        const eixo = u.searchParams.get('by')
        if (eixo === 'agent') return Promise.resolve(jsonDe(POR_AGENTE))
        if (eixo === 'score') return Promise.resolve(jsonDe(POR_NOTA))
        return Promise.resolve(jsonDe(POR_EMPRESA))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PainelChatDesempenho />
    </QueryClientProvider>,
  )
}

describe('PainelChatDesempenho', () => {
  it('a primeira chamada já sai com by=company e mostra a linha', async () => {
    montar()
    const celulaAcme = await screen.findByRole('cell', { name: 'Acme' })
    expect(celulaAcme).toBeInTheDocument()
    expect(screen.getByText('Por empresa')).toBeInTheDocument()

    const linha = celulaAcme.closest('tr')!
    expect(within(linha).getByText('10')).toBeInTheDocument()     // total
    expect(within(linha).getByText('9.2')).toBeInTheDocument()    // nota de atendimento
    expect(within(linha).getByText('5min')).toBeInTheDocument()   // espera média

    const chamada = chamadas.find((c) => c.url === '/api/v1/chat/reports/')
    expect(chamada?.search).toContain('by=company')
  })

  it('trocar para "Agente" refaz a chamada com by=agent e mostra a autoavaliação', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Acme' })
    fireEvent.click(screen.getByRole('button', { name: 'Agente' }))

    const celulaBruno = await screen.findByRole('cell', { name: 'Bruno' })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/reports/' && c.search.includes('by=agent'))).toBe(true))
    const linha = celulaBruno.closest('tr')!
    expect(within(linha).getByText('8.0')).toBeInTheDocument() // nota_do_agente, só existe no eixo agent
  })

  it('trocar para "Nota" refaz a chamada com by=score e mostra a contagem por nota', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Acme' })
    fireEvent.click(screen.getByRole('button', { name: 'Nota' }))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/reports/' && c.search.includes('by=score'))).toBe(true))
    expect(await screen.findByRole('cell', { name: '9' })).toBeInTheDocument()
    expect(screen.getByText('Por nota')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument() // quantidade de conversas com nota 9
  })
})
