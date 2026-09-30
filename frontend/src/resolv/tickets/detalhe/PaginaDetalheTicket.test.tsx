import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { PaginaDetalheTicket } from './PaginaDetalheTicket'
import type { Evento, TicketDetalhe } from './tiposDetalhe'

// As colunas/cabeçalho têm suas próprias dependências pesadas (SLA, anexos,
// cvz/components…) e cada uma já tem teste próprio — aqui o que importa é só
// a faixa "chamado atualizado por baixo" (item 20), que vive nesta página.
// O cabeçalho real traz SLA/anexos junto e tem teste próprio; aqui ele vira
// só os botões que alternam painel, que é o que esta página coordena.
vi.mock('./CabecalhoTicket', () => ({
  CabecalhoTicket: ({
    ticket,
    onAlternarPainel,
    onFechar,
    onReabrir,
  }: {
    ticket: { status: string }
    onAlternarPainel: (p: string) => void
    onFechar: () => void
    onReabrir: () => void
  }) => (
    <div data-testid="cabecalho" data-status={ticket.status}>
      <button onClick={() => onAlternarPainel('notas')}>abrir notas</button>
      <button onClick={() => onAlternarPainel('cliente')}>abrir cliente</button>
      <button onClick={onFechar}>abrir fechamento</button>
      <button onClick={onReabrir}>reabrir</button>
    </div>
  ),
}))
vi.mock('./PainelNotas', () => ({ PainelNotas: () => <div data-testid="notas" /> }))
vi.mock('./Conversa', () => ({ Conversa: () => <div data-testid="conversa" /> }))
vi.mock('./PainelCliente', () => ({ PainelCliente: () => <div data-testid="cliente" /> }))
vi.mock('./PainelPropriedades', () => ({
  PainelPropriedades: () => <div data-testid="propriedades" />,
}))
// O formulário de fechamento tem teste próprio; aqui ele só entrega os dados.
const DADOS_FECHAMENTO = {
  resolution_started_at: '2026-09-01T10:00:00.000Z',
  resolution_ended_at: '2026-09-06T12:00:00.000Z',
  note: 'resolvido',
}
vi.mock('./ModalFecharTicket', () => ({
  ModalFecharTicket: ({ onFechar }: { onFechar: (d: typeof DADOS_FECHAMENTO) => void }) => (
    <button onClick={() => onFechar(DADOS_FECHAMENTO)}>confirmar fechamento</button>
  ),
}))

const meMock: { data: unknown } = { data: undefined }
vi.mock('@/api/queries/useMe', () => ({ useMe: () => meMock }))
let tabsMock: { tipo: 'ticket'; ticketId: number }[] = []
vi.mock('@/stores/tabs', () => ({
  useTabs: (seletor: (s: { abrirTicket: () => void; tabs: unknown[] }) => unknown) =>
    seletor({ abrirTicket: vi.fn(), tabs: tabsMock }),
}))
const navegar = vi.fn()
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => navegar,
}))

/** Estado que `useTicketDetalhe` devolve — mutado entre renders para simular
 *  o ciclo real de uma query (isFetching true→false trazendo dado novo). Os
 *  testes chamam `rerender` depois de mudar este objeto: como o mock lê a
 *  variável a cada chamada, o próximo render do componente já enxerga o
 *  estado atualizado, do jeito que o TanStack Query faria de verdade. */
let estadoQuery: {
  data: TicketDetalhe | undefined
  isLoading: boolean
  isError: boolean
  error: unknown
  refetch: () => void
  isFetching: boolean
  dataUpdatedAt: number
}

const fecharNoServidor = vi.fn()
const atribuirNoServidor = vi.fn()
vi.mock('./dados', () => ({
  useTicketDetalhe: () => estadoQuery,
  requisicoesTicket: {
    fechar: (...a: unknown[]) => fecharNoServidor(...a),
    atribuir: (...a: unknown[]) => atribuirNoServidor(...a),
  },
}))

