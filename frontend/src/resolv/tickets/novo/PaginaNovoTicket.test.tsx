import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaNovoTicket } from './PaginaNovoTicket'

const abrirMock = vi.hoisted(() => vi.fn())

const ME = {
  id: 3,
  full_name: 'Samuel Suporte',
  is_internal: true,
  is_admin: true,
  teams: ['suporte'],
  signature: 'Samuel — Suporte Resolv',
  permissions: [],
}

const EQUIPES = [
  { id: 1, name: 'Suporte', slug: 'suporte', visibility: 'public', order: 1 },
  { id: 2, name: 'Financeiro', slug: 'financeiro', visibility: 'public', order: 2 },
]
const EMPRESAS = [
  { id: 1, name: 'Acme Marketing', slug: 'acme', plan_name: 'Pro', is_active: true },
  { id: 2, name: 'Bravo Educação', slug: 'bravo', plan_name: 'Start', is_active: true },
]
const CLIENTES = [
  { id: 2, full_name: 'Beto Barros', email: 'beto@acme.test', kind: 'client', internal_role: null, company: 1, presence: 'offline' },
  { id: 4, full_name: 'Ana Almeida', email: 'ana@acme.test', kind: 'client', internal_role: null, company: 1, presence: 'offline' },
  { id: 5, full_name: 'Carla Costa', email: 'carla@bravo.test', kind: 'client', internal_role: null, company: 2, presence: 'offline' },
]
const AGENTES = [
  { id: 3, full_name: 'Samuel Suporte', email: 'samuel@demo.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'available' },
  { id: 9, full_name: 'Fátima Financeiro', email: 'fatima@demo.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'available' },
]
const MACROS = [
  { id: 1, name: 'Boas-vindas', body: 'Olá, {{solicitante}}! Recebemos o pedido da {{empresa}}.', priority: 'high', category: null, assignee: null, tags: [], is_active: true },
]

vi.mock('@/api/queries/useMe', () => ({ useMe: () => ({ data: ME }) }))
vi.mock('@/cvz/tickets/dados', () => ({
  useEquipes: () => ({ data: EQUIPES }),
  useServicos: () => ({ data: [] }),
  useCategorias: () => ({ data: [] }),
  useEmpresasOpcoes: () => ({ data: EMPRESAS }),
  useClientes: () => ({ data: CLIENTES, isLoading: false }),
  useAgentes: () => ({ data: AGENTES }),
  useEtiquetas: () => ({ data: [] }),
  useEstimativaResposta: (slug: string | null) => ({
    data: slug ? { label: '2 h', minutes: 120, sample: 12 } : undefined,
  }),
  useAbrirTicket: () => ({ mutateAsync: abrirMock, isPending: false }),
}))
vi.mock('../detalhe/dados', () => ({ useMacros: () => ({ data: MACROS }) }))

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/chamados/novo']}>
        <Routes>
          <Route path="/chamados/novo" element={<PaginaNovoTicket />} />
          <Route path="/chamados/:id" element={<p>detalhe do chamado</p>} />
          <Route path="/chamados" element={<p>lista de chamados</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const campoPara = () => screen.getByRole('combobox', { name: /^Para/ })

beforeEach(() => {
  abrirMock.mockReset()
})

describe('PaginaNovoTicket', () => {
  it('abre com o foco em "Para" e marca os obrigatórios ao enviar, levando o foco ao primeiro inválido', async () => {
    montar()
    expect(campoPara()).toHaveFocus()

    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByText('Escolha a equipe que vai atender.')).toBeInTheDocument()
    expect(screen.getByText('Escolha para quem o chamado é aberto.')).toBeInTheDocument()
    expect(screen.getByText('Resuma o chamado em uma linha.')).toBeInTheDocument()
    expect(screen.getByText(/Escreva a mensagem/)).toBeInTheDocument()
    // Equipe é o primeiro campo inválido na ordem da tela
    expect(screen.getByLabelText(/^Equipe/)).toHaveFocus()
    expect(abrirMock).not.toHaveBeenCalled()
  })

  it('acha o solicitante por e-mail e mostra o cartão do cliente sem consumo de cota', async () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'beto@' } })
    fireEvent.click(await screen.findByRole('option', { name: /Beto Barros/ }))

    expect(campoPara()).toHaveValue('Beto Barros')
    // a opção da lista (oculta) tem o mesmo texto — a asserção é sobre o cartão
    expect(
      screen.getByText('beto@acme.test · Acme Marketing', { selector: '.novo__cliente-meta' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/não consome a cota/)).toBeInTheDocument()
  })

  it('navega a lista de pessoas pelo teclado', async () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'ana' } })
    fireEvent.keyDown(campoPara(), { key: 'ArrowDown' })
    fireEvent.keyDown(campoPara(), { key: 'Enter' })
    expect(campoPara()).toHaveValue('Ana Almeida')
  })

  it('"Atribuir para mim" escolhe o agente logado como responsável', () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: 'Atribuir para mim' }))
    expect(screen.getByLabelText('Responsável')).toHaveValue('3')
  })

  it('mostra a estimativa de primeira resposta da equipe escolhida', async () => {
    montar()
    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '1' } })
    expect(await screen.findByText('Primeira resposta costuma sair em 2 h.')).toBeInTheDocument()
  })

  it('macro aplicada antes do solicitante é preenchida quando a pessoa entra', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /aplicar macro/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Boas-vindas/ }))
    const texto = screen.getByLabelText(/^Mensagem/)
    expect(texto).toHaveValue('Olá, {{solicitante}}! Recebemos o pedido da {{empresa}}.')

    fireEvent.change(campoPara(), { target: { value: 'carla' } })
    fireEvent.click(await screen.findByRole('option', { name: /Carla Costa/ }))
    expect(texto).toHaveValue('Olá, Carla! Recebemos o pedido da Bravo Educação.')
    // a macro também trouxe a urgência
    expect(screen.getByLabelText('Urgência')).toHaveValue('high')
  })

  it('envia o chamado com assinatura e cai no detalhe', async () => {
    abrirMock.mockResolvedValue({ ticket: { id: 42, reference: 'TD-00042' }, pendencias: [] })
    montar()

    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '2' } })
    fireEvent.change(campoPara(), { target: { value: 'beto' } })
    fireEvent.click(await screen.findByRole('option', { name: /Beto Barros/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto errado' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Olá, segue o boleto.' } })

    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    await waitFor(() => expect(abrirMock).toHaveBeenCalledTimes(1))
    expect(abrirMock.mock.calls[0][0]).toMatchObject({
      team_id: 2,
      requester_id: 2,
      subject: 'Boleto errado',
      priority: 'normal',
      body: 'Olá, segue o boleto.\n\n--\nSamuel — Suporte Resolv',
      category_id: null,
      assignee_id: null,
      tag_ids: [],
    })
    expect(await screen.findByText('detalhe do chamado')).toBeInTheDocument()
  })

  it('fica na tela com o link do chamado quando uma etapa pós-criação falha', async () => {
    abrirMock.mockResolvedValue({
      ticket: { id: 7, reference: 'TD-00007' },
      pendencias: ['o responsável não foi atribuído'],
    })
    montar()
    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '1' } })
    fireEvent.change(campoPara(), { target: { value: 'ana' } })
    fireEvent.click(await screen.findByRole('option', { name: /Ana Almeida/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'y' } })
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByRole('button', { name: 'Abrir TD-00007' })).toBeInTheDocument()
    expect(screen.queryByText('detalhe do chamado')).not.toBeInTheDocument()
  })
})
