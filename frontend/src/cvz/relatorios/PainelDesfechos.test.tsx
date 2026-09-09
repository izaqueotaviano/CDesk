import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PainelDesfechos } from './PainelDesfechos'

/**
 * A aba "Desfechos". O que estes testes protegem é sobretudo o que a tela
 * NÃO pode esconder: a mediana ao lado da média (é o par que denuncia o
 * outlier) e quantas pessoas deixaram de avaliar (uma média 9 sobre 5% dos
 * atendimentos não é uma média 9).
 */

const RESPOSTA = {
  periodo: { desde: '2026-08-10T00:00:00Z', ate: '2026-09-09T00:00:00Z' },
  total: 10,
  atendidos: 8,
  nao_atendidos: 2,
  encerrados_automaticamente: 1,
  reabertos: 3,
  espera_minutos: { media: 102.5, mediana: 2 },
  duracao_minutos: { media: 14, mediana: 12 },
  avaliacao: {
    respondidas: 2,
    sem_resposta: 6,
    media_atendimento: 9,
    media_resolucao: 8.5,
    detratoras: 1,
  },
  por_motivo: [
    { id: 1, nome: 'Resolvido', total: 7 },
    { id: null, nome: 'Sem motivo', total: 3 },
  ],
  por_agente: [
    { id: 3, nome: 'Samuel Suporte', total: 6, media_nota: 9, duracao_media: 12 },
  ],
  por_dia: [{ dia: '2026-09-01', total: 4 }],
}

let corpo: unknown
let buscas: string[]

const jsonDe = (b: unknown) =>
  new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  corpo = RESPOSTA
  buscas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      buscas.push(u.search)
      return Promise.resolve(jsonDe(corpo))
    }),
  )
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <PainelDesfechos />
    </QueryClientProvider>,
  )
}

describe('PainelDesfechos', () => {
  it('mostra a mediana ao lado da média — é o par que denuncia o outlier', async () => {
    montar()
    expect(await screen.findByText(/mediana 2min/)).toBeInTheDocument()
  })

  it('diz quantas pessoas NÃO avaliaram', async () => {
    montar()
    // 2 de 8 avaliaram: a média 9 sozinha esconderia isso
    expect(await screen.findByText('2 de 8 avaliaram')).toBeInTheDocument()
    expect(screen.getByText('Sem avaliação')).toBeInTheDocument()
  })

  it('lista os motivos com a fatia de cada um, "Sem motivo" incluído', async () => {
    montar()
    const linha = (await screen.findByText('Resolvido')).closest('tr')!
    expect(within(linha).getByText('70%')).toBeInTheDocument()
    // se metade dos encerramentos não tem motivo, é isso que a tela mostra
    expect(screen.getByText('Sem motivo')).toBeInTheDocument()
  })

  it('separa quem nunca foi atendido do que foi', async () => {
    montar()
    await screen.findByText('Encerrados')
    const nunca = screen.getByText('Nunca atendidos').closest('div')!
    expect(within(nunca).getByText('2')).toBeInTheDocument()
  })

  it('mostra automáticos e reabertos', async () => {
    montar()
    await screen.findByText('Encerrados')
    expect(
      within(screen.getByText('Encerrados pelo sistema').closest('div')!).getByText('1'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByText('Reabertos').closest('div')!).getByText('3'),
    ).toBeInTheDocument()
  })

  it('trocar o período vira parâmetro do servidor', async () => {
    montar()
    await screen.findByText('Encerrados')
    fireEvent.change(screen.getByLabelText('De'), { target: { value: '2026-01-01' } })
    await waitFor(() => expect(buscas.at(-1)).toContain('desde=2026-01-01'))
  })

  it('sem atendimento no período, explica em vez de mostrar zeros', async () => {
    corpo = { ...RESPOSTA, total: 0 }
    montar()
    expect(
      await screen.findByText('Nenhum atendimento encerrado no período'),
    ).toBeInTheDocument()
  })

  it('deixa claro que o recorte é por encerramento', async () => {
    montar()
    expect(await screen.findByText(/é quando as medidas de duração/)).toBeInTheDocument()
  })
})
