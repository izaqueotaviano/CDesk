import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaKanban } from './PaginaKanban'
import type { Cartao, Coluna, QuadroMontado } from './tipos'

const semSla = { due_at: null, state: 'none' as const, minutes_left: null }

function cartao(parcial: Partial<Cartao>): Cartao {
  return {
    ticket: 1,
    ticket_reference: 'TD-00001',
    ticket_status: 'open',
    stage: 1,
    priority: 'normal',
    subject: 'Assunto',
    requester_display: 'Ana Almeida',
    company_name: 'Acme',
    team_name: 'Suporte',
    owner_id: null,
    owner_name: null,
    assignee_id: null,
    assignee_name: null,
    assignee_avatar: null,
    sla: { first_response: semSla, resolution: semSla },
    column: 'new',
    message_count: 0,
    attachment_count: 0,
    due_at: null,
    is_overdue: false,
    created_at: '2026-09-01T10:00:00Z',
    ...parcial,
  }
}

function coluna(parcial: Partial<Coluna>): Coluna {
  return {
    key: 'new',
    name: 'Novo',
    color: '#888',
    category: 'new',
    kind: 'stage',
    stage: 1,
    lane: null,
    concludes: false,
    wip_limit: null,
    ...parcial,
  }
}

function quadroPadrao(): QuadroMontado {
  return {
    columns: [
      coluna({ key: 'new', name: 'Novo', stage: 1 }),
      coluna({ key: 'closed', name: 'Fechado', category: 'closed', stage: 4, concludes: true }),
      coluna({ key: 'lane-9', name: 'Prioridade alta', category: null, kind: 'lane', stage: null, lane: 9 }),
    ],
    entries: [
      cartao({ ticket: 1, ticket_reference: 'TD-00001', subject: 'Página fora do ar', priority: 'urgent', assignee_id: 42, assignee_name: 'Alice Admin' }),
      cartao({
        ticket: 2,
        ticket_reference: 'TD-00027',
        subject: 'Teclado sem resposta',
        priority: 'normal',
        company_name: 'Bravo',
        sla: { first_response: semSla, resolution: { due_at: null, state: 'breached', minutes_left: -(21 * 1440 + 180) } },
      }),
      cartao({ ticket: 3, ticket_reference: 'TD-00003', subject: 'Relatório mensal', priority: 'high' }),
    ],
  }
}

let quadro: QuadroMontado
let chamadas: { url: string; metodo: string; corpo: unknown }[]
let respostaDeApagarLane: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  quadro = quadroPadrao()
  chamadas = []
  respostaDeApagarLane = () => new Response(null, { status: 204 })
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe({ id: 42, full_name: 'Alice Admin', is_admin: true }))
      if (u.pathname === '/api/v1/kanban/boards/') return Promise.resolve(jsonDe([{ id: 1, name: 'Suporte', slug: 'suporte', team: null, team_slug: null, is_active: true }]))
      if (u.pathname === '/api/v1/kanban/boards/1/cards/') return Promise.resolve(jsonDe(quadro))
      if (u.pathname.startsWith('/api/v1/kanban/boards/1/columns/') && metodo === 'PATCH') {
        const { wip_limit } = JSON.parse(String(init!.body))
        const chave = decodeURIComponent(u.pathname.split('/').at(-2)!)
        quadro = { ...quadro, columns: quadro.columns.map((c) => (c.key === chave ? { ...c, wip_limit } : c)) }
        return Promise.resolve(jsonDe(quadro))
      }
      if (u.pathname === '/api/v1/kanban/lanes/9/' && metodo === 'DELETE') return Promise.resolve(respostaDeApagarLane())
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

let urlAtual = ''
function EspiaUrl() {
  const { search } = useLocation()
  // num efeito, não no render: o componente só espia a URL para o teste
  useEffect(() => {
    urlAtual = search
  }, [search])
  return null
}

