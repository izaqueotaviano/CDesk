import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { PainelPropriedades } from './PainelPropriedades'
import type { TicketDetalhe } from './tiposDetalhe'

const mudarEtiquetasMock = vi.hoisted(() => vi.fn())
const mudarEquipeMock = vi.hoisted(() => vi.fn(() => Promise.resolve()))

/** Toda mutação do painel tem a mesma forma; só as duas em teste têm espião. */
const parada = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })

let categorias: { data?: { id: number; name: string; slug: string }[] } = { data: [] }
let agentesAtribuiveis: {
  data?: { id: number; name: string; email: string; avatar_url: string }[]
} = { data: [] }

vi.mock('./dados', () => ({
  useAgentesAtribuiveis: () => agentesAtribuiveis,
  useCategorias: () => categorias,
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
  signature_kind: '' as const,
  signature_html: '',
  signature_image_url: '',
  signature_render: '',
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
  categorias = { data: [] }
  agentesAtribuiveis = { data: [] }
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

describe('PainelPropriedades — Responsável/Dono técnico usam a lista de atribuição (item 11)', () => {
  it('lista de assignable-agents alimenta os dois seletores, sem filtro por type', () => {
    // Contrato de `useAgentesAtribuiveis` (GET .../assignable-agents/) não tem
    // `type`/`group` — é só gente, diferente do de @menção. Se o componente
    // ainda tentasse filtrar por `a.type === 'user'`, a lista sumiria inteira
    // (o campo não existe) e os dois seletores ficariam vazios.
    agentesAtribuiveis = {
      data: [{ id: 9, name: 'Ana Agente', email: 'ana@demo.test', avatar_url: '' }],
    }

    montar()

    const responsavel = screen.getByLabelText('Responsável') as HTMLSelectElement
    const dono = screen.getByLabelText('Dono técnico') as HTMLSelectElement
    expect(within(responsavel).getByRole('option', { name: 'Ana Agente' })).toBeInTheDocument()
    expect(within(dono).getByRole('option', { name: 'Ana Agente' })).toBeInTheDocument()
  })

  it('mantém o responsável atual visível mesmo se ele não vier na lista de atribuíveis', () => {
    // Não é o mesmo bug da categoria (aqui não há paginação), mas o mesmo
    // padrão de defesa: se por qualquer razão o atual não está na lista (ex.:
    // desativado depois de atribuído), a tela não pode fingir "sem
    // responsável" — precisa mostrar quem está atribuído de verdade.
    agentesAtribuiveis = { data: [] }

    montar({ assignee_id: 42, assignee_name: 'Beto Sumido' })

    const responsavel = screen.getByLabelText('Responsável') as HTMLSelectElement
    expect(responsavel.value).toBe('42')
    expect(within(responsavel).getByRole('option', { name: 'Beto Sumido' })).toBeInTheDocument()
  })
})

describe('PainelPropriedades — categoria além da página do catálogo (item 9)', () => {
  it('mostra a categoria atual no seletor mesmo quando ela não veio na página carregada', () => {
    // useCategorias só traz `?limit=200`: uma empresa com catálogo maior tem
    // categoria (ex.: a 201ª) que nunca aparece na lista, mas o ticket pode
    // estar classificado nela — sem a opção injetada o <select> não acha o
    // value, cai silenciosamente na primeira ("Sem categoria") e a tela mente.
    categorias = { data: [{ id: 1, name: 'Financeiro', slug: 'financeiro' }] }

    montar({ category: 999, category_name: 'Categoria Fora Da Página' })

    const seletor = screen.getByLabelText('Categoria') as HTMLSelectElement
    expect(seletor.value).toBe('999')
    expect(
      screen.getByRole('option', { name: 'Categoria Fora Da Página' }),
    ).toBeInTheDocument()
  })

  it('não duplica a opção quando a categoria atual já está na página carregada', () => {
    // Escopado ao seletor de Categoria: o de Equipe também tem uma opção
    // "Financeiro" (EQUIPES acima) — sem `within` o teste contaria as duas.
    categorias = { data: [{ id: 1, name: 'Financeiro', slug: 'financeiro' }] }

    montar({ category: 1, category_name: 'Financeiro' })

    const seletor = screen.getByLabelText('Categoria')
    expect(within(seletor).getAllByRole('option', { name: 'Financeiro' })).toHaveLength(1)
  })
})
