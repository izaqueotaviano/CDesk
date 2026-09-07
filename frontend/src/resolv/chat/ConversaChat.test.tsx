import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat } from '@/api/chat'
import type { Me } from '@/api/types'
import { ConversaChat } from './ConversaChat'
import type { Macro } from './dados'

const aplicarMacroMock = vi.hoisted(() => vi.fn())

// `let` para o menu de macro poder testar com uma lista de verdade — os
// outros testes deste arquivo (se algum dia precisarem) voltam pro padrão
// vazio no beforeEach, mesmo esquema de Compositor.test.tsx.
let macros: Macro[] = []

vi.mock('./dados', () => ({
  useMacros: () => ({ data: macros }),
  useAplicarMacroChat: () => ({ mutate: aplicarMacroMock, isPending: false }),
}))

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({
    status: 'aberto',
    digitando: null,
    erro: null,
    enviarMensagem: vi.fn(),
    enviarDigitando: vi.fn(),
  }),
}))

let chatAtual: Chat

vi.mock('@/api/chat', () => ({
  LIMITE_MENSAGENS: 100,
  useChat: () => ({ data: chatAtual, isLoading: false, isError: false }),
  useMensagensChat: () => ({ data: [], dataUpdatedAt: 0 }),
  useEnviarArquivos: () => ({ mutate: vi.fn(), isPending: false }),
  useMarcarLidas: () => ({ mutate: vi.fn() }),
  useCarregarAnteriores: () => ({ mutate: vi.fn(), isPending: false }),
  usePegarChat: () => ({ mutate: vi.fn(), isPending: false }),
  useReabrirChat: () => ({ mutate: vi.fn(), isPending: false }),
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
  permissions: ['macro.use'],
  ticket_scope: 'team',
  custom_role_name: '',
  avatar_url: '',
  job_title: '',
  phone: '',
  ui_density: 'comfortable',
  signature: '',
}

// `podeMacro` (ConversaChat.tsx) exige 'macro.use' — fixture "sem macro"
// para os testes de gate.
const ME_SEM_MACRO: Me = { ...ME, permissions: [] }

function chat(extra: Partial<Chat> = {}): Chat {
  return {
    id: 7,
    status: 'active',
    name: '',
    client_id: 4,
    client_name: 'Ana Cliente',
    client_email: 'ana@acme.test',
    client_phone: '',
    client_avatar: null,
    company_name: 'Acme',
    agent_name: 'Samuel Suporte',
    agent_id: ME.id,
    agent_avatar: null,
    category: null,
    category_name: null,
    priority: 'normal',
    assignee: null,
    assignee_name: null,
    tag_ids: [],
    queued_at: '2026-09-01T10:00:00Z',
    accepted_at: '2026-09-01T10:01:00Z',
    closed_at: null,
    reopen_count: 0,
    timeout_converted: false,
    unread_count: 0,
    last_message_preview: null,
    rating: null,
    rating_pending: false,
    ticket_id: null,
    ticket_reference: null,
    ws_url: '',
    ...extra,
  }
}

const MACROS: Macro[] = [
  { id: 1, name: 'Pedido de nota fiscal', body: 'Poderia enviar a nota fiscal, por favor?' },
  {
    id: 2,
    name: 'Encerramento padrão',
    body: 'Vamos encerrar por aqui — qualquer coisa, é só chamar.',
    category: 5,
    category_name: 'Financeiro',
    priority: 'high',
    assignee: 9,
    assignee_name: 'Dani Dev',
  },
  { id: 3, name: 'Solicitação de acesso', body: 'Preciso que você confirme o acesso.' },
]

function montar(me: Me = ME) {
  return render(
    <MemoryRouter>
      <ConversaChat chatId={7} me={me} />
    </MemoryRouter>,
  )
}

function abrirMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Aplicar macro/ }))
}

function campoFiltro() {
  return screen.getByRole('combobox', { name: 'Filtrar macros por nome ou texto' })
}

function listaDeMacros() {
  return within(screen.getByRole('listbox', { name: 'Macros' }))
}

function textoDoCompositor() {
  return screen.getByPlaceholderText(/Escreva para o cliente/) as HTMLTextAreaElement
}

beforeEach(() => {
  aplicarMacroMock.mockReset()
  macros = []
  chatAtual = chat()
})