function ticket(extra: Partial<TicketDetalhe> = {}): TicketDetalhe {
  return {
    id: 42,
    reference: '#1042',
    subject: 'Impressora fiscal não emite',
    order_number: '',
    satisfaction: null,
    status: 'open',
    stage: null,
    stage_name: 'Aberto',
    stage_color: '#888888',
    priority: 'high',
    source: 'web',
    team: { id: 1, name: 'Suporte', slug: 'suporte' },
    requester_display: 'Beto Barros',
    assignee_name: null,
    assignee_id: null,
    owner_name: null,
    owner_id: null,
    company_name: 'Acme Marketing',
    category: null,
    category_name: null,
    current_status_note: null,
    is_restricted: false,
    content_hidden: false,
    sla: {
      first_response: { due_at: null, state: 'none', minutes_left: null },
      resolution: { due_at: null, state: 'none', minutes_left: null },
    },
    tags: [],
    created_at: '2026-09-01T10:00:00Z',
    first_response_at: null,
    messages: [],
    events: [],
    watchers: [],
    scheduled_replies: [],
    requester: null,
    ...extra,
  }
}

function evento(extra: Partial<Evento> = {}): Evento {
  return {
    id: 1,
    from_status: 'open',
    to_status: 'pending_customer',
    actor_name: null,
    is_reopen: false,
    is_automatic: false,
    note: '',
    created_at: '2026-09-06T12:00:00Z',
    ...extra,
  }
}

// Mesma árvore usada por `render` e por cada `rerender`: precisa ser a MESMA
// identidade de elementos (MemoryRouter > Routes > Route) para o React
// reconciliar em vez de desmontar — é isso que preserva os refs internos de
// `DetalheCarregado` entre as "chegadas de refetch" simuladas no teste.
const queryClient = new QueryClient()
function pagina(rota = '/tickets/42') {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[rota]}>
          <Routes>
            <Route path="/tickets/:id" element={<PaginaDetalheTicket />} />
            <Route path="/fora" element={<p>outra tela</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  )
}

function montar() {
  return render(pagina())
}

