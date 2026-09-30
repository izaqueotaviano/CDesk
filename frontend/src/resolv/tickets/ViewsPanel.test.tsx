import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewsPanel } from './ViewsPanel'

const RESUMO = {
  visoes: {
    'meus-nao-resolvidos': 7,
    'aguardando-voce': 3,
    todos: 812,
    'sem-atendimento': 5,
    'nao-resolvidos': 61,
    'em-kanban': 2,
    'nao-atribuidos': 40,
    resolvidos: 0,
    internos: 4,
    'mencionam-voce': 1,
  },
  abertos: { total: 61, hoje: 9, variacao_dia: 2 },
  nao_atribuidos: { total: 40, espera_mais_longa_min: 38 },
  sla_em_risco: { total: 3, estouram_em_1h: 1, por_plano: [] },
  meus: { total: 7, aguardando_voce: 3 },
  resolvidos_hoje: { total: 12, media_resolucao_min: 95 },
}

const PESSOAIS = [
  { id: 4, name: 'Acme urgentes', position: 0, count: 3, filters: { priority: 'urgent' } },
  { id: 5, name: 'Bravo sem dono', position: 1, count: 0, filters: { assignee: 'unassigned' } },
]

let resumoResponde: () => Response
let pessoaisResponde: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  resumoResponde = () => jsonDe(RESUMO)
  pessoaisResponde = () => jsonDe(PESSOAIS)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/tickets/resumo/') return Promise.resolve(resumoResponde())
      if (u.pathname === '/api/v1/ticket-views/') return Promise.resolve(pessoaisResponde())
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** jsdom não implementa `matchMedia` — simula a consulta de largura que o
 *  painel faz, pra testar o padrão de quem nunca clicou em recolher. */
function estadoDaJanela(estreita: boolean) {
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: estreita,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function props(extra: Partial<Parameters<typeof ViewsPanel>[0]> = {}) {
  return {
    ativa: 'nao-resolvidos',
    ativaPessoal: null,
    onSelecionar: vi.fn(),
    onSelecionarPessoal: vi.fn(),
    onPersonalizar: vi.fn(),
    ...extra,
  }
}

function montar(extra: Partial<Parameters<typeof ViewsPanel>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const p = props(extra)
  const r = render(
    <QueryClientProvider client={client}>
      <ViewsPanel {...p} />
    </QueryClientProvider>,
  )
  return { ...p, unmount: r.unmount }
}

describe('ViewsPanel — contagem das visões do sistema', () => {
  it('mostra o número de cada gaveta, e zero é diferente de cheio', async () => {
    montar()

    await screen.findByText('40')
    expect(screen.getByRole('button', { name: /Tickets não atribuídos/ })).toHaveTextContent('40')
    expect(screen.getByRole('button', { name: /Tickets resolvidos/ })).toHaveTextContent('0')
  })

  it('pede o resumo uma vez só, não uma chamada por gaveta', async () => {
    montar()

    await screen.findByText('40')
    const chamadas = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
      String(c[0]).includes('/tickets/resumo/'),
    )
    expect(chamadas).toHaveLength(1)
  })

  it('"Tickets prioritários" fica sem número em vez de emprestar o de outra visão', async () => {
    montar()

    await screen.findByText('40')
    expect(screen.getByRole('button', { name: 'Tickets prioritários' }).textContent).toBe(
      'Tickets prioritários',
    )
  })

  it('a espera mais longa da fila sem dono vira contexto no title', async () => {
    montar()

    await screen.findByText('40')
    expect(screen.getByRole('button', { name: /Tickets não atribuídos/ })).toHaveAttribute(
      'title',
      'O mais antigo espera há 38min',
    )
  })

  it('quando o resumo falha, avisa — não desenha as gavetas como se fossem zero', async () => {
    resumoResponde = () => jsonDe({ detail: 'erro' }, 500)
    montar()

    expect(await screen.findByText('Contagens indisponíveis agora.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tickets não atribuídos' })).toBeInTheDocument()
  })
})

