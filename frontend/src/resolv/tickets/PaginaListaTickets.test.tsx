import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { PaginaListaTickets } from './PaginaListaTickets'

/** Mostra caminho + querystring do MemoryRouter — pra confirmar o que de
 *  fato foi escrito na URL em vez de inferir pelo comportamento da tela. */
function UrlAtual() {
  const location = useLocation()
  return <span data-testid="url-atual">{location.pathname + location.search}</span>
}

const ME = {
  id: 2,
  full_name: 'Samuel Suporte',
  email: 'samuel@x.test',
  is_internal: true,
  is_admin: false,
  kind: 'internal',
  permissions: ['ticket.bulk_actions', 'ticket.close'],
}

const LINHA = {
  id: 7,
  reference: 'T-0007',
  subject: 'Assunto do ticket',
  status: 'open',
  stage_name: 'Em andamento',
  stage_color: '#888',
  priority: 'normal',
  source: 'web',
  requester_display: 'Cliente X',
  company_name: 'Empresa X',
  assignee_name: null,
  category_name: null,
  current_status_note: null,
  sla: {
    first_response: { due_at: null, state: 'none', minutes_left: null },
    resolution: { due_at: null, state: 'none', minutes_left: null },
  },
  first_response_at: null,
  created_at: new Date().toISOString(),
  is_restricted: false,
}
const LINHA_8 = { ...LINHA, id: 8, reference: 'T-0008', subject: 'Outro assunto' }

const AGENTE = {
  id: 9,
  full_name: 'Ana Agente',
  email: 'ana@x.test',
  kind: 'internal',
  internal_role: 'agent',
  company: null,
  presence: 'available',
}

const RESUMO = {
  visoes: { 'nao-resolvidos': 61, 'nao-atribuidos': 40, resolvidos: 0 },
  abertos: { total: 61, hoje: 9, variacao_dia: 2 },
  nao_atribuidos: { total: 40, espera_mais_longa_min: 38 },
  sla_em_risco: { total: 3, estouram_em_1h: 1, por_plano: [] },
  meus: { total: 7, aguardando_voce: 3 },
  resolvidos_hoje: { total: 12, media_resolucao_min: 95 },
}

const FACETAS = {
  status: [
    { value: 'new', label: 'Novo', count: 3 },
    { value: 'open', label: 'Aberto', count: 5 },
    { value: 'pending_customer', label: 'Aguardando', count: 1 },
    { value: 'closed', label: 'Fechado', count: 0 },
  ],
  priority: [
    { value: 'low', label: 'Baixa', count: 1 },
    { value: 'normal', label: 'Normal', count: 4 },
    { value: 'high', label: 'Alta', count: 2 },
    { value: 'urgent', label: 'Urgente', count: 1 },
  ],
  company: [{ value: 31, label: 'Acme', count: 4 }],
  assignee: [
    { value: null, label: 'Não atribuído', count: 3 },
    { value: 2, label: 'Samuel Suporte', count: 2 },
    { value: 9, label: 'Ana Agente', count: 1 },
  ],
  team: [{ value: 'suporte', label: 'Suporte', count: 6 }],
  category: [],
  tag: [{ value: 'vip', label: 'VIP', count: 1 }],
  sla: [
    { value: 'at_risk', label: 'Em risco', count: 1 },
    { value: 'breached', label: 'Estourado', count: 0 },
  ],
  plan: [],
  sem_dominio: 0,
}

const STATUS = [
  { id: 1, name: 'Novo', category: 'new', color: '#888', order: 0, is_active: true },
  { id: 2, name: 'Em análise', category: 'open', color: '#888', order: 1, is_active: true },
  { id: 3, name: 'Fechado', category: 'closed', color: '#888', order: 9, is_active: true },
]

