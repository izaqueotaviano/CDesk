import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { PaginaNovoTicket } from './PaginaNovoTicket'

const abrirMock = vi.hoisted(() => vi.fn())
const recarregarEquipesMock = vi.hoisted(() => vi.fn())
const recarregarCategoriasMock = vi.hoisted(() => vi.fn())
const recarregarBuscaMock = vi.hoisted(() => vi.fn())
/** `api.get` de `@/api/client` — as duas consultas que esta tela faz direto
 *  (sem hook em `cvz/tickets/dados`, que é de outro agente): reidratar o
 *  solicitante do rascunho (`/users/{id}/`) e o aviso de chamados abertos
 *  (`/tickets/?company=...`). Implementação fixada uma vez (lê `servidor.*`
 *  a cada chamada); só o HISTÓRICO de chamadas é limpo entre testes. */
const apiGetMock = vi.hoisted(() => vi.fn())
vi.mock('@/api/client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/api/client')>()
  return { ...real, api: { ...real.api, get: apiGetMock } }
})

/** Mutável: cada teste diz o que o servidor respondeu — inclusive "ainda não
 *  respondeu" (`sistema`) e "respondeu com erro" (`*Erro`, item 17: um 500
 *  não pode ficar indistinguível de "ainda carregando"). */
const servidor = vi.hoisted(() => ({
  me: undefined as unknown,
  sistema: undefined as unknown,
  solicitantes: [] as {
    id: number
    full_name: string
    email: string
    company_id: number | null
    company_name: string | null
    is_active: boolean
  }[],
  equipesErro: false,
  categoriasErro: false,
  buscaSolicitantesErro: false,
  // `/api/v1/tickets/?company=...` — resposta padrão é "nenhum aberto"
  // (Paginado<{id,reference}>); cada teste do aviso de duplicidade troca.
  chamadosAbertos: {
    count: 0,
    next: null,
    previous: null,
    results: [] as { id: number; reference: string }[],
  },
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
  signature_kind: 'texto' as const,
  signature_html: '',
  signature_image_url: '',
  // é o bloco pronto do servidor que a tela mostra e usa para decidir se
  // oferece "incluir minha assinatura"
  signature_render: 'Samuel — Suporte Resolv',
  // Admin recebe TODO o catálogo por construção (apps/accounts/rbac.py
  // `_ADMIN_PERMS`) — sem isto o mock mentia um admin sem
  // `ticket.edit_properties`, permissão que qualquer admin real tem.
  permissions: ['ticket.edit_properties'],
}

const EQUIPES = [
  { id: 1, name: 'Suporte', slug: 'suporte', visibility: 'public', order: 1 },
  { id: 2, name: 'Financeiro', slug: 'financeiro', visibility: 'public', order: 2 },
]
const EMPRESAS = [
  { id: 1, name: 'Acme Marketing', slug: 'acme', plan_name: 'Pro', is_active: true },
  { id: 2, name: 'Bravo Educação', slug: 'bravo', plan_name: 'Start', is_active: true },
]
/** Formato de `SolicitanteEncontrado` (frontend/src/api/busca.ts) — o que
 *  `GET /api/v1/search/` devolve em `requesters`. `id: 6` fica inativa de
 *  propósito: prova que a tela filtra fora quem `create_ticket` recusaria. */
const SOLICITANTES = [
  {
    id: 2,
    full_name: 'Beto Barros',
    email: 'beto@acme.test',
    company_id: 1,
    company_name: 'Acme Marketing',
    is_active: true,
  },
  {
    id: 4,
    full_name: 'Ana Almeida',
    email: 'ana@acme.test',
    company_id: 1,
    company_name: 'Acme Marketing',
    is_active: true,
  },
  {
    id: 5,
    full_name: 'Carla Costa',
    email: 'carla@bravo.test',
    company_id: 2,
    company_name: 'Bravo Educação',
    is_active: true,
  },
  {
    id: 6,
    full_name: 'Duda Desativada',
    email: 'duda@acme.test',
    company_id: 1,
    company_name: 'Acme Marketing',
    is_active: false,
  },
]
const AGENTES = [
  {
    id: 3,
    full_name: 'Samuel Suporte',
    email: 'samuel@demo.test',
    kind: 'internal',
    internal_role: 'agent',
    company: null,
    presence: 'available',
  },
  {
    id: 9,
    full_name: 'Fátima Financeiro',
    email: 'fatima@demo.test',
    kind: 'internal',
    internal_role: 'agent',
    company: null,
    presence: 'available',
  },
]
const MACROS = [
  {
    id: 1,
    name: 'Boas-vindas',
    body: 'Olá, {{solicitante}}! Recebemos o pedido da {{empresa}}.',
    priority: 'high',
    category: null,
    assignee: null,
    tags: [],
    is_active: true,
  },
]
const ETIQUETAS = [{ id: 1, name: 'Urgente-VIP', color: '#e00' }]

vi.mock('@/api/queries/useMe', () => ({ useMe: () => ({ data: servidor.me }) }))
vi.mock('@/cvz/configuracoes/dados', () => ({
  useSistemaCfg: () => ({ data: servidor.sistema }),
}))
vi.mock('@/cvz/tickets/dados', () => ({
  useEquipes: () =>
    servidor.equipesErro
      ? { data: undefined, isError: true, refetch: recarregarEquipesMock }
      : { data: EQUIPES, isError: false, refetch: recarregarEquipesMock },
  useServicos: () => ({ data: [] }),
  useCategorias: () =>
    servidor.categoriasErro
      ? { data: undefined, isError: true, refetch: recarregarCategoriasMock }
      : { data: [], isError: false, refetch: recarregarCategoriasMock },
  useEmpresasOpcoes: () => ({ data: EMPRESAS }),
  useAgentes: () => ({ data: AGENTES }),
  useEtiquetas: () => ({ data: ETIQUETAS }),
  useEstimativaResposta: (slug: string | null) => ({
    data: slug ? { label: '2 h', minutes: 120, sample: 12 } : undefined,
  }),
  useAbrirTicket: () => ({ mutateAsync: abrirMock, isPending: false }),
}))
vi.mock('../detalhe/dados', () => ({ useMacros: () => ({ data: MACROS }) }))
// Mesmo hook do cabeçalho (frontend/src/api/busca.ts) — BuscaPessoa não busca
// mais em memória, então quem alimenta o campo "Para" aqui é este mock, não
// mais `useClientes`. Filtro por nome/e-mail replica o que a VIEW real faz
// (`full_name`/`email`, `icontains`); `MINIMO_PARA_BUSCAR` replica o corte de
// 2 caracteres — abaixo disso a consulta real nem sai (`enabled`), então o
// mock devolve `data: undefined` do mesmo jeito, com ou sem erro configurado.
vi.mock('@/api/busca', () => ({
  MINIMO_PARA_BUSCAR: 2,
  useBuscaGlobal: (termo: string) => {
    const q = termo.trim().toLowerCase()
    if (q.length < 2) {
      return { data: undefined, isLoading: false, isError: false, refetch: recarregarBuscaMock }
    }
    if (servidor.buscaSolicitantesErro) {
      return { data: undefined, isLoading: false, isError: true, refetch: recarregarBuscaMock }
    }
    const requesters = servidor.solicitantes.filter(
      (s) => s.full_name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q),
    )
    return {
      data: { tickets: [], companies: [], requesters },
      isLoading: false,
      isError: false,
      refetch: recarregarBuscaMock,
    }
  },
}))

apiGetMock.mockImplementation((path: string) => {
  if (path.startsWith('/api/v1/tickets/')) {
    return Promise.resolve(servidor.chamadosAbertos)
  }
  const usuario = path.match(/^\/api\/v1\/users\/(\d+)\/$/)
  if (usuario) {
    // UserViewSet.get_queryset só devolve `is_active=True` — id sumido ou
    // desativado dá 404, mesmo caso de "sumiu do diretório" de antes.
    const s = servidor.solicitantes.find((x) => x.id === Number(usuario[1]) && x.is_active)
    if (!s) return Promise.reject(new ApiError(404, { detail: 'Não encontrado.' }))
    return Promise.resolve({
      id: s.id,
      full_name: s.full_name,
      email: s.email,
      kind: 'client',
      internal_role: null,
      company: s.company_id,
      presence: 'offline',
    })
  }
  return Promise.reject(new Error(`GET não mockado neste teste: ${path}`))
})

function montar(endereco = '/chamados/novo') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[endereco]}>
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

