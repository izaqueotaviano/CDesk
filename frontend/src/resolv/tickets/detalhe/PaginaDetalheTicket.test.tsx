import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaDetalheTicket } from './PaginaDetalheTicket'
import type { Evento, TicketDetalhe } from './tiposDetalhe'

// As colunas/cabeçalho têm suas próprias dependências pesadas (SLA, anexos,
// cvz/components…) e cada uma já tem teste próprio — aqui o que importa é só
// a faixa "chamado atualizado por baixo" (item 20), que vive nesta página.
// O cabeçalho real traz SLA/anexos junto e tem teste próprio; aqui ele vira
// só os botões que alternam painel, que é o que esta página coordena.
vi.mock('./CabecalhoTicket', () => ({
  CabecalhoTicket: ({ onAlternarPainel }: { onAlternarPainel: (p: string) => void }) => (
    <div data-testid="cabecalho">
      <button onClick={() => onAlternarPainel('notas')}>abrir notas</button>
      <button onClick={() => onAlternarPainel('cliente')}>abrir cliente</button>
    </div>
  ),
}))
vi.mock('./PainelNotas', () => ({ PainelNotas: () => <div data-testid="notas" /> }))
vi.mock('./Conversa', () => ({ Conversa: () => <div data-testid="conversa" /> }))
vi.mock('./PainelCliente', () => ({ PainelCliente: () => <div data-testid="cliente" /> }))
vi.mock('./PainelPropriedades', () => ({
  PainelPropriedades: () => <div data-testid="propriedades" />,
}))
vi.mock('./ModalFecharTicket', () => ({ ModalFecharTicket: () => null }))

vi.mock('@/api/queries/useMe', () => ({ useMe: () => ({ data: undefined }) }))
vi.mock('@/stores/tabs', () => ({
  useTabs: (seletor: (s: { abrirTicket: () => void }) => unknown) => seletor({ abrirTicket: vi.fn() }),
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

vi.mock('./dados', () => ({
  useTicketDetalhe: () => estadoQuery,
  useAcoesTicket: () => ({
    atribuir: { mutate: vi.fn(), isPending: false },
    fechar: { mutate: vi.fn(), isPending: false, mutateAsync: vi.fn() },
  }),
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
function pagina() {
  return (
    <MemoryRouter initialEntries={['/chamados/42']}>
      <Routes>
        <Route path="/chamados/:id" element={<PaginaDetalheTicket />} />
      </Routes>
    </MemoryRouter>
  )
}

function montar() {
  return render(pagina())
}

beforeEach(() => {
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

    const faixa = screen.getByText(/Marcos Agente atualizou este chamado/)
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

    expect(screen.getByText('Este chamado foi atualizado enquanto você olhava.')).toBeInTheDocument()
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