let chamadas: { url: string; query: string; metodo: string; body?: unknown }[]
let respostaDoLote: () => Response
let respostaDaLista: () => Response
let visoesPessoais: unknown[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  chamadas = []
  visoesPessoais = []
  respostaDaLista = () => jsonDe({ count: 1, next: null, previous: null, results: [LINHA] })
  respostaDoLote = () => jsonDe({ updated: [7], failed: [] })
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      chamadas.push({ url: u.pathname, query: u.search, metodo, body })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/tickets/resumo/') return Promise.resolve(jsonDe(RESUMO))
      if (u.pathname === '/api/v1/tickets/facets/') return Promise.resolve(jsonDe(FACETAS))
      if (u.pathname === '/api/v1/tickets/') return Promise.resolve(respostaDaLista())
      if (u.pathname === '/api/v1/users/') return Promise.resolve(jsonDe([AGENTE]))
      if (u.pathname === '/api/v1/settings/statuses/') return Promise.resolve(jsonDe(STATUS))
      if (u.pathname.startsWith('/api/v1/tickets/bulk-')) return Promise.resolve(respostaDoLote())
      if (u.pathname === '/api/v1/ticket-views/' && metodo === 'POST')
        return Promise.resolve(jsonDe({ id: 55, position: 0, ...(body as object) }, 201))
      if (u.pathname === '/api/v1/ticket-views/') return Promise.resolve(jsonDe(visoesPessoais))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(url = '/chamados') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/chamados"
            element={
              <>
                <PaginaListaTickets />
                <UrlAtual />
              </>
            }
          />
          <Route path="/chamados/:id" element={<UrlAtual />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Último GET da listagem — é onde o recorte pedido ao servidor aparece. */
function ultimaListagem() {
  const c = [...chamadas].reverse().find((x) => x.url === '/api/v1/tickets/' && x.metodo === 'GET')
  return new URLSearchParams(c?.query ?? '')
}

/** A pílula de uma dimensão — dentro da barra, para não confundir com o
 *  botão de ordenar da coluna de mesmo nome. */
function pilula(nome: string | RegExp) {
  return within(screen.getByRole('group', { name: 'Filtros' })).getByRole('button', { name: nome })
}

function chamadaDe(caminho: string) {
  return chamadas.find((c) => c.url === caminho && c.metodo === 'POST')
}

describe('PaginaListaTickets — ações em lote', () => {
  it('atribuir com sucesso chama o endpoint, limpa a seleção e diz quantos mudaram', async () => {
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    expect(await screen.findByText('1', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('Atribuir a…'), { target: { value: '9' } })

    await waitFor(() =>
      expect(chamadaDe('/api/v1/tickets/bulk-assign/')?.body).toEqual({
        ticket_ids: [7],
        assignee_id: 9,
      }),
    )
    // role="status" (não "alert"): confirmação não interrompe o leitor de tela
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('1 ticket atribuído.')
    expect(screen.queryByRole('region', { name: 'Ações em lote' })).not.toBeInTheDocument()
  })

  it('nada mudou: alerta com o motivo e a seleção continua', async () => {
    respostaDoLote = () =>
      jsonDe({ updated: [], failed: [{ id: 7, detail: 'Ticket de outra equipe.' }] })
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    fireEvent.change(screen.getByDisplayValue('Atribuir a…'), { target: { value: 'ninguem' } })

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(
      'Nenhum ticket foi alterado. 1 ignorado: Ticket de outra equipe.',
    )
    expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument()
  })

  it('lote misto: diz quantos mudaram, quantos foram ignorados e por quê; só os ignorados ficam marcados', async () => {
    respostaDaLista = () =>
      jsonDe({ count: 2, next: null, previous: null, results: [LINHA, LINHA_8] })
    respostaDoLote = () =>
      jsonDe({ updated: [7], failed: [{ id: 8, detail: 'Já está neste status.' }] })
    montar()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Selecionar os 2 tickets desta página' }),
    )
    const select = await screen.findByDisplayValue('Mudar status…')
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Em análise' })).toBeInTheDocument(),
    )
    fireEvent.change(select, { target: { value: '2' } })

    await waitFor(() =>
      expect(chamadaDe('/api/v1/tickets/bulk-status/')?.body).toEqual({
        ticket_ids: [7, 8],
        stage_id: 2,
      }),
    )
    expect(
      await screen.findByText('1 ticket atualizado. 1 ignorado: Já está neste status.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Selecionar T-0008' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Selecionar T-0007' })).not.toBeChecked()
  })

  it('"Mudar status" não oferece status de conclusão — fechar é "Encerrar"', async () => {
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    const select = await screen.findByDisplayValue('Mudar status…')
    await waitFor(() =>
      expect(within(select).getByRole('option', { name: 'Em análise' })).toBeInTheDocument(),
    )
    expect(within(select).queryByRole('option', { name: 'Fechado' })).not.toBeInTheDocument()
  })

  it('"Encerrar" pede as datas da solução e manda o contrato do fechamento', async () => {
    respostaDoLote = () => jsonDe({ updated: [7], failed: [] })
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }))

    const dialogo = await screen.findByRole('dialog', { name: 'Encerrar 1 ticket' })
    fireEvent.change(within(dialogo).getByLabelText(/Nota de fechamento/), {
      target: { value: 'Duplicado' },
    })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Encerrar 1 ticket' }))

    await waitFor(() => expect(chamadaDe('/api/v1/tickets/bulk-close/')).toBeDefined())
    const corpo = chamadaDe('/api/v1/tickets/bulk-close/')!.body as Record<string, unknown>
    expect(corpo.ticket_ids).toEqual([7])
    expect(corpo.note).toBe('Duplicado')
    expect(typeof corpo.resolution_started_at).toBe('string')
    expect(typeof corpo.resolution_ended_at).toBe('string')
    expect(await screen.findByText('1 ticket encerrado.')).toBeInTheDocument()
  })

  it('trocar de visão limpa o resumo do lote anterior', async () => {
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    fireEvent.change(screen.getByDisplayValue('Atribuir a…'), { target: { value: '9' } })
    expect(await screen.findByText('1 ticket atribuído.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tickets resolvidos/ }))

    expect(screen.queryByText('1 ticket atribuído.')).not.toBeInTheDocument()
  })
})

describe('PaginaListaTickets — cabeçalho', () => {
  it('diz o total em poucas palavras e o botão de atualizar conta quando foi a última busca', async () => {
    montar()
    await screen.findByText('T-0007')

    expect(screen.getByText('1 ticket')).toBeInTheDocument()
    expect(screen.queryByText(/Exibindo de/)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /^Atualizar lista, atualizado agora mesmo/ }),
    ).toBeInTheDocument()
  })
})