describe('ViewsPanel — visões oferecidas', () => {
  it('"Aguardando você" abre a view do servidor que separa a bola de quem', async () => {
    const { onSelecionar } = montar()

    fireEvent.click(screen.getByRole('button', { name: /Aguardando você/ }))

    await waitFor(() =>
      expect(onSelecionar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'aguardando-voce', view: 'aguardando-voce' }),
      ),
    )
  })

  it('oferece "Mencionam você", com contagem, agora que o compositor sabe mencionar', async () => {
    montar()

    await screen.findByText('40') // resumo carregado
    expect(screen.getByRole('button', { name: /Mencionam você/ })).toHaveTextContent('1')
  })

  it('item 24: o rótulo diz o filtro real (prazo no quadro), não "estar no kanban"', () => {
    montar()

    expect(screen.getByRole('button', { name: /Com prazo no quadro/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Kanban/ })).not.toBeInTheDocument()
  })
})

describe('ViewsPanel — visualizações pessoais', () => {
  it('lista as visões do servidor com contagem — nada de entradas de mentira', async () => {
    const { onSelecionarPessoal } = montar()

    const acme = await screen.findByRole('button', { name: /Acme urgentes/ })
    expect(acme).toHaveTextContent('3')
    expect(screen.queryByText('Next Store')).not.toBeInTheDocument()
    expect(screen.queryByText('Mix Lar')).not.toBeInTheDocument()

    fireEvent.click(acme)
    expect(onSelecionarPessoal).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))
  })

  it('a pessoal ativa é a marcada, e nenhuma do sistema', async () => {
    montar({ ativaPessoal: 5 })

    expect(await screen.findByRole('button', { name: /Bravo sem dono/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(
      screen.getByRole('button', { name: /Todos os tickets não resolvidos/ }),
    ).not.toHaveAttribute('aria-current')
  })

  it('"Personalizar visualizações" funciona (abre o gerenciador)', async () => {
    const { onPersonalizar } = montar()

    fireEvent.click(await screen.findByRole('button', { name: 'Personalizar visualizações' }))
    expect(onPersonalizar).toHaveBeenCalled()
  })

  it('sem nenhuma pessoal, ensina como criar em vez de mostrar uma lista vazia', async () => {
    pessoaisResponde = () => jsonDe([])
    montar()

    expect(await screen.findByText(/use “Salvar visão”/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Personalizar visualizações' }),
    ).not.toBeInTheDocument()
  })

  it('o campo "Filtrar visualizações" filtra as duas listas, sem ligar para acento', async () => {
    montar()
    await screen.findByRole('button', { name: /Acme urgentes/ })

    fireEvent.change(screen.getByLabelText('Filtrar visualizações'), {
      target: { value: 'nao atribu' },
    })

    expect(screen.getByRole('button', { name: /Tickets não atribuídos/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Aguardando você/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Acme urgentes/ })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filtrar visualizações'), { target: { value: 'acme' } })
    expect(screen.getByRole('button', { name: /Acme urgentes/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Filtrar visualizações'), { target: { value: 'zzz' } })
    expect(screen.getByText('Nenhuma visualização com esse nome.')).toBeInTheDocument()
  })
})

describe('ViewsPanel — recolher o painel', () => {
  it('recolher esconde a lista e oferece expandir de novo', async () => {
    montar()
    await screen.findByText('40')

    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel' }))

    expect(screen.queryByRole('button', { name: /Aguardando você/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar visualizações')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expandir painel de visualizações' }))

    expect(await screen.findByRole('button', { name: /Aguardando você/ })).toBeInTheDocument()
  })

  it('a escolha de recolher persiste (localStorage) — sobrevive a uma nova montagem', async () => {
    const primeira = montar()
    await screen.findByText('40')
    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel' }))
    primeira.unmount()

    montar()
    expect(
      screen.getByRole('button', { name: 'Expandir painel de visualizações' }),
    ).toBeInTheDocument()
  })

  it('janela estreita começa recolhida quando ninguém escolheu ainda', () => {
    estadoDaJanela(true)
    montar()
    expect(
      screen.getByRole('button', { name: 'Expandir painel de visualizações' }),
    ).toBeInTheDocument()
  })

  it('escolha explícita de expandir vence a janela estreita', async () => {
    estadoDaJanela(true)
    localStorage.setItem('resolv-fila-painel-recolhido', 'nao')
    montar()
    expect(await screen.findByRole('button', { name: /Aguardando você/ })).toBeInTheDocument()
  })
})