function montar(rota = '/quadro') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route
            path="/quadro"
            element={
              <>
                <PaginaKanban />
                <EspiaUrl />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const colunaChamada = (nome: string) => screen.getByRole('region', { name: nome })

async function abrirMenuDaColuna(nome: string) {
  fireEvent.click(await screen.findByRole('button', { name: `Opções da coluna ${nome}` }))
  return screen.findByRole('menu', { name: `Opções da coluna ${nome}` })
}

describe('PaginaKanban — carregamento e estados', () => {
  it('mostra um esqueleto com a forma do quadro, não um "Carregando…" solto', async () => {
    montar()
    expect(screen.getByRole('status')).toHaveTextContent('Carregando quadro')
    expect(screen.queryByText('Carregando quadro…')).not.toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Quadro' })).toBeInTheDocument()
  })

  it('subtítulo e coluna de conclusão vazia sem travessão, convidando à ação', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Quadro' })
    expect(screen.getByText('3 tickets no quadro. Arraste um cartão para mudar o status.')).toBeInTheDocument()
    const fechado = colunaChamada('Fechado')
    expect(within(fechado).getByText('Solte um ticket aqui para fechá-lo. Tickets fechados saem do quadro.')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('—')
  })
})

describe('PaginaKanban — cor do status', () => {
  function quadroComOrganizacao(): QuadroMontado {
    return {
      columns: [
        coluna({ key: 'open', name: 'Aberto', color: '#5A87B8', stage: 2, category: 'open' }),
        coluna({ key: 'lane-9', name: 'Depende do gestor', category: null, kind: 'lane', stage: null, lane: 9, color: '#999999' }),
      ],
      entries: [
        cartao({ ticket: 1, ticket_reference: 'TD-00001', subject: 'Na coluna de status', stage: 2, column: 'open' }),
        cartao({ ticket: 2, ticket_reference: 'TD-00002', subject: 'Na coluna de organização', stage: 2, column: 'lane-9' }),
      ],
    }
  }

  it('a cor do status vira a faixa do cartão, e a barra e o tom da coluna', async () => {
    quadro = quadroComOrganizacao()
    montar()
    const cartaoAberto = await screen.findByRole('button', { name: /^TD-00001/ })
    expect(cartaoAberto.getAttribute('style')).toContain('--kb-cor: #5A87B8')
    const coluna = colunaChamada('Aberto')
    expect(coluna.getAttribute('style')).toContain('--kb-cor: #5A87B8')
    // a barra escurece o azul médio só o suficiente para a tinta branca ler (AA)
    expect(coluna.getAttribute('style')).toContain('--kb-barra-texto: #ffffff')
  })

  it('só numa coluna de organização o cartão diz o próprio status, na cor dele', async () => {
    quadro = quadroComOrganizacao()
    montar()
    const naStatus = await screen.findByRole('button', { name: /^TD-00001/ })
    expect(within(naStatus).queryByText('Aberto')).not.toBeInTheDocument()
    const naOrganizacao = screen.getByRole('button', { name: /^TD-00002/ })
    expect(within(naOrganizacao).getByText('Aberto')).toBeInTheDocument()
    // a faixa é a do STATUS do ticket, não a (cinza) da coluna onde foi fixado
    expect(naOrganizacao.getAttribute('style')).toContain('--kb-cor: #5A87B8')
  })

  it('mostra empresa » contato, e o nome de quem responde', async () => {
    quadro = quadroPadrao()
    montar()
    const comResponsavel = await screen.findByRole('button', { name: /^TD-00001/ })
    expect(within(comResponsavel).getByText('Acme')).toBeInTheDocument()
    expect(within(comResponsavel).getByText('Ana Almeida')).toBeInTheDocument()
    expect(comResponsavel.querySelector('.kb-cartao__cliente')).toHaveAttribute('title', 'Acme » Ana Almeida')
    expect(within(comResponsavel).getByText('Alice Admin')).toBeInTheDocument()
  })
})

describe('PaginaKanban — cartão', () => {
  it('marca só Alta e Urgente; Normal não ganha marcador', async () => {
    montar()
    const urgente = await screen.findByRole('button', { name: /^TD-00001/ })
    expect(within(urgente).getByText('Urgente')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /^TD-00003/ })).getByText('Alta')).toBeInTheDocument()
    const normal = screen.getByRole('button', { name: /^TD-00027/ })
    expect(within(normal).queryByText('Normal')).not.toBeInTheDocument()
  })

  it('sem prazo não mostra "Prazo"; o SLA explica o número no tooltip', async () => {
    montar()
    const cartao = await screen.findByRole('button', { name: /^TD-00027/ })
    expect(within(cartao).queryByText('Prazo')).not.toBeInTheDocument()
    expect(within(cartao).getByRole('button', { name: 'Definir prazo interno de TD-00027' })).toBeInTheDocument()
    expect(within(cartao).getByTitle('SLA de resolução estourado há 21 dias')).toHaveTextContent('-21d 3h')
    expect(cartao).toHaveAccessibleName(expect.stringContaining('SLA de resolução estourado há 21 dias'))
  })
})