describe('PaginaListaTickets — recorte de cada gaveta', () => {
  it('"Tickets prioritários" pede urgentes AINDA NÃO RESOLVIDOS', async () => {
    montar()
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: 'Tickets prioritários' }))

    await waitFor(() => {
      expect(ultimaListagem().get('priority')).toBe('urgent')
      expect(ultimaListagem().get('view')).toBe('nao-resolvidos')
    })
  })

  it('"Mencionam você" voltou para a lista (o compositor já sabe mencionar)', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Mencionam você' }))
    await waitFor(() => expect(ultimaListagem().get('view')).toBe('mencionam-voce'))
  })

  it('clicar no cabeçalho SLA manda ?ordering=sla pro servidor', async () => {
    montar()
    await screen.findByText('T-0007')

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: /^SLA/ }))

    await waitFor(() => expect(ultimaListagem().get('ordering')).toBe('sla'))
  })
})

describe('PaginaListaTickets — filtros na URL', () => {
  it('marcar prioridades vira ?priority= na URL e na consulta, e combina com a visão', async () => {
    montar('/chamados?view=nao-atribuidos')
    await screen.findByText('T-0007')

    fireEvent.click(pilula('Prioridade'))
    const lista = await screen.findByRole('listbox', { name: 'Prioridade' })
    fireEvent.click(within(lista).getByRole('option', { name: /Alta/ }))
    fireEvent.click(within(lista).getByRole('option', { name: /Urgente/ }))

    await waitFor(() =>
      expect(screen.getByTestId('url-atual')).toHaveTextContent('priority=high%2Curgent'),
    )
    await waitFor(() => {
      expect(ultimaListagem().get('priority')).toBe('high,urgent')
      expect(ultimaListagem().get('view')).toBe('nao-atribuidos')
    })
    // a pílula passa a dizer o valor
    expect(pilula(/Prioridade: Alta, Urgente/)).toBeInTheDocument()
  })

  it('as opções mostram a contagem da faceta, e "Responsável" oferece "Eu" e "Sem responsável"', async () => {
    montar()
    await screen.findByText('T-0007')

    fireEvent.click(pilula('Responsável'))
    const lista = await screen.findByRole('listbox', { name: 'Responsável' })
    expect(within(lista).getByRole('option', { name: 'Eu 2' })).toBeInTheDocument()
    expect(within(lista).getByRole('option', { name: 'Sem responsável 3' })).toBeInTheDocument()
    fireEvent.click(within(lista).getByRole('option', { name: 'Sem responsável 3' }))

    await waitFor(() => expect(ultimaListagem().get('assignee')).toBe('unassigned'))
    // valor único: escolher fecha o popover
    expect(screen.queryByRole('listbox', { name: 'Responsável' })).not.toBeInTheDocument()
  })

  it('filtro vindo da URL já chega aplicado (link compartilhado)', async () => {
    montar('/chamados?team=suporte&sla=at_risk')
    await screen.findByText('T-0007')

    const q = ultimaListagem()
    expect(q.get('team')).toBe('suporte')
    expect(q.get('sla')).toBe('at_risk')
    expect(await screen.findByRole('button', { name: /Equipe: Suporte/ })).toBeInTheDocument()
  })

  it('?solicitante= (link do detalhe) vira ?requester= na API e uma pílula que só desliga', async () => {
    montar('/chamados?solicitante=41')
    await screen.findByText('T-0007')

    expect(ultimaListagem().get('requester')).toBe('41')
    expect(ultimaListagem().get('solicitante')).toBeNull()
    expect(pilula('Limpar filtro solicitante')).toBeInTheDocument()
    expect(screen.getByText('Cliente X', { selector: '.filtro__valor' })).toBeInTheDocument()

    fireEvent.click(pilula('Limpar filtro solicitante'))
    await waitFor(() =>
      expect(screen.getByTestId('url-atual')).not.toHaveTextContent('solicitante'),
    )
  })

  it('?empresa= (link da página da empresa) vira ?company= na API, com o nome da faceta na pílula', async () => {
    montar('/chamados?empresa=31')
    await screen.findByText('T-0007')

    expect(ultimaListagem().get('company')).toBe('31')
    expect(ultimaListagem().get('empresa')).toBeNull()
    expect(await screen.findByText('Acme', { selector: '.filtro__valor' })).toBeInTheDocument()
  })

  it('"Limpar filtros" tira todos os filtros e mantém a visão', async () => {
    montar('/chamados?view=todos&priority=urgent&team=suporte')
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }))

    await waitFor(() =>
      expect(screen.getByTestId('url-atual')).toHaveTextContent('/chamados?view=todos'),
    )
    expect(screen.getByTestId('url-atual')).not.toHaveTextContent('priority')
  })

  it('trocar de visão do sistema zera os filtros da anterior', async () => {
    montar('/chamados?priority=urgent')
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: /Tickets resolvidos/ }))

    await waitFor(() =>
      expect(screen.getByTestId('url-atual')).toHaveTextContent('view=resolvidos'),
    )
    expect(screen.getByTestId('url-atual')).not.toHaveTextContent('priority')
  })

  it('filtro sem resultado oferece "Limpar filtros" em vez do vazio da visão', async () => {
    respostaDaLista = () => jsonDe({ count: 0, next: null, previous: null, results: [] })
    montar('/chamados?tag=vip')

    expect(await screen.findByText('Nenhum ticket com esses filtros.')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Limpar filtros' }).length).toBeGreaterThan(0)
  })
})