beforeEach(() => {
  meMock.data = undefined
  tabsMock = []
  navegar.mockReset()
  fecharNoServidor.mockReset().mockResolvedValue(ticket({ status: 'closed' }))
  atribuirNoServidor.mockReset().mockResolvedValue(ticket({ assignee_id: 7 }))
  estadoQuery = {
    data: ticket(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    dataUpdatedAt: 1000,
  }
})

describe('PaginaDetalheTicket — faixa "chamado atualizado por baixo" (item 20)', () => {
  it('não mostra faixa nenhuma na carga inicial', () => {
    const { rerender } = montar()
    rerender(pagina())

    expect(screen.queryByText(/atualizado/)).not.toBeInTheDocument()
  })

  it('mostra a faixa quando um refetch em segundo plano troca o status, nomeando quem mudou', () => {
    const { rerender } = montar()

    // 1) o refetch começa (60s/foco/socket) — isFetching sobe, dado ainda é o velho.
    estadoQuery = { ...estadoQuery, isFetching: true }
    rerender(pagina())
    expect(screen.queryByText(/atualizado/)).not.toBeInTheDocument()

    // 2) o refetch chega: status mudou e o evento mais recente aponta pra ele,
    //    com autor — a faixa deve nomear quem mudou.
    estadoQuery = {
      ...estadoQuery,
      isFetching: false,
      dataUpdatedAt: 2000,
      data: ticket({
        status: 'pending_customer',
        events: [evento({ id: 2, actor_name: 'Marcos Agente', to_status: 'pending_customer' })],
      }),
    }
    rerender(pagina())

    const faixa = screen.getByText(/Marcos Agente atualizou este ticket/)
    expect(faixa.closest('[role="status"]')).toBeInTheDocument()
  })

  it('mostra aviso honesto, sem inventar autor, quando o responsável muda (payload não rastreia quem atribuiu)', () => {
    const { rerender } = montar()

    estadoQuery = { ...estadoQuery, isFetching: true }
    rerender(pagina())

    estadoQuery = {
      ...estadoQuery,
      isFetching: false,
      data: ticket({ assignee_id: 9, assignee_name: 'Ana Agente' }),
    }
    rerender(pagina())

    expect(screen.getByText('Este ticket foi atualizado enquanto você olhava.')).toBeInTheDocument()
    // Nome nenhum inventado: "Ana Agente" não aparece dentro da faixa.
    expect(screen.queryByText(/Ana Agente atualizou/)).not.toBeInTheDocument()
  })

  it('não mostra faixa quando a mudança vem da própria ação (setQueryData nunca passa por isFetching)', () => {
    const { rerender } = montar()

    // `gravar()` (dados.ts) grava direto no cache via setQueryData — o
    // isFetching desta query NUNCA fica true nesse caminho. Simula isso:
    // o dado muda sem o ciclo isFetching true→false.
    estadoQuery = { ...estadoQuery, data: ticket({ status: 'closed' }) }
    rerender(pagina())

    expect(screen.queryByText(/atualizado/)).not.toBeInTheDocument()
  })

  it('fechar a faixa remove o aviso até a próxima mudança de fundo', () => {
    const { rerender } = montar()

    estadoQuery = { ...estadoQuery, isFetching: true }
    rerender(pagina())
    estadoQuery = { ...estadoQuery, isFetching: false, data: ticket({ status: 'closed' }) }
    rerender(pagina())

    expect(screen.getByText(/atualizado/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar aviso de atualização' }))
    expect(screen.queryByText(/atualizado/)).not.toBeInTheDocument()
  })

  it('as notas abrem SEM véu — dá para ler a conversa enquanto se anota', () => {
    // O véu é um botão que cobre as colunas e fecha o painel ao clique. Sobre
    // as notas ele seria destrutivo: rolar/clicar a conversa (que é o motivo
    // de a nota existir) fecharia o painel e levaria junto o rascunho.
    const { container } = montar()

    fireEvent.click(screen.getByRole('button', { name: 'abrir notas' }))

    expect(screen.getByTestId('notas')).toBeInTheDocument()
    expect(container.querySelector('.detalhe__veu')).toBeNull()
  })

  it('o painel do cliente continua com véu — ali ele é gaveta mesmo', () => {
    const { container } = montar()

    fireEvent.click(screen.getByRole('button', { name: 'abrir cliente' }))

    expect(container.querySelector('.detalhe__veu')).not.toBeNull()
  })
})

describe('PaginaDetalheTicket — fechar com "Desfazer" em vez de confirmação', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function fecharPelaTela() {
    fireEvent.click(screen.getByRole('button', { name: 'abrir fechamento' }))
    fireEvent.click(screen.getByRole('button', { name: 'confirmar fechamento' }))
  }

  it('mostra fechado na hora, mas só grava depois do prazo', async () => {
    montar()
    fecharPelaTela()

    expect(screen.getByTestId('cabecalho')).toHaveAttribute('data-status', 'closed')
    expect(screen.getByText('Ticket fechado')).toBeInTheDocument()
    expect(fecharNoServidor).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(fecharNoServidor).toHaveBeenCalledTimes(1)
    expect(fecharNoServidor).toHaveBeenCalledWith(42, DADOS_FECHAMENTO, { keepalive: false })
  })

  it('Desfazer volta a tela e nada vai ao servidor — reverter não é reabrir', async () => {
    montar()
    fecharPelaTela()

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))
    expect(screen.getByTestId('cabecalho')).toHaveAttribute('data-status', 'open')
    expect(screen.getByText('Desfeito')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(fecharNoServidor).not.toHaveBeenCalled()
  })

  it('"Reabrir…" com o fechamento ainda no prazo só desfaz — nada a reabrir no servidor', async () => {
    montar()
    fecharPelaTela()

    fireEvent.click(screen.getByRole('button', { name: 'reabrir' }))

    expect(screen.getByTestId('cabecalho')).toHaveAttribute('data-status', 'open')
    await act(async () => {
      vi.advanceTimersByTime(10_000)
    })
    expect(fecharNoServidor).not.toHaveBeenCalled()
  })

  it('Ctrl+Z desfaz enquanto o aviso está na tela', () => {
    montar()
    fecharPelaTela()

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    expect(screen.getByTestId('cabecalho')).toHaveAttribute('data-status', 'open')
    expect(fecharNoServidor).not.toHaveBeenCalled()
  })

  it('trocar de ticket grava na hora, com keepalive — a ação nunca se perde', () => {
    const { rerender } = montar()
    fecharPelaTela()

    // o miolo é remontado por ticket (`key={ticket.id}`): trocar de ticket
    // desmonta o anterior com o shell (e o provider de toast) ainda de pé
    estadoQuery = { ...estadoQuery, data: ticket({ id: 43 }) }
    rerender(pagina())

    expect(fecharNoServidor).toHaveBeenCalledTimes(1)
    expect(fecharNoServidor).toHaveBeenCalledWith(42, DADOS_FECHAMENTO, { keepalive: true })
  })

  it('esconder a aba (ou fechá-la) também grava na hora', () => {
    montar()
    fecharPelaTela()

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })

    expect(fecharNoServidor).toHaveBeenCalledTimes(1)
    expect(fecharNoServidor.mock.calls[0]![2]).toEqual({ keepalive: true })
  })

  it('dispensar o aviso no X grava na hora, sem esperar o prazo', () => {
    montar()
    fecharPelaTela()

    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))

    expect(fecharNoServidor).toHaveBeenCalledTimes(1)
  })
})