describe('PaginaKanban — filtros', () => {
  it('lê os filtros da URL e conta por coluna o recorte e o todo', async () => {
    montar('/quadro?prioridade=urgent')
    await screen.findByRole('heading', { name: 'Quadro' })
    const novo = colunaChamada('Novo')
    expect(within(novo).getAllByRole('button', { name: /^TD-/ })).toHaveLength(1)
    expect(within(novo).getByText('1 de 3')).toBeInTheDocument()
    expect(screen.getByText('1 de 3 tickets')).toHaveAttribute('role', 'status')
  })

  it('a busca filtra na hora e vai para a URL; "Limpar filtros" volta tudo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      montar()
      const busca = await screen.findByRole('searchbox', { name: 'Buscar por assunto, referência ou cliente' })
      fireEvent.change(busca, { target: { value: 'teclado' } })
      expect(within(colunaChamada('Novo')).getAllByRole('button', { name: /^TD-/ })).toHaveLength(1)
      await act(async () => {
        vi.advanceTimersByTime(300)
      })
      expect(urlAtual).toContain('busca=teclado')

      fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))
      expect(within(colunaChamada('Novo')).getAllByRole('button', { name: /^TD-/ })).toHaveLength(3)
      await waitFor(() => expect(urlAtual).toBe(''))
    } finally {
      vi.useRealTimers()
    }
  })

  it('"Eu" usa a sessão e "Só atrasados" pega o SLA estourado', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Quadro' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por responsável' }), { target: { value: 'eu' } })
    await waitFor(() => expect(within(colunaChamada('Novo')).getAllByRole('button', { name: /^TD-/ })).toHaveLength(1))
    expect(within(colunaChamada('Novo')).getByRole('button', { name: /^TD-00001/ })).toBeInTheDocument()
    expect(urlAtual).toContain('responsavel=eu')

    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por responsável' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Só atrasados' }))
    await waitFor(() => expect(within(colunaChamada('Novo')).getAllByRole('button', { name: /^TD-/ })).toHaveLength(1))
    expect(within(colunaChamada('Novo')).getByRole('button', { name: /^TD-00027/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Só atrasados' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('PaginaKanban — limite de WIP', () => {
  it('acima do limite o contador vira "total/limite" e avisa, sem bloquear nada', async () => {
    quadro.columns[0]!.wip_limit = 2
    montar()
    await screen.findByRole('heading', { name: 'Quadro' })
    const novo = colunaChamada('Novo')
    expect(within(novo).getByText('3/2')).toBeInTheDocument()
    expect(within(novo).getByText('3 tickets, limite de 2. Acima do limite')).toBeInTheDocument()
    expect(novo).toHaveClass('kb-coluna--acima')
  })

  it('"Definir limite" no menu da coluna grava pelo endpoint da coluna', async () => {
    montar()
    const menu = await abrirMenuDaColuna('Novo')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Definir limite' }))
    const campo = screen.getByRole('spinbutton', { name: 'Limite de tickets' })
    fireEvent.change(campo, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(chamadas).toContainEqual({ url: '/api/v1/kanban/boards/1/columns/new/', metodo: 'PATCH', corpo: { wip_limit: 5 } }),
    )
    expect(await within(colunaChamada('Novo')).findByText('3/5')).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: 'Limite de tickets' })).not.toBeInTheDocument()
  })

  it('valor inválido não vai ao servidor', async () => {
    montar()
    const menu = await abrirMenuDaColuna('Novo')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Definir limite' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Limite de tickets' }), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/Use um número inteiro de 1 a 999/)).toBeInTheDocument()
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false)
  })

  it('a coluna de conclusão não tem menu (fica sempre vazia)', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Quadro' })
    expect(screen.queryByRole('button', { name: 'Opções da coluna Fechado' })).not.toBeInTheDocument()
  })
})

describe('PaginaKanban — feedback de erro', () => {
  it('apagar coluna que falha mostra um aviso dispensável, em vez de falhar em silêncio', async () => {
    respostaDeApagarLane = () => jsonDe({ detail: 'Esta coluna tem chamados fixados nela.' }, 400)
    montar()
    const menu = await abrirMenuDaColuna('Prioridade alta')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Apagar coluna' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta coluna tem chamados fixados nela.')

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('apagar com sucesso não deixa aviso nenhum', async () => {
    montar()
    const menu = await abrirMenuDaColuna('Prioridade alta')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Apagar coluna' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/kanban/lanes/9/' && c.metodo === 'DELETE')).toBe(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