describe('PaginaListaTickets — visões pessoais', () => {
  it('"Salvar visão" guarda a visão, a busca e os filtros de agora', async () => {
    montar('/chamados?view=nao-resolvidos&priority=urgent&team=suporte')
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: 'Salvar visão' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Salvar visão' })
    fireEvent.change(within(dialogo).getByLabelText('Nome'), {
      target: { value: 'Suporte urgente' },
    })
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(chamadaDe('/api/v1/ticket-views/')).toBeDefined())
    expect(chamadaDe('/api/v1/ticket-views/')!.body).toEqual({
      name: 'Suporte urgente',
      filters: { view: 'nao-resolvidos', priority: 'urgent', team: 'suporte' },
    })
    await waitFor(() => expect(screen.getByTestId('url-atual')).toHaveTextContent('pessoal=55'))
  })

  it('clicar numa visão pessoal aplica os filtros dela e dá o nome ao título', async () => {
    visoesPessoais = [
      {
        id: 4,
        name: 'Acme urgentes',
        position: 0,
        count: 3,
        filters: { view: 'todos', priority: 'urgent', company: '31' },
      },
    ]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Acme urgentes/ }))

    await waitFor(() => {
      const q = ultimaListagem()
      expect(q.get('view')).toBe('todos')
      expect(q.get('priority')).toBe('urgent')
      expect(q.get('company')).toBe('31')
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme urgentes')
    // sem mudança nenhuma, nada para salvar
    expect(screen.queryByRole('button', { name: /Salvar/ })).not.toBeInTheDocument()
  })

  it('mexer num filtro da visão aberta oferece "Salvar alterações"', async () => {
    visoesPessoais = [
      {
        id: 4,
        name: 'Acme urgentes',
        position: 0,
        count: 3,
        filters: { view: 'todos', priority: 'urgent' },
      },
    ]
    montar('/chamados?pessoal=4&view=todos&priority=urgent')
    await screen.findByText('T-0007')
    expect(screen.queryByRole('button', { name: 'Salvar alterações' })).not.toBeInTheDocument()

    fireEvent.click(pilula('SLA'))
    fireEvent.click(
      within(await screen.findByRole('listbox', { name: 'SLA' })).getByRole('option', {
        name: /Em risco/,
      }),
    )

    expect(await screen.findByRole('button', { name: 'Salvar alterações' })).toBeInTheDocument()
    expect(screen.getByText('Visão alterada')).toBeInTheDocument()
  })
})

