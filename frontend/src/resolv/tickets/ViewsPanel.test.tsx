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
    'mencionam-voce': 0,
  },
  abertos: { total: 61, hoje: 9, variacao_dia: 2 },
  nao_atribuidos: { total: 40, espera_mais_longa_min: 38 },
  sla_em_risco: { total: 3, estouram_em_1h: 1, por_plano: [] },
  meus: { total: 7, aguardando_voce: 3 },
  resolvidos_hoje: { total: 12, media_resolucao_min: 95 },
}

let resumoResponde: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  resumoResponde = () => jsonDe(RESUMO)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/tickets/resumo/') return Promise.resolve(resumoResponde())
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** jsdom não implementa `matchMedia` (mesma nota de BotaoTema.test.tsx) —
 *  simula a consulta de largura que `useJanelaEstreita` (ViewsPanel.tsx) faz,
 *  pra testar o padrão de quem nunca clicou no botão de recolher. */
function estadoDaJanela(estreita: boolean) {
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: estreita,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

function montar(onSelecionar = vi.fn(), ativa = 'nao-resolvidos') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ViewsPanel ativa={ativa} onSelecionar={onSelecionar} />
    </QueryClientProvider>,
  )
  return onSelecionar
}

describe('ViewsPanel — contagem das visões', () => {
  it('mostra o número de cada gaveta, e zero é diferente de cheio', async () => {
    montar()

    await screen.findByText('40')
    expect(screen.getByRole('button', { name: /Tickets não atribuídos/ })).toHaveTextContent('40')
    expect(screen.getByRole('button', { name: /Tickets Resolvidos/ })).toHaveTextContent('0')
  })

  it('pede o resumo uma vez só, não uma chamada por gaveta', async () => {
    montar()

    await screen.findByText('40')
    const chamadas = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((c) =>
      String(c[0]).includes('/tickets/resumo/'),
    )
    expect(chamadas).toHaveLength(1)
  })

  it('"Tickets Prioritário" fica sem número em vez de emprestar o de outra visão', async () => {
    montar()

    await screen.findByText('40')
    // o recorte dela (não resolvidos + urgente) não é uma visão salva, então
    // o resumo não tem esse número — e nenhum número é melhor que o errado
    expect(screen.getByRole('button', { name: 'Tickets Prioritário' }).textContent).toBe(
      'Tickets Prioritário',
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

describe('ViewsPanel — visões salvas oferecidas', () => {
  it('"Aguardando você" abre a view do servidor que separa a bola de quem', async () => {
    const onSelecionar = montar()

    fireEvent.click(screen.getByRole('button', { name: /Aguardando você/ }))

    await waitFor(() =>
      expect(onSelecionar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'aguardando-voce', view: 'aguardando-voce' }),
      ),
    )
  })

  it('não oferece "mencionam você" enquanto nenhuma tela sabe criar uma menção', () => {
    montar()

    expect(screen.queryByRole('button', { name: /menciona/i })).not.toBeInTheDocument()
  })

  it('item 24: o rótulo diz o filtro real (prazo no quadro), não "estar no kanban"', () => {
    // O filtro do servidor é `cards__due_at__isnull=False` — "tem prazo
    // interno anotado" — não "está no kanban" (todo ticket visível está lá).
    // Ver `_apply_saved_view` em apps/tickets/views.py.
    montar()

    expect(screen.getByRole('button', { name: /Com prazo no quadro/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Kanban/ })).not.toBeInTheDocument()
  })
})

describe('ViewsPanel — controles que ainda não fazem nada', () => {
  it('filtro e personalizar avisam "em breve" em vez de fingir que funcionam', () => {
    // Recolher SAIU desta lista nesta rodada — ver describe abaixo: agora liga de verdade.
    montar()

    const filtro = screen.getByLabelText('Filtrar visualizações')
    expect(filtro).toHaveAttribute('aria-disabled', 'true')
    expect(filtro).toHaveAttribute('readonly')
    expect(filtro).toHaveAttribute('title', 'Filtrar visualizações — em breve')

    const personalizar = screen.getByRole('button', { name: 'Personalizar visualizações' })
    expect(personalizar).toHaveAttribute('aria-disabled', 'true')
    expect(personalizar).toHaveAttribute('title', 'Personalizar visualizações — em breve')
  })
})

describe('ViewsPanel — recolher o painel (item da rodada 3)', () => {
  it('clicar em "Recolher painel" esconde a lista de visualizações e oferece um jeito de expandir de novo', async () => {
    montar()
    await screen.findByText('40') // resumo carregado, painel expandido de verdade

    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel' }))

    expect(screen.queryByRole('button', { name: /Aguardando você/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Filtrar visualizações')).not.toBeInTheDocument()
    const expandir = screen.getByRole('button', { name: 'Expandir painel de visualizações' })
    expect(expandir).toBeInTheDocument()

    fireEvent.click(expandir)

    expect(await screen.findByRole('button', { name: /Aguardando você/ })).toBeInTheDocument()
  })

  it('a escolha de recolher persiste (localStorage) — sobrevive a uma nova montagem', async () => {
    // `montar()` não expõe `unmount` (as outras describe usam o retorno como
    // o mock de `onSelecionar`) — monta direto aqui só pra ter acesso a ele.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const primeira = render(
      <QueryClientProvider client={client}>
        <ViewsPanel ativa="nao-resolvidos" onSelecionar={vi.fn()} />
      </QueryClientProvider>,
    )
    await screen.findByText('40')

    fireEvent.click(screen.getByRole('button', { name: 'Recolher painel' }))
    expect(screen.getByRole('button', { name: 'Expandir painel de visualizações' })).toBeInTheDocument()
    primeira.unmount()

    montar()
    // Sem esperar o resumo (não tem nada pra mostrar de conteúdo): o painel
    // já nasce recolhido nesta montagem nova, sem precisar clicar de novo.
    expect(screen.getByRole('button', { name: 'Expandir painel de visualizações' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recolher painel' })).not.toBeInTheDocument()
  })

  it('janela estreita (breakpoint de tablet) começa recolhida quando ninguém escolheu ainda', () => {
    estadoDaJanela(true) // (max-width: 1024px) bate — janela dividida ou notebook pequeno

    montar()

    expect(screen.getByRole('button', { name: 'Expandir painel de visualizações' })).toBeInTheDocument()
  })

  it('escolha explícita de expandir vence a janela estreita', async () => {
    estadoDaJanela(true)
    localStorage.setItem('resolv-fila-painel-recolhido', 'nao')

    montar()

    expect(await screen.findByRole('button', { name: /Aguardando você/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expandir painel de visualizações' })).not.toBeInTheDocument()
  })
})