describe('PaginaDetalheTicket — atalhos do ticket aberto', () => {
  const ME = {
    id: 7,
    full_name: 'Marta Agente',
    is_internal: true,
    permissions: ['ticket.be_assigned', 'ticket.close'],
  }

  it('`a` assume com Desfazer, e ignora a tecla digitada num campo', async () => {
    vi.useFakeTimers()
    meMock.data = ME
    montar()

    const campo = document.createElement('input')
    document.body.appendChild(campo)
    fireEvent.keyDown(campo, { key: 'a' })
    expect(screen.queryByText('Ticket atribuído a você')).not.toBeInTheDocument()
    campo.remove()

    fireEvent.keyDown(document.body, { key: 'a' })
    expect(screen.getByText('Ticket atribuído a você')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(6_000)
    })
    expect(atribuirNoServidor).toHaveBeenCalledWith(42, 7, { keepalive: false })
    vi.useRealTimers()
  })

  it('`e` abre o fechamento', () => {
    meMock.data = ME
    montar()

    fireEvent.keyDown(document.body, { key: 'e' })

    expect(screen.getByRole('button', { name: 'confirmar fechamento' })).toBeInTheDocument()
  })

  it('`[` e `]` andam pela lista "Trabalhando agora"', () => {
    tabsMock = [
      { tipo: 'ticket', ticketId: 10 },
      { tipo: 'ticket', ticketId: 42 },
      { tipo: 'ticket', ticketId: 99 },
    ]
    montar()

    fireEvent.keyDown(document.body, { key: ']' })
    expect(navegar).toHaveBeenLastCalledWith('/tickets/99')
    fireEvent.keyDown(document.body, { key: '[' })
    expect(navegar).toHaveBeenLastCalledWith('/tickets/10')
  })

  it('Esc fecha a gaveta aberta', () => {
    const { container } = montar()
    fireEvent.click(screen.getByRole('button', { name: 'abrir cliente' }))
    expect(container.querySelector('.detalhe__veu')).not.toBeNull()

    fireEvent.keyDown(document.body, { key: 'Escape' })

    expect(container.querySelector('.detalhe__veu')).toBeNull()
  })
})