/** Busca (2+ letras — abaixo disso a consulta nem sai, ver o mock acima) e
 *  escolhe pelo NOME completo. As 4 primeiras letras bastam pra achar cada
 *  pessoa do mock sem ambiguidade. */
async function preencherObrigatorios(nomeCliente = 'Beto Barros') {
  fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '1' } })
  fireEvent.change(campoPara(), { target: { value: nomeCliente.slice(0, 4) } })
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(nomeCliente) }))
  fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto errado' } })
  fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Olá, segue.' } })
}

beforeEach(() => {
  abrirMock.mockReset()
  recarregarEquipesMock.mockReset()
  recarregarCategoriasMock.mockReset()
  recarregarBuscaMock.mockReset()
  apiGetMock.mockClear()
  servidor.me = ME
  servidor.sistema = CFG_SISTEMA
  servidor.solicitantes = SOLICITANTES
  servidor.equipesErro = false
  servidor.categoriasErro = false
  servidor.buscaSolicitantesErro = false
  servidor.chamadosAbertos = { count: 0, next: null, previous: null, results: [] }
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

  it('aberto pela página do cliente (`?empresa=`), já nasce com a empresa escolhida', () => {
    montar('/chamados/novo?empresa=2')
    expect(screen.getByLabelText('Empresa')).toHaveValue('2')
  })

  it('a empresa da URL vence a do rascunho de outra visita', () => {
    localStorage.setItem(
      'resolv:novo-chamado',
      JSON.stringify({ versao: 1, dados: { empresaId: 1, assunto: 'Antigo' } }),
    )
    montar('/chamados/novo?empresa=2')
    expect(screen.getByLabelText('Empresa')).toHaveValue('2')
  })

  it('navega a lista de pessoas pelo teclado', async () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'ana' } })
    // espera o resultado do servidor chegar (debounce de 250ms) antes de
    // navegar — antes disso a lista ainda é a de um termo anterior (vazio).
    await screen.findByRole('option', { name: /Ana Almeida/ })
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
    // a macro também trouxe a prioridade
    expect(screen.getByLabelText('Prioridade')).toHaveValue('high')
  })

  it('envia o chamado assinado — a assinatura vai como marca, não colada no texto', async () => {
    abrirMock.mockResolvedValue({ ticket: { id: 42, reference: 'TD-00042' }, pendencias: [] })
    montar()

    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '2' } })
    fireEvent.change(campoPara(), { target: { value: 'beto' } })
    fireEvent.click(await screen.findByRole('option', { name: /Beto Barros/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto errado' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), {
      target: { value: 'Olá, segue o boleto.' },
    })

    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    await waitFor(() => expect(abrirMock).toHaveBeenCalledTimes(1))
    expect(abrirMock.mock.calls[0][0]).toMatchObject({
      team_id: 2,
      requester_id: 2,
      subject: 'Boleto errado',
      priority: 'normal',
      // o corpo é só o que a pessoa escreveu: quem desenha o rodapé é o
      // servidor, a partir do perfil (apps/accounts/assinatura.py) — foi o
      // que permitiu assinatura em imagem e em HTML
      body: 'Olá, segue o boleto.',
      with_signature: true,
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
    await preencherObrigatorios('Ana Almeida')
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
    await preencherObrigatorios('Ana Almeida')
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    fireEvent.click(
      await screen.findByRole('button', { name: 'Abrir outro chamado para Ana Almeida' }),
    )

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
    expect(
      screen.queryByText('manual.pdf', { selector: '.compositor__anexo-nome' }),
    ).not.toBeInTheDocument()

    anexar([arquivoDe('boleto.pdf', 9 * MB)])
    expect(
      screen.getByText('boleto.pdf', { selector: '.compositor__anexo-nome' }),
    ).toBeInTheDocument()
  })

  it('com a configuração ainda carregando, não recusa anexo por um limite inventado', () => {
    servidor.sistema = undefined
    montar()
    expect(
      screen.getByText(/o limite de tamanho vem da configuração do sistema/),
    ).toBeInTheDocument()

    anexar([arquivoDe('video.pdf', 30 * MB)])
    expect(
      screen.getByText('video.pdf', { selector: '.compositor__anexo-nome' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/acima de/)).not.toBeInTheDocument()
  })

  it('respeita o limite de QUANTIDADE de arquivos do servidor', () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_files_per_message: 2 }
    montar()

    anexar([arquivoDe('a.pdf', 1024), arquivoDe('b.pdf', 1024), arquivoDe('c.pdf', 1024)])

    expect(screen.getByText(/Máximo de 2 arquivo\(s\) por mensagem/)).toBeInTheDocument()
    expect(
      screen.getAllByRole('listitem').filter((li) => li.className.includes('compositor__anexo')),
    ).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Anexar/ })).toBeDisabled()
  })

  it('respeita o limite somado por mensagem do servidor', () => {
    servidor.sistema = { ...CFG_SISTEMA, attachment_max_bytes_per_message: 15 * MB }
    montar()

    anexar([arquivoDe('a.pdf', 9 * MB), arquivoDe('b.pdf', 9 * MB)])

    expect(screen.getByText(/o total passaria de 15 MB por mensagem/)).toBeInTheDocument()
    expect(screen.getByText('a.pdf', { selector: '.compositor__anexo-nome' })).toBeInTheDocument()
    expect(
      screen.queryByText('b.pdf', { selector: '.compositor__anexo-nome' }),
    ).not.toBeInTheDocument()
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
    abrirMock.mockRejectedValue(
      new ApiError(400, { non_field_errors: ['Equipe sem agente ativo.'] }),
    )
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
    fireEvent.change(screen.getByLabelText(/^Assunto/), {
      target: { value: 'Boleto em duplicidade' },
    })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), {
      target: { value: 'Segue o comprovante.' },
    })
    fireEvent.change(screen.getByLabelText(/^Nº do pedido/), { target: { value: 'PED-9' } })

    // a gravação tem folga; só depois dela a saída da tela é segura
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    tela.unmount()

    montar()
    expect(
      await screen.findByText(/Recuperamos o chamado que você tinha começado/),
    ).toBeInTheDocument()
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

  it('rascunho com solicitante que continua válido busca a pessoa por id e repõe o cartão', async () => {
    const tela = montar()
    fireEvent.change(campoPara(), { target: { value: 'carla' } })
    fireEvent.click(await screen.findByRole('option', { name: /Carla Costa/ }))
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    tela.unmount()

    montar()
    // só o id sobrevive no rascunho — o nome vem de `GET /api/v1/users/5/`
    // (`useSolicitantePorId`), não de uma lista que a tela não carrega mais
    expect(
      await screen.findByText('carla@bravo.test · Bravo Educação', {
        selector: '.novo__cliente-meta',
      }),
    ).toBeInTheDocument()
    expect(campoPara()).toHaveValue('Carla Costa')
  })

  it('rascunho com solicitante que sumiu do diretório volta pedindo a escolha, sem id fantasma', async () => {
    const tela = montar()
    fireEvent.change(campoPara(), { target: { value: 'carla' } })
    fireEvent.click(await screen.findByRole('option', { name: /Carla Costa/ }))
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Boleto' } })
    await waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    tela.unmount()

    // desativada entre uma visita e outra: `GET /users/5/` passa a dar 404
    // (UserViewSet.get_queryset só traz is_active=True)
    servidor.solicitantes = SOLICITANTES.filter((s) => s.id !== 5)
    montar()

    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('Boleto')
    expect(campoPara()).toHaveValue('')
    // sem equipe escolhida o botão já reprovaria por outro motivo — o que
    // importa aqui é que o clique NUNCA chega a mandar `requester_id: 5`;
    // `waitFor` reclica até o 404 assentar e a mensagem certa aparecer.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))
      expect(screen.getByText('Escolha para quem o chamado é aberto.')).toBeInTheDocument()
    })
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

  // ------------------------------------------------------------------
  // Agente sem equipe: beco sem saída (item 13)
  // ------------------------------------------------------------------

  it('agente sem nenhuma equipe vê o estado explicativo, não o formulário condenado', () => {
    servidor.me = { ...ME, is_admin: false, teams: [] }
    montar()

    expect(screen.getByText('Você não atende nenhuma equipe.')).toBeInTheDocument()
    // nada de formulário: preencher aqui nunca abriria chamado (team_id é obrigatório no backend)
    expect(screen.queryByLabelText(/^Mensagem/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Equipe/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Voltar para a fila' }))
    expect(screen.getByText('lista de chamados')).toBeInTheDocument()
  })

  it('admin com `teams` vazio continua vendo o formulário — o recorte por equipe não vale para admin', () => {
    // `equipesDisponiveis` só filtra por `me.teams` quando NÃO é admin
    // (ticket_service.create_ticket não recorta admin): `teams: []` bastaria
    // para zerar a lista de um agente comum, mas para o admin não conta —
    // `semEquipe` exige `!me.is_admin` de propósito.
    servidor.me = { ...ME, is_admin: true, teams: [] }
    montar()
    expect(screen.getByLabelText(/^Mensagem/)).toBeInTheDocument()
    expect(screen.queryByText('Você não atende nenhuma equipe.')).not.toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Equipe única: pré-seleciona (item da vez — evita o primeiro campo a
  // reprovar quando não há alternativa nenhuma pra escolher)
  // ------------------------------------------------------------------

  it('com uma equipe só, o campo já nasce preenchido e a estimativa aparece sem precisar selecionar', async () => {
    servidor.me = { ...ME, is_admin: false, teams: ['suporte'] }
    montar()

    expect(screen.getByLabelText(/^Equipe/)).toHaveValue('1')
    expect(await screen.findByText('Primeira resposta costuma sair em 2 h.')).toBeInTheDocument()
  })

  it('com mais de uma equipe disponível, o campo continua nascendo vazio', () => {
    montar() // ME (admin) enxerga as 2 equipes do mock
    expect(screen.getByLabelText(/^Equipe/)).toHaveValue('')
  })

  // ------------------------------------------------------------------
  // Permissão: responsável e etiquetas exigem ticket.edit_properties (item 12)
  // ------------------------------------------------------------------

  it('sem "ticket.edit_properties" a tela não oferece responsável nem etiquetas', () => {
    servidor.me = { ...ME, permissions: [] }
    montar()

    expect(screen.queryByLabelText('Responsável')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atribuir para mim' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Urgente-VIP' })).not.toBeInTheDocument()
  })

  it('com a permissão, responsável e etiquetas continuam disponíveis', () => {
    montar() // ME já tem ticket.edit_properties (ver beforeEach)
    expect(screen.getByLabelText('Responsável')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Urgente-VIP' })).toBeInTheDocument()
  })

  it('sem a permissão, o envio não aplica responsável/etiquetas por baixo dos panos', async () => {
    servidor.me = { ...ME, permissions: [] }
    abrirMock.mockResolvedValue({ ticket: { id: 51, reference: 'TD-00051' }, pendencias: [] })
    montar()
    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))

    await waitFor(() => expect(abrirMock).toHaveBeenCalledTimes(1))
    expect(abrirMock.mock.calls[0][0]).toMatchObject({ assignee_id: null, tag_ids: [] })
  })

  // ------------------------------------------------------------------
  // Consulta em erro não pode ficar idêntica a "ainda carregando" (item 17)
  // ------------------------------------------------------------------

  it('equipes em erro mostram mensagem real, não "Carregando…" para sempre, e "tentar de novo" refaz a consulta', () => {
    servidor.equipesErro = true
    montar()

    expect(screen.getByText('Não foi possível carregar as equipes.')).toBeInTheDocument()
    expect(screen.queryByText('Carregando…', { selector: 'option' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(recarregarEquipesMock).toHaveBeenCalledTimes(1)
  })

  it('categorias em erro avisam e permitem "tentar de novo", mas não travam o envio — categoria é opcional', async () => {
    servidor.categoriasErro = true
    abrirMock.mockResolvedValue({ ticket: { id: 52, reference: 'TD-00052' }, pendencias: [] })
    montar()

    expect(screen.getByText('Não foi possível carregar as categorias.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(recarregarCategoriasMock).toHaveBeenCalledTimes(1)

    await preencherObrigatorios()
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))
    await waitFor(() => expect(abrirMock).toHaveBeenCalledTimes(1))
    expect(abrirMock.mock.calls[0][0]).toMatchObject({ category_id: null })
  })

  it('busca de solicitante em erro mostra falha real no campo "Para", não a mentira de "ninguém encontrado"', async () => {
    servidor.buscaSolicitantesErro = true
    montar() // a tela já abre com foco em "Para"

    fireEvent.change(campoPara(), { target: { value: 'ana' } })
    // duas cópias de propósito: uma visível na lista (`--erro`), outra só
    // para leitor de tela no `aria-live` — por isso `findAllByText`.
    expect(
      (await screen.findAllByText('Não foi possível carregar as pessoas.')).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText('Não foi possível carregar os clientes.')).toBeInTheDocument()
    expect(screen.queryByText(/Ninguém com esse nome/)).not.toBeInTheDocument()

    // duas ofertas de retry (a de dentro da lista e a de baixo do campo) —
    // as duas chamam a mesma função, então clicar qualquer uma serve.
    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar de novo' })[0])
    expect(recarregarBuscaMock).toHaveBeenCalledTimes(1)
  })

  it('Enter no campo "Para" também aciona o "tentar de novo" — o foco nunca sai do input (combobox ARIA)', async () => {
    servidor.buscaSolicitantesErro = true
    montar()
    fireEvent.change(campoPara(), { target: { value: 'ana' } })
    await screen.findAllByText('Não foi possível carregar as pessoas.')

    fireEvent.keyDown(campoPara(), { key: 'Enter' })
    expect(recarregarBuscaMock).toHaveBeenCalledTimes(1)
  })

  // ------------------------------------------------------------------
  // Busca de solicitante no SERVIDOR (item da vez): sem teto de 500, sem
  // oferecer quem o servidor sempre recusaria
  // ------------------------------------------------------------------

  it('com menos de 2 letras, avisa que precisa digitar mais, sem chamar de "ninguém encontrado"', () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'a' } })
    expect(screen.getByText('Digite ao menos 2 letras para buscar.', { selector: 'p' })).toBeVisible()
    expect(screen.queryByText(/Ninguém com esse nome/)).not.toBeInTheDocument()
    // Só a dica, sem ninguém para escolher: a lista flutuante nem abre (ela
    // cobria o rótulo do Assunto sem oferecer escolha nenhuma).
    expect(campoPara()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('solicitante inativo não aparece na busca — create_ticket sempre recusaria a abertura por ele', async () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'duda' } })
    expect(await screen.findByText(/Ninguém com esse nome/)).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Duda Desativada/ })).not.toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Aviso de possível duplicata: cliente já com chamado aberto (item da vez)
  // ------------------------------------------------------------------

  it('avisa que o cliente já tem chamado aberto, buscando pela empresa DELE, sem bloquear o envio', async () => {
    servidor.chamadosAbertos = {
      count: 2,
      next: null,
      previous: null,
      results: [
        { id: 101, reference: 'TCK-0101' },
        { id: 102, reference: 'TCK-0102' },
      ],
    }
    montar()
    fireEvent.change(campoPara(), { target: { value: 'beto' } })
    fireEvent.click(await screen.findByRole('option', { name: /Beto Barros/ }))

    const aviso = await screen.findByRole('status')
    expect(aviso).toHaveTextContent(/Beto Barros já tem 2 chamados abertos que você enxerga/)
    expect(screen.getByRole('link', { name: 'TCK-0101' })).toHaveAttribute('href', '/chamados/101')
    expect(screen.getByRole('link', { name: 'TCK-0101' })).toHaveAttribute('target', '_blank')

    // company DELE (1, de Beto/Acme), não um filtro solto
    const chamadaTickets = apiGetMock.mock.calls
      .map((c) => String(c[0]))
      .find((p) => p.startsWith('/api/v1/tickets/'))
    expect(chamadaTickets).toContain('company=1')
    expect(chamadaTickets).toContain('status=new,open,pending_customer')

    // é aviso, não trava: o envio continua livre
    abrirMock.mockResolvedValue({ ticket: { id: 9, reference: 'TD-00009' }, pendencias: [] })
    fireEvent.change(screen.getByLabelText(/^Equipe/), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/^Assunto/), { target: { value: 'Outro caso' } })
    fireEvent.change(screen.getByLabelText(/^Mensagem/), { target: { value: 'Mais um.' } })
    fireEvent.click(screen.getByRole('button', { name: /abrir chamado/i }))
    await waitFor(() => expect(abrirMock).toHaveBeenCalledTimes(1))
  })

  it('sem chamado aberto, fica em silêncio — 0 é diferente de "não dá pra checar"', async () => {
    montar()
    fireEvent.change(campoPara(), { target: { value: 'beto' } })
    fireEvent.click(await screen.findByRole('option', { name: /Beto Barros/ }))

    await waitFor(() =>
      expect(apiGetMock.mock.calls.some((c) => String(c[0]).startsWith('/api/v1/tickets/'))).toBe(
        true,
      ),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('solicitante sem empresa: não dá pra checar chamado aberto, e por isso não mostra nada', async () => {
    servidor.solicitantes = [
      ...SOLICITANTES,
      {
        id: 7,
        full_name: 'Elis Sem Empresa',
        email: 'elis@semempresa.test',
        company_id: null,
        company_name: null,
        is_active: true,
      },
    ]
    montar()
    fireEvent.change(campoPara(), { target: { value: 'Elis' } })
    fireEvent.click(await screen.findByRole('option', { name: /Elis Sem Empresa/ }))

    await screen.findByText(/aberto por você/)
    expect(apiGetMock.mock.calls.some((c) => String(c[0]).startsWith('/api/v1/tickets/'))).toBe(
      false,
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
