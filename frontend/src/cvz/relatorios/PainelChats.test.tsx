import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PainelChats } from './PainelChats'

let chamadas: { url: string; search: string; metodo: string }[]

const ESTATISTICAS = {
  period: { key: 'month', label: 'Este mês' },
  by_agent: [
    { agent_id: 9, agent_name: 'Bruno', value: 6, variation: 50 },
    { agent_id: 11, agent_name: 'Ana', value: 3, variation: null },
    { agent_id: null, label: 'Total', value: 9, variation: 50, is_total: true },
  ],
  granularity: 'day',
  timeline: [
    { bucket: '2026-09-04', count: 2 },
    { bucket: '2026-09-05', count: 3 },
    { bucket: '2026-09-06', count: 4 },
  ],
}

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search, metodo: init?.method ?? 'GET' })
      if (u.pathname === '/api/v1/reports/chats/') return Promise.resolve(jsonDe(ESTATISTICAS))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <PainelChats />
    </QueryClientProvider>,
  )
}

describe('PainelChats', () => {
  it('mostra a tabela por agente com os valores certos', async () => {
    montar()
    // "Bruno"/"Ana" também aparecem como opção do Select "Agente" — escopar
    // por célula da tabela evita a ambiguidade entre os dois lugares
    const celulaBruno = await screen.findByRole('cell', { name: 'Bruno' })
    expect(celulaBruno).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Ana' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Total' })).toBeInTheDocument()

    const linhaBruno = celulaBruno.closest('tr')!
    expect(within(linhaBruno).getByText('6')).toBeInTheDocument()
    expect(within(linhaBruno).getByText('+50%')).toBeInTheDocument()
    // escopado na linha: o gráfico logo abaixo também escreve números (eixo
    // e tabela de apoio)
    const linhaAna = screen.getByRole('cell', { name: 'Ana' }).closest('tr')!
    expect(within(linhaAna).getByText('3')).toBeInTheDocument() // sem variação: nenhum selo
    expect(within(linhaAna).queryByText(/%$/)).toBeNull()
    const linhaTotal = screen.getByRole('cell', { name: 'Total' }).closest('tr')!
    expect(within(linhaTotal).getByText('9')).toBeInTheDocument()
  })

  it('a primeira chamada já sai com period= e granularity= padrão', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Bruno' })
    const chamada = chamadas.find((c) => c.url === '/api/v1/reports/chats/')
    expect(chamada?.search).toContain('period=month')
    expect(chamada?.search).toContain('granularity=day')
  })

  it('trocar o período refaz a chamada com o period= novo', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Bruno' })
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/chats/' && c.search.includes('period=today'))).toBe(true))
  })

  it('trocar a granularidade refaz a chamada com granularity= novo', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Bruno' })
    fireEvent.click(screen.getByRole('button', { name: 'Hora' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/chats/' && c.search.includes('granularity=hour'))).toBe(true))
  })

  it('filtrar por agente manda agent= na chamada da timeline', async () => {
    montar()
    await screen.findByRole('cell', { name: 'Bruno' })
    fireEvent.change(screen.getByLabelText('Agente'), { target: { value: '9' } })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/reports/chats/' && c.search.includes('agent=9'))).toBe(true))
  })
})