describe('PaginaListaTickets — teclado (j/k, Enter/o, x)', () => {
  beforeEach(() => {
    respostaDaLista = () =>
      jsonDe({ count: 2, next: null, previous: null, results: [LINHA, LINHA_8] })
  })

  function linha(n: number) {
    return document.querySelector<HTMLElement>(`[data-linha="${n}"]`)!
  }

  it('j/k movem o foco entre as linhas e x marca a linha focada', async () => {
    montar()
    await screen.findByText('T-0008')

    fireEvent.keyDown(document.body, { key: 'j' })
    expect(linha(0)).toHaveFocus()
    fireEvent.keyDown(linha(0), { key: 'j' })
    expect(linha(1)).toHaveFocus()
    expect(linha(1)).toHaveAttribute('tabindex', '0')
    expect(linha(0)).toHaveAttribute('tabindex', '-1')

    fireEvent.keyDown(linha(1), { key: 'x' })
    expect(linha(1)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('checkbox', { name: 'Selecionar T-0008' })).toBeChecked()

    fireEvent.keyDown(linha(1), { key: 'k' })
    expect(linha(0)).toHaveFocus()
  })

  it('Enter (ou o) abre o ticket da linha focada', async () => {
    montar()
    await screen.findByText('T-0008')
    fireEvent.keyDown(document.body, { key: 'j' })
    fireEvent.keyDown(linha(0), { key: 'j' })

    fireEvent.keyDown(linha(1), { key: 'Enter' })

    await waitFor(() => expect(screen.getByTestId('url-atual')).toHaveTextContent('/chamados/8'))
  })

  it('não rouba teclas de quem está digitando nem de atalhos com Ctrl', async () => {
    montar()
    await screen.findByText('T-0008')
    const busca = screen.getByLabelText('Buscar por referência, assunto ou número do pedido')
    busca.focus()

    fireEvent.keyDown(busca, { key: 'j' })
    expect(busca).toHaveFocus()
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true })
    expect(linha(0)).not.toHaveFocus()
  })
})

describe('PaginaListaTickets — carregando, vazio e erro', () => {
  it('carregando mostra o esqueleto da tabela, não um "Carregando…" solto', async () => {
    respostaDaLista = () => new Promise<Response>(() => {}) as unknown as Response
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
      const u = new URL(String(url), 'http://x')
      if (u.pathname === '/api/v1/tickets/') return new Promise(() => {})
      return Promise.resolve(jsonDe(u.pathname === '/api/v1/auth/me/' ? ME : []))
    })
    montar()

    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent('Carregando tickets…')
    expect(document.querySelector('.tickets-tabela--esqueleto')).toBeInTheDocument()
  })

  it('erro oferece tentar de novo', async () => {
    respostaDaLista = () => jsonDe({ detail: 'erro' }, 500)
    montar()

    expect(
      await screen.findByText(/Não foi possível carregar os tickets \(erro 500\)/),
    ).toBeInTheDocument()
    respostaDaLista = () => jsonDe({ count: 1, next: null, previous: null, results: [LINHA] })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByText('T-0007')).toBeInTheDocument()
  })

  it('visão vazia explica o vazio e convida a abrir um ticket', async () => {
    respostaDaLista = () => jsonDe({ count: 0, next: null, previous: null, results: [] })
    montar('/chamados?view=aguardando-voce')

    expect(await screen.findByText('Nada aguardando você agora.')).toBeInTheDocument()
    fireEvent.click(
      within(screen.getByText('Nada aguardando você agora.').parentElement!).getByRole('button', {
        name: /Novo ticket/,
      }),
    )
    await waitFor(() => expect(screen.getByTestId('url-atual')).toHaveTextContent('/chamados/novo'))
  })
})

