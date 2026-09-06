import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { PainelPropriedades } from './PainelPropriedades'
import type { TicketDetalhe } from './tiposDetalhe'

const mudarEtiquetasMock = vi.hoisted(() => vi.fn())
const mudarEquipeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))

/** Toda mutação do painel tem a mesma forma; só as duas em teste têm espião. */
const parada = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })

vi.mock('./dados', () => ({
  useAlvosMencao: () => ({ data: [] }),
  useCategorias: () => ({ data: [] }),
  useAcoesTicket: () => ({
    atribuir: parada(),
    definirDono: parada(),
    mudarCategoria: parada(),
    mudarPrioridade: parada(),
    seguir: parada(),
    deixarDeSeguir: parada(),
    mudarEtiquetas: { ...parada(), mutate: mudarEtiquetasMock },
    mudarEquipe: { ...parada(), mutateAsync: mudarEquipeMock },
  }),
}))

const EQUIPES = [
  { id: 1, name: 'Suporte', slug: 'suporte', visibility: 'public', order: 1 },
  { id: 2, name: 'Financeiro', slug: 'financeiro', visibility: 'public', order: 2 },
]
const ETIQUETAS = [
  { id: 7, name: 'Reincidente', slug: 'reincidente', color: '#b3261e' },
  { id: 8, name: 'VIP', slug: 'vip', color: '#1d7a4c' },
]

// O cadastro vem do mesmo hook da tela de abertura; o teste controla o estado
// dele (carregando / falhou / vazio / cheio) porque a tela promete os quatro.
let etiquetas: { data?: typeof ETIQUETAS; isLoading: boolean; isError: boolean }

vi.mock('@/cvz/tickets/dados', () => ({
  useEquipes: () => ({ data: EQUIPES }),
  useEtiquetas: () => etiquetas,
}))

const ME: Me = {
  id: 3,
  email: 'samuel@demo.test',
  full_name: 'Samuel Suporte',
  kind: 'internal',
  internal_role: 'agent',
  client_role: null,
  company: null,
  company_name: '',
  plan_name: '',
  is_internal: true,
  is_admin: false,
  teams: ['suporte'],
  presence: 'available',
  permissions: ['ticket.edit_properties'],
  ticket_scope: 'team',
  custom_role_name: '',
  avatar_url: '',
  job_title: '',
  phone: '',
  ui_density: 'comfortable',
  signature: '',
}

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

function montar(extra: Partial<TicketDetalhe> = {}, me: Me | undefined = ME) {
  return render(<PainelPropriedades ticket={ticket(extra)} me={me} />)
}

beforeEach(() => {
  mudarEtiquetasMock.mockReset()
  mudarEquipeMock.mockReset().mockResolvedValue(undefined)
  etiquetas = { data: ETIQUETAS, isLoading: false, isError: false }
})

describe('PainelPropriedades — etiquetar depois da abertura', () => {
  it('liga uma etiqueta mandando o conjunto inteiro, não só a nova', () => {
    // O PATCH SUBSTITUI a lista (TicketReclassifySerializer.tags): mandar só a
    // etiqueta clicada apagaria as outras do chamado.
    montar({ tags: [{ id: 8, name: 'VIP', slug: 'vip' }] })

    fireEvent.click(screen.getByRole('button', { name: 'Reincidente' }))

    expect(mudarEtiquetasMock).toHaveBeenCalledWith([8, 7])
  })

  it('desliga uma etiqueta mandando a lista sem ela', () => {
    montar({ tags: [{ id: 7, name: 'Reincidente', slug: 'reincidente' }] })

    const chip = screen.getByRole('button', { name: 'Reincidente' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(chip)

    expect(mudarEtiquetasMock).toHaveBeenCalledWith([])
  })

  it('sem permissão de editar, as etiquetas continuam só de leitura', () => {
    montar(
      { tags: [{ id: 7, name: 'Reincidente', slug: 'reincidente' }] },
      {
        ...ME,
        permissions: [],
      },
    )

    expect(screen.getByText('Reincidente')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reincidente' })).toBeNull()
  })

  it('avisa quando o cadastro de etiquetas não carregou, em vez de fingir lista vazia', () => {
    etiquetas = { data: undefined, isLoading: false, isError: true }
    montar({ tags: [{ id: 7, name: 'Reincidente', slug: 'reincidente' }] })

    expect(
      screen.getByText(/Não foi possível carregar o cadastro de etiquetas/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reincidente' })).toBeNull()
  })

  it('avisa enquanto o cadastro está carregando', () => {
    etiquetas = { data: undefined, isLoading: true, isError: false }
    montar()

    expect(screen.getByText('Carregando o cadastro de etiquetas…')).toBeInTheDocument()
  })

  it('manda para Configurações quando não há nenhuma etiqueta cadastrada', () => {
    etiquetas = { data: [], isLoading: false, isError: false }
    montar()

    expect(screen.getByText(/Nenhuma etiqueta cadastrada/)).toBeInTheDocument()
  })
})

describe('PainelPropriedades — transferir de equipe', () => {
  it('pergunta antes de transferir: escolher no seletor ainda não grava', () => {
    montar()

    fireEvent.change(screen.getByLabelText('Equipe'), { target: { value: '2' } })

    expect(mudarEquipeMock).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Transferir para Financeiro?' })).toBeInTheDocument()
    // O motivo da pergunta tem que estar escrito: transferir muda quem enxerga.
    expect(screen.getByText(/passa a ser visto por quem atende Financeiro/)).toBeInTheDocument()
  })

  it('confirmar manda o PATCH com a equipe escolhida', () => {
    montar()

    fireEvent.change(screen.getByLabelText('Equipe'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transferir' }))

    expect(mudarEquipeMock).toHaveBeenCalledWith(2)
  })

  it('cancelar não grava e devolve o campo à equipe atual', () => {
    montar()

    const seletor = screen.getByLabelText('Equipe') as HTMLSelectElement
    fireEvent.change(seletor, { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(mudarEquipeMock).not.toHaveBeenCalled()
    expect(seletor.value).toBe('1')
  })

  it('sem permissão de editar, a equipe continua sendo só o valor', () => {
    montar({}, { ...ME, permissions: [] })

    expect(screen.queryByLabelText('Equipe')).toBeNull()
    expect(screen.getByText('Suporte')).toBeInTheDocument()
  })
})
