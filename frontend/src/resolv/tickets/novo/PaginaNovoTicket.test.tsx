import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { PaginaNovoTicket } from './PaginaNovoTicket'

const abrirMock = vi.hoisted(() => vi.fn())
/** Mutável: cada teste diz o que o servidor respondeu em
 *  GET /api/v1/settings/system/ — inclusive "ainda não respondeu". */
const servidor = vi.hoisted(() => ({
  sistema: undefined as unknown,
  clientes: [] as { id: number; full_name: string }[],
}))

const MB = 1024 * 1024

/** O padrão real do backend (apps/core/models.py): 10 MB por arquivo, 100 MB
 *  somados, 10 arquivos. A tela dizia 20 MB. */
const CFG_SISTEMA = {
  attachment_max_bytes: 10 * MB,
  attachment_max_mb: 10,
  attachment_max_files_per_message: 10,
  attachment_max_bytes_per_message: 100 * MB,
  attachment_max_mb_per_message: 100,
}

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
vi.mock('@/cvz/configuracoes/dados', () => ({
  useSistemaCfg: () => ({ data: servidor.sistema }),
}))
vi.mock('@/cvz/tickets/dados', () => ({
  useEquipes: () => ({ data: EQUIPES }),
  useServicos: () => ({ data: [] }),
  useCategorias: () => ({ data: [] }),
  useEmpresasOpcoes: () => ({ data: EMPRESAS }),
  useClientes: () => ({ data: servidor.clientes, isLoading: false }),
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

/** `input.files` é somente leitura em jsdom; o navegador é quem preenche. */
function anexar(arquivos: File[]) {
  const input = screen.getByLabelText('Escolher arquivos para anexar')
  Object.defineProperty(input, 'files', { value: arquivos, configurable: true })
  fireEvent.change(input)
}

function arquivoDe(nome: string, bytes: number): File {
  const f = new File(['conteúdo'], nome, { type: 'application/pdf' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

/** Um id repetido quebra `aria-describedby`: o leitor de tela lê o primeiro
 *  elemento com aquele id e ignora o resto. */
function idsRepetidos(): string[] {
  const vistos = new Set<string>()
  const repetidos: string[] = []
  for (const el of document.querySelectorAll('[id]')) {
    if (vistos.has(el.id)) repetidos.push(el.id)
    vistos.add(el.id)
  }
  return repetidos
}

async function preencherObrigatorios(cliente = /Beto Barros/) {
  fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '1' } })
  fireEvent.change(campoPara(), { target: { value: 'a' } })
  fireEvent.click(await screen.findByRole('option', { name: cliente }))
  fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto errado' } })
  fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Olá, segue.' } })
}

beforeEach(() => {
  abrirMock.mockReset()
  servidor.sistema = CFG_SISTEMA
  servidor.clientes = CLIENTES
  // o rascunho é o mesmo localStorage entre testes — sem isto, o formulário
  // do teste anterior volta preenchido no seguinte
  localStorage.clear()
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

  // ------------------------------------------------------------------
  // Chamado criado: a tela vira confirmação (não um formulário armado)
  // ------------------------------------------------------------------

  it('chamado aberto com pendência troca o formulário pela confirmação, sem deixar reenviar', async () => {
    abrirMock.mockResolvedValue({
      ticket: { id: 7, reference: 'TD-00007' },
      pendencias: ['o responsável não foi atribuído'],
    })
    montar()
    await preencherObrigatorios(/Ana Almeida/)
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByRole('button', { name: 'Abrir TD-00007' })).toBeInTheDocument()
    expect(screen.getByText(/o responsável não foi atribuído/)).toBeInTheDocument()
    // o formulário SAIU: não há como mandar o mesmo chamado de novo
    expect(screen.queryByRole('button', { name: /^Abrir chamado/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Mensagem/)).not.toBeInTheDocument()
    expect(screen.queryByText('detalhe do chamado')).not.toBeInTheDocument()
  })

  it('"abrir outro" mantém o cliente e a equipe e devolve o formulário em branco', async () => {
    abrirMock.mockResolvedValue({
      ticket: { id: 7, reference: 'TD-00007' },
      pendencias: ['as etiquetas não foram aplicadas'],
    })
    montar()
    await preencherObrigatorios(/Ana Almeida/)
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir outro chamado para Ana Almeida' }))

    expect(campoPara()).toHaveValue('Ana Almeida')
    expect(screen.getByLabelText(/^Equipe/)).toHaveValue('1')
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('')
    expect(screen.getByLabelText(/^Mensagem/)).toHaveValue('')
    expect(screen.getByLabelText(/^Assunto/)).toHaveFocus()
    expect(abrirMock).toHaveBeenCalledTimes(1)
  })

  // ------------------------------------------------------------------
  // Limite de anexo: quem manda é a configuração do servidor
  // ------------------------------------------------------------------

  it('anuncia e aplica o limite de anexo que o servidor publicou, não um número cravado na tela', () => {
    montar()
    expect(screen.getByText(/Até 10 MB por arquivo e 10 arquivos/)).toBeInTheDocument()

    anexar([arquivoDe('manual.pdf', 12 * MB)])
    expect(screen.getByText(/“manual\.pdf”.*limite por arquivo é 10 MB/)).toBeInTheDocument()
    expect(screen.queryByText('manual.pdf', { selector: '.compositor__anexo-nome' })).not.toBeInTheDocument()

    anexar([arquivoDe('boleto.pdf', 9 * MB)])
    expect(screen.getByText('boleto.pdf', { selector: '.compositor__anexo-nome' })).toBeInTheDocument()
  })

  it('com a configuração ainda carregando, não recusa anexo por um limite inventado', () => {
    servidor.sistema = undefined
    montar()
    expect(screen.getByText(/o limite de tamanho vem da configuração do sistema/)).toBeInTheDocument()

    anexar([arquivoDe('video.pdf', 30 * MB)])
    expect(screen.getByText('video.pdf', { selector: '.compositor__anexo-nome' })).toBeInTheDocument()
    expect(screen.queryByText(/acima de/)).not.toBeInTheDocument()
  })

  it('respeita o limite de QUANTIDADE de arquivos do servidor', () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_files_per_message: 2 }
    montar()

    anexar([arquivoDe('a.pdf', 1024), arquivoDe('b.pdf', 1024), arquivoDe('c.pdf', 1024)])

    expect(screen.getByText(/Máximo de 2 arquivo\(s\) por mensagem/)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem').filter((li) => li.className.includes('compositor__anexo'))).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Anexar/ })).toBeDisabled()
  })

  it('respeita o limite somado por mensagem do servidor', () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_bytes_per_message: 15 * MB }
    montar()

    anexar([arquivoDe('a.pdf', 9 * MB), arquivoDe('b.pdf', 9 * MB)])

    expect(screen.getByText(/o total passaria de 15 MB por mensagem/)).toBeInTheDocument()
    expect(screen.getByText('a.pdf', { selector: '.compositor__anexo-nome' })).toBeInTheDocument()
    expect(screen.queryByText('b.pdf', { selector: '.compositor__anexo-nome' })).not.toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Erro do servidor no campo certo
  // ------------------------------------------------------------------

  it('anexo recusado pelo servidor aparece no campo e avisa que nenhum chamado foi aberto', async () => {
    abrirMock.mockRejectedValue(
      new ApiError(400, { files: "'manual.pdf' tem 12 MB; o limite por arquivo é 10 MB." }),
    )
    montar()
    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(
      await screen.findByText(/'manual\.pdf' tem 12 MB; o limite por arquivo é 10 MB\./),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nenhum chamado foi aberto/)).toBeInTheDocument()
    // nada de "Erro 400" solto no topo, e o foco vai para onde se troca o arquivo
    expect(screen.queryByText(/Erro 400/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Anexar/ })).toHaveFocus()
  })

  it('"Cliente não encontrado." do servidor cai no campo Para', async () => {
    abrirMock.mockRejectedValue(new ApiError(400, { requester_id: 'Cliente não encontrado.' }))
    montar()
    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByText('Cliente não encontrado.')).toBeInTheDocument()
    expect(campoPara()).toHaveFocus()
    expect(campoPara()).toHaveAttribute('aria-invalid', 'true')
  })

  it('erro que não é de campo desta tela vira mensagem geral, em vez de sumir', async () => {
    abrirMock.mockRejectedValue(new ApiError(400, { non_field_errors: ['Equipe sem agente ativo.'] }))
    montar()
    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByText('Equipe sem agente ativo.')).toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Rascunho
  // ------------------------------------------------------------------

  it('volta com o que estava escrito quando a tela é reaberta, e deixa descartar', async () => {
    const tela = montar()
    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto em duplicidade' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Segue o comprovante.' } })
    fireEvent.change(screen.getByLabelText(/^Nº do pedido/), { target: { value: 'PED-9' } })

    // a gravação tem folga; só depois dela a saída da tela é segura
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    tela.unmount()

    montar()
    expect(await screen.findByText(/Recuperamos o chamado que você tinha começado/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('Boleto em duplicidade')
    expect(screen.getByLabelText(/^Mensagem/)).toHaveValue('Segue o comprovante.')
    expect(screen.getByLabelText(/^Equipe/)).toHaveValue('2')
    expect(screen.getByLabelText(/^Nº do pedido/)).toHaveValue('PED-9')

    fireEvent.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('')
    expect(screen.getByLabelText(/^Mensagem/)).toHaveValue('')
    expect(screen.getByLabelText(/^Equipe/)).toHaveValue('')
    expect(screen.queryByText(/Recuperamos o chamado/)).not.toBeInTheDocument()
  })

  it('rascunho com solicitante que sumiu do diretório volta pedindo a escolha, sem id fantasma', async () => {
    const tela = montar()
    fireEvent.change(campoPara(), { target: { value: 'carla' } })
    fireEvent.click(await screen.findByRole('option', { name: /Carla Costa/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto' } })
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    tela.unmount()

    // desativada entre uma visita e outra
    servidor.clientes = CLIENTES.filter((c) => c.id !== 5)
    montar()

    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('Boleto')
    expect(campoPara()).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))
    expect(await screen.findByText('Escolha para quem o chamado é aberto.')).toBeInTheDocument()
    expect(abrirMock).not.toHaveBeenCalled()
  })

  it('chamado aberto não deixa rascunho para a próxima abertura', async () => {
    abrirMock.mockResolvedValue({ ticket: { id: 42, reference: 'TD-00042' }, pendencias: [] })
    const tela = montar()
    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))
    expect(await screen.findByText('detalhe do chamado')).toBeInTheDocument()
    tela.unmount()

    montar()
    expect(screen.queryByText(/Recuperamos o chamado/)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('')
  })

  it('só a triagem preenchida já conta como trabalho a perder ao cancelar', () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false)
    montar()
    // nem assunto, nem mensagem, nem solicitante: só o painel de triagem
    fireEvent.change(screen.getByLabelText(/^Nº do pedido/), { target: { value: 'PED-9' } })

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(confirmar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('lista de chamados')).not.toBeInTheDocument()
    confirmar.mockRestore()
  })

  // ------------------------------------------------------------------
  // Acessibilidade dos erros
  // ------------------------------------------------------------------

  it('campo inválido é anunciado como inválido e aponta para o erro e para a ajuda', async () => {
    montar()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    const equipe = await screen.findByLabelText(/^Equipe/)
    const erro = screen.getByText('Escolha a equipe que vai atender.')
    const ajuda = screen.getByText('Quem vai atender o chamado.')
    expect(equipe).toHaveAttribute('aria-invalid', 'true')
    expect(equipe.getAttribute('aria-describedby')).toContain(erro.id)
    expect(equipe.getAttribute('aria-describedby')).toContain(ajuda.id)
    // a mensagem diz o que fazer, não "campo obrigatório"
    expect(erro).toHaveAttribute('role', 'alert')
  })

  it('erro de mensagem e erro de anexo convivem sem repetir id na página', async () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_files_per_message: 1 }
    montar()
    anexar([arquivoDe('a.pdf', 1024), arquivoDe('b.pdf', 1024)])
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    expect(await screen.findByText(/Escreva a mensagem/)).toBeInTheDocument()
    expect(screen.getByText(/Máximo de 1 arquivo\(s\) por mensagem/)).toBeInTheDocument()
    expect(idsRepetidos()).toEqual([])
  })

  it('a ajuda de anexo e o erro do anexo estão ligados ao botão Anexar', () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_files_per_message: 1 }
    montar()
    const anexarBtn = screen.getByRole('button', { name: /Anexar/ })
    const ajuda = screen.getByText(/Até 10 MB por arquivo/)
    expect(anexarBtn.getAttribute('aria-describedby')).toContain(ajuda.id)

    anexar([arquivoDe('a.pdf', 1024), arquivoDe('b.pdf', 1024)])
    const erro = screen.getByText(/Máximo de 1 arquivo\(s\) por mensagem/)
    expect(anexarBtn.getAttribute('aria-describedby')).toContain(erro.id)
  })
})