describe('PaginaListaTickets — a seleção segue o recorte da tela', () => {
  beforeEach(() => {
    // 60 registros: mais de uma página (LIMITE = 25).
    respostaDaLista = () =>
      jsonDe({ count: 60, next: null, previous: null, results: [LINHA, LINHA_8] })
  })

  it('virar a página não deixa selecionado quem saiu da tela', async () => {
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    expect(await screen.findByText('1', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }))

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Ações em lote' })).not.toBeInTheDocument(),
    )
  })

  it('buscar troca o recorte e zera a seleção', async () => {
    montar()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Selecionar T-0007' }))
    expect(await screen.findByText('1', { selector: 'strong' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Pesquisar'), { target: { value: 'cobrança' } })

    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Ações em lote' })).not.toBeInTheDocument(),
    )
  })

  it('a caixa do cabeçalho marca a página inteira e diz isso no rótulo', async () => {
    montar()
    fireEvent.click(
      await screen.findByRole('checkbox', { name: 'Selecionar os 2 tickets desta página' }),
    )
    expect(await screen.findByText('2', { selector: 'strong' })).toBeInTheDocument()
  })
})

describe('PaginaListaTickets — recorte mora na URL (item 18)', () => {
  it('trocar de visão grava ?view= na URL e não carrega offset de página anterior', async () => {
    montar('/chamados?offset=25')
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: /Tickets resolvidos/ }))

    await waitFor(() =>
      expect(screen.getByTestId('url-atual')).toHaveTextContent('view=resolvidos'),
    )
    expect(screen.getByTestId('url-atual')).not.toHaveTextContent('offset=')
  })

  it('a busca só entra na URL depois do debounce — não a cada tecla', async () => {
    montar()
    await screen.findByText('T-0007')

    fireEvent.change(screen.getByPlaceholderText('Pesquisar'), { target: { value: 'cobrança' } })
    expect(screen.getByTestId('url-atual')).not.toHaveTextContent('q=')

    await waitFor(() => expect(screen.getByTestId('url-atual')).toHaveTextContent('q=cobran'))
  })

  it('virar a página grava o offset na URL', async () => {
    respostaDaLista = () =>
      jsonDe({ count: 60, next: null, previous: null, results: [LINHA, LINHA_8] })
    montar()
    await screen.findByText('T-0007')

    fireEvent.click(screen.getByRole('button', { name: /Próxima/ }))

    await waitFor(() => expect(screen.getByTestId('url-atual')).toHaveTextContent('offset=25'))
  })
})

describe('PaginaListaTickets — a busca distingue "sem resultado" de "view vazia" (item 15)', () => {
  beforeEach(() => {
    respostaDaLista = () => jsonDe({ count: 0, next: null, previous: null, results: [] })
  })

  it('o campo de busca diz o escopo, não só o placeholder', async () => {
    montar()
    expect(
      await screen.findByLabelText('Buscar por referência, assunto ou número do pedido'),
    ).toBeInTheDocument()
  })

  it('sem busca o vazio é da visualização; com busca sem resultado, diz o termo e oferece limpar', async () => {
    montar()
    expect(await screen.findByText('Nenhum ticket nesta visualização.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Pesquisar'), { target: { value: 'Acme' } })

    expect(await screen.findByText('Nenhum resultado para "Acme".')).toBeInTheDocument()
    expect(screen.queryByText('Nenhum ticket nesta visualização.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar busca' }))

    expect(await screen.findByText('Nenhum ticket nesta visualização.')).toBeInTheDocument()
  })
})

describe('PaginaListaTickets — alternador de densidade (stores/prefs.ts)', () => {
  afterEach(() => {
    usePrefs.setState({ densidade: 'compacta' })
  })

  it('clicar em "Tabela confortável" grava a preferência e marca o botão certo', async () => {
    montar()
    await screen.findByText('T-0007')

    const padrao = screen.getByRole('button', { name: 'Tabela padrão' })
    const confortavel = screen.getByRole('button', { name: /Tabela confortável/ })
    expect(padrao).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(confortavel)

    expect(usePrefs.getState().densidade).toBe('confortavel')
    expect(confortavel).toHaveAttribute('aria-pressed', 'true')
    expect(padrao).toHaveAttribute('aria-pressed', 'false')
  })
})