describe('ConversaChat — menu de macro', () => {
  it('sem a permissão macro.use, o botão nem aparece', () => {
    macros = MACROS
    montar(ME_SEM_MACRO)

    expect(screen.queryByRole('button', { name: /Aplicar macro/ })).not.toBeInTheDocument()
  })

  it('sem macro nenhuma cadastrada, o botão também não aparece', () => {
    macros = []
    montar()

    expect(screen.queryByRole('button', { name: /Aplicar macro/ })).not.toBeInTheDocument()
  })

  it('abre sem filtro nenhum, com as três macros visíveis', () => {
    macros = MACROS
    montar()
    abrirMenu()

    expect(listaDeMacros().getAllByRole('option')).toHaveLength(3)
    expect(campoFiltro()).toHaveValue('')
  })

  it('filtra por nome e por corpo, sem acento', () => {
    macros = MACROS
    montar()
    abrirMenu()

    fireEvent.change(campoFiltro(), { target: { value: 'encerramento' } })
    expect(listaDeMacros().getAllByRole('option')).toHaveLength(1)
    expect(listaDeMacros().getAllByRole('option')[0]).toHaveTextContent('Encerramento padrão')

    // corpo, não nome — só "Pedido de nota fiscal" tem "nota fiscal" no texto
    fireEvent.change(campoFiltro(), { target: { value: 'nota fiscal' } })
    expect(listaDeMacros().getAllByRole('option')).toHaveLength(1)
    expect(listaDeMacros().getAllByRole('option')[0]).toHaveTextContent('Pedido de nota fiscal')

    // sem acento: "solicitacao" acha "Solicitação"
    fireEvent.change(campoFiltro(), { target: { value: 'solicitacao' } })
    expect(listaDeMacros().getAllByRole('option')).toHaveLength(1)

    fireEvent.change(campoFiltro(), { target: { value: 'xpto' } })
    expect(screen.getByText('Nenhuma macro com “xpto”.')).toBeInTheDocument()
    expect(listaDeMacros().queryAllByRole('option')).toHaveLength(0)
  })

  it('clicar numa macro sem campo de atendimento insere o texto no compositor e não chama apply-macro', () => {
    macros = MACROS
    montar()
    abrirMenu()

    fireEvent.click(listaDeMacros().getByText('Pedido de nota fiscal'))

    expect(textoDoCompositor()).toHaveValue('Poderia enviar a nota fiscal, por favor?')
    expect(aplicarMacroMock).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Macro “Pedido de nota fiscal” aplicada.')
    // aplicar fecha o menu
    expect(
      screen.queryByRole('combobox', { name: 'Filtrar macros por nome ou texto' }),
    ).not.toBeInTheDocument()
  })

  it('macro com categoria/prioridade/responsável também chama apply-macro com o id certo', () => {
    macros = MACROS
    montar()
    abrirMenu()

    fireEvent.click(listaDeMacros().getByText('Encerramento padrão'))

    expect(textoDoCompositor()).toHaveValue('Vamos encerrar por aqui — qualquer coisa, é só chamar.')
    expect(aplicarMacroMock).toHaveBeenCalledWith(2, expect.anything())
    expect(screen.getByRole('status')).toHaveTextContent('texto e campos do atendimento')
  })

  it('texto já escrito: o corpo da macro é ANEXADO, não substitui', () => {
    macros = MACROS
    montar()

    fireEvent.change(textoDoCompositor(), { target: { value: 'Oi, tudo bem?' } })
    abrirMenu()
    fireEvent.click(listaDeMacros().getByText('Solicitação de acesso'))

    expect(textoDoCompositor()).toHaveValue('Oi, tudo bem?\nPreciso que você confirme o acesso.')
  })

  it('seta para baixo move a seleção antes de aplicar com Enter (navegação por teclado)', () => {
    macros = MACROS
    montar()
    abrirMenu()

    fireEvent.keyDown(campoFiltro(), { key: 'ArrowDown' })
    fireEvent.keyDown(campoFiltro(), { key: 'ArrowDown' })
    fireEvent.keyDown(campoFiltro(), { key: 'Enter' })

    expect(textoDoCompositor()).toHaveValue('Preciso que você confirme o acesso.')
  })

  it('aria-activedescendant aponta pra opção ativa, coerente com a lista visível', () => {
    macros = MACROS
    montar()
    abrirMenu()

    const opcoes = listaDeMacros().getAllByRole('option')
    expect(campoFiltro()).toHaveAttribute('aria-activedescendant', opcoes[0].id)

    fireEvent.keyDown(campoFiltro(), { key: 'ArrowDown' })
    expect(campoFiltro()).toHaveAttribute('aria-activedescendant', opcoes[1].id)
  })

  it('reabrir o menu depois de aplicar uma macro começa sem o filtro anterior', () => {
    macros = MACROS
    montar()
    abrirMenu()
    fireEvent.change(campoFiltro(), { target: { value: 'encerramento' } })
    fireEvent.keyDown(campoFiltro(), { key: 'Enter' })

    abrirMenu() // reabre

    expect(campoFiltro()).toHaveValue('')
    expect(listaDeMacros().getAllByRole('option')).toHaveLength(3)
  })
})
