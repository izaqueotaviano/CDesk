import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { useTabs } from '@/stores/tabs'
import { Compositor } from './Compositor'
import type { DadosResposta } from './dados'
import type { TicketDetalhe } from './tiposDetalhe'

const responderMock = vi.hoisted(() => vi.fn())
const aplicarMacroMock = vi.hoisted(() => vi.fn())

// `let` para o menu de macro poder testar com uma lista de verdade — os
// outros testes deste arquivo continuam sem macro nenhuma (o padrão), então
// o valor volta para `[]` no beforeEach.
let macros: import('./tiposDetalhe').Macro[] = []

vi.mock('./dados', () => ({
  useMacros: () => ({ data: macros }),
  useAcoesTicket: () => ({
    responder: { mutate: responderMock, isPending: false },
    aplicarMacro: { mutate: aplicarMacroMock },
  }),
}))

// Os limites são configuração do servidor (GET /api/v1/settings/system/), então
// o teste manda os números — nenhum deles é constante da tela.
const CONFIG_PADRAO = {
  attachment_max_bytes: 10 * 1024 * 1024,
  attachment_max_mb: 10,
  attachment_max_files_per_message: 3,
  attachment_max_bytes_per_message: 20 * 1024 * 1024,
  attachment_max_mb_per_message: 20,
}
let config: typeof CONFIG_PADRAO | undefined = CONFIG_PADRAO

vi.mock('@/cvz/configuracoes/dados', () => ({
  useSistemaCfg: () => ({ data: config }),
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
  permissions: ['ticket.reply_public', 'ticket.add_internal_note'],
  ticket_scope: 'team',
  custom_role_name: '',
  avatar_url: '',
  job_title: '',
  phone: '',
  ui_density: 'comfortable',
  signature: '',
}

const TICKET: TicketDetalhe = {
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
  assignee_name: 'Samuel Suporte',
  assignee_id: 3,
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
  requester: {
    name: 'Beto Barros',
    email: 'beto@acme.test',
    ui_language: 'pt-br',
    timezone: 'America/Sao_Paulo',
  },
}

/** File com o tamanho que o teste precisa — `new File(['x'], …)` tem 1 byte, e
 *  a regra em teste é justamente sobre bytes. */
function arquivo(nome: string, bytes: number): File {
  const f = new File(['x'], nome)
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

const MB = 1024 * 1024

function montar(pedidoReabrir = 0, me = ME) {
  return render(<Compositor ticket={TICKET} me={me} pedidoReabrir={pedidoReabrir} />)
}

// `podeMacro` (Compositor.tsx) exige a permissão 'macro.use' — ME não tem
// (é o fixture "sem macro" que o resto do arquivo usa de propósito).
const ME_COM_MACRO: Me = { ...ME, permissions: [...ME.permissions, 'macro.use'] }

function entradaDeArquivo(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('input de anexo não encontrado')
  return input
}

function escolher(container: HTMLElement, ...arquivos: File[]) {
  fireEvent.change(entradaDeArquivo(container), { target: { files: arquivos } })
}

const corpoEnviado = () => (responderMock.mock.calls[0]?.[0] as DadosResposta | undefined) ?? null

beforeEach(() => {
  responderMock.mockReset()
  aplicarMacroMock.mockReset()
  config = CONFIG_PADRAO
  macros = []
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
})

describe('Compositor — anexo conferido antes de subir', () => {
  it('anuncia o limite que o servidor publica, não um número escrito na tela', () => {
    // Os bytes são a fonte: o MB anunciado é derivado deles (mesma divisão do
    // SystemConfigSerializer), então mexer só no `_mb` produziria uma resposta
    // que o servidor nunca manda — a tela diria 25 e compararia com 10.
    config = {
      ...CONFIG_PADRAO,
      attachment_max_bytes: 25 * 1024 * 1024,
      attachment_max_mb: 25,
      attachment_max_files_per_message: 4,
    }
    montar()

    expect(
      screen.getByText(/Até 25 MB por arquivo · 4 arquivos · 20 MB no total/),
    ).toBeInTheDocument()
  })

  it('recusa na hora o arquivo acima do limite por arquivo, sem chamar o servidor', () => {
    const { container } = montar()

    escolher(container, arquivo('manual.pdf', 15 * MB))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '“manual.pdf” tem 15,0 MB; o limite por arquivo é 10 MB.',
    )
    expect(screen.queryByText('manual.pdf')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Enviar resposta/ })).toBeDisabled()
    expect(responderMock).not.toHaveBeenCalled()
  })

  it('recusa extensão que o backend bloqueia por lista, não por magic bytes', () => {
    const { container } = montar()

    escolher(container, arquivo('instalador.sh', 1024))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Tipo de arquivo não permitido: “instalador.sh”.',
    )
    expect(screen.queryByText('instalador.sh')).not.toBeInTheDocument()
  })

  it('mantém o que cabe e recusa só o que não cabe, dizendo qual arquivo ficou de fora', () => {
    const { container } = montar()

    escolher(container, arquivo('print.png', 2 * MB), arquivo('dump.zip', 30 * MB))

    expect(screen.getByText('print.png')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('“dump.zip”')
    expect(screen.queryByText('dump.zip')).not.toBeInTheDocument()
  })

  it('recusa o arquivo que estoura o total da mensagem, mesmo cabendo sozinho', () => {
    const { container } = montar()

    escolher(container, arquivo('a.pdf', 9 * MB), arquivo('b.pdf', 9 * MB))
    escolher(container, arquivo('c.pdf', 9 * MB))

    expect(screen.getByRole('alert')).toHaveTextContent(
      '“c.pdf” não cabe: o total passaria de 20 MB por mensagem.',
    )
    expect(screen.queryByText('c.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.getByText('b.pdf')).toBeInTheDocument()
  })

  it('trava o "Anexar" ao chegar no máximo de arquivos por mensagem', () => {
    const { container } = montar()

    escolher(container, arquivo('1.png', 1024), arquivo('2.png', 1024), arquivo('3.png', 1024))

    expect(screen.getByRole('button', { name: /Anexar/ })).toBeDisabled()
  })

  it('barra no envio o anexo que passou a estourar o limite depois de escolhido', () => {
    const { container, rerender } = montar()
    escolher(container, arquivo('print.png', 8 * MB))
    expect(screen.getByText('print.png')).toBeInTheDocument()

    // a configuração chegou (ou mudou) depois da escolha: 5 MB por arquivo
    config = { ...CONFIG_PADRAO, attachment_max_bytes: 5 * MB, attachment_max_mb: 5 }
    rerender(<Compositor ticket={TICKET} me={ME} pedidoReabrir={0} />)
    fireEvent.click(screen.getByRole('button', { name: /Enviar resposta/ }))

    expect(responderMock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('o limite por arquivo é 5 MB')
    expect(screen.getByRole('alert')).toHaveTextContent('Tire o arquivo da lista')
  })
})

describe('Compositor — enviar só com anexo', () => {
  it('envia o anexo sem texto com a legenda dos arquivos, que a tela mostra antes', () => {
    const { container } = montar()

    escolher(container, arquivo('print.png', 2 * MB), arquivo('nota.pdf', 1024))

    expect(
      screen.getByText(
        /Sem nada escrito, a mensagem vai com a legenda “Segue em anexo: print.png, nota.pdf”./,
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Enviar resposta/ }))

    expect(corpoEnviado()?.body).toBe('Segue em anexo: print.png, nota.pdf')
    expect(corpoEnviado()?.files).toHaveLength(2)
  })

  it('o texto escrito manda o texto — a legenda só entra quando não há nada escrito', () => {
    const { container } = montar()

    escolher(container, arquivo('print.png', 2 * MB))
    fireEvent.change(screen.getByLabelText('Resposta ao cliente'), {
      target: { value: '  Segue o comprovante.  ' },
    })

    expect(screen.queryByText(/Sem nada escrito/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Enviar resposta/ }))
    expect(corpoEnviado()?.body).toBe('Segue o comprovante.')
  })

  it('sem texto e sem anexo continua sem envio nenhum', () => {
    montar()

    const botao = screen.getByRole('button', { name: /Enviar resposta/ })
    expect(botao).toBeDisabled()
    fireEvent.click(botao)
    expect(responderMock).not.toHaveBeenCalled()
  })
})

describe('Compositor — "Reabrir…" e a nota interna em curso', () => {
  /** "Reabrir…" mora no CABEÇALHO e chega aqui como um contador que sobe
   *  (PaginaDetalheTicket.tsx): cada clique é um pedido novo. */
  function pedirReabertura(rerender: (ui: ReactElement) => void) {
    rerender(<Compositor ticket={TICKET} me={ME} pedidoReabrir={1} />)
  }

  function irParaNotaInterna(texto: string) {
    fireEvent.click(screen.getByRole('tab', { name: /Nota interna/ }))
    if (texto) {
      fireEvent.change(screen.getByLabelText('Nota interna'), { target: { value: texto } })
    }
  }

  it('não reclassifica sozinho a nota interna que está sendo escrita: pergunta', () => {
    const { rerender } = montar()
    irParaNotaInterna('cliente ligou irritado, tratar com calma')

    pedirReabertura(rerender)

    expect(screen.getByRole('tab', { name: /Nota interna/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('alert')).toHaveTextContent('você está escrevendo uma nota interna')
    expect(screen.getByLabelText('Nota interna')).toHaveValue(
      'cliente ligou irritado, tratar com calma',
    )
  })

  it('mantendo como nota interna, o envio continua interno', () => {
    const { rerender } = montar()
    irParaNotaInterna('conferir contrato antes de responder')
    pedirReabertura(rerender)

    fireEvent.click(screen.getByRole('button', { name: 'Manter como nota interna' }))

    expect(
      screen.queryByRole('button', { name: 'Manter como nota interna' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Salvar nota/ }))
    expect(corpoEnviado()?.is_public).toBe(false)
    expect(corpoEnviado()?.body).toBe('conferir contrato antes de responder')
  })

  it('escolhendo publicar, o mesmo texto vai como resposta ao cliente', () => {
    const { rerender } = montar()
    irParaNotaInterna('já testamos a impressora aqui')
    pedirReabertura(rerender)

    fireEvent.click(screen.getByRole('button', { name: 'Passar para resposta ao cliente' }))

    expect(screen.getByRole('tab', { name: /Responder ao cliente/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    fireEvent.click(screen.getByRole('button', { name: /Enviar resposta/ }))
    expect(corpoEnviado()?.is_public).toBe(true)
    expect(corpoEnviado()?.body).toBe('já testamos a impressora aqui')
  })

  it('com o campo vazio, "Reabrir…" continua trazendo o compositor para a resposta pública', () => {
    const { rerender } = montar()
    irParaNotaInterna('')

    pedirReabertura(rerender)

    expect(screen.getByRole('tab', { name: /Responder ao cliente/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(
      screen.queryByRole('button', { name: 'Manter como nota interna' }),
    ).not.toBeInTheDocument()
  })
})

describe('Compositor — filtro do menu de macro', () => {
  const MACROS = [
    { id: 1, name: 'Pedido de nota fiscal', body: 'Poderia enviar a nota fiscal, por favor?' },
    { id: 2, name: 'Encerramento padrão', body: 'Vamos encerrar por aqui — qualquer coisa, é só chamar.' },
    { id: 3, name: 'Solicitação de acesso', body: 'Preciso que você confirme o acesso.' },
  ]

  function abrirMenu() {
    fireEvent.click(screen.getByRole('button', { name: /Aplicar macro/ }))
  }

  function campoFiltro() {
    // getByRole('combobox') sozinho colide com o <select> nativo "Ao enviar,
    // deixar" — <select> tem role=combobox implícito.
    return screen.getByRole('combobox', { name: 'Filtrar macros por nome ou texto' })
  }

  function listaDeMacros() {
    return within(screen.getByRole('listbox', { name: 'Macros' }))
  }

  it('abre sem filtro nenhum, com as três macros visíveis', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    expect(listaDeMacros().getAllByRole('option')).toHaveLength(3)
    expect(campoFiltro()).toHaveValue('')
  })

  it('filtra por nome', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    fireEvent.change(campoFiltro(), { target: { value: 'encerramento' } })

    const opcoes = listaDeMacros().getAllByRole('option')
    expect(opcoes).toHaveLength(1)
    expect(opcoes[0]).toHaveTextContent('Encerramento padrão')
  })

  it('filtra também pelo corpo da macro, não só o nome', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    // "nota fiscal" só aparece no CORPO da macro "Pedido de nota fiscal" — o
    // nome sozinho não bateria.
    fireEvent.change(campoFiltro(), { target: { value: 'nota fiscal' } })

    const opcoes = listaDeMacros().getAllByRole('option')
    expect(opcoes).toHaveLength(1)
    expect(opcoes[0]).toHaveTextContent('Pedido de nota fiscal')
  })

  it('acha sem acento — "solicitacao" encontra "Solicitação"', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    fireEvent.change(campoFiltro(), { target: { value: 'solicitacao' } })

    expect(listaDeMacros().getAllByRole('option')).toHaveLength(1)
  })

  it('nenhuma macro bate: mensagem com o termo, e nenhuma opção alcançável', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    fireEvent.change(campoFiltro(), { target: { value: 'xpto' } })

    expect(screen.getByText('Nenhuma macro com “xpto”.')).toBeInTheDocument()
    expect(listaDeMacros().queryAllByRole('option')).toHaveLength(0)
  })

  it('Enter aplica a primeira macro (índice ativo começa em 0), inserindo o corpo dela', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    fireEvent.change(campoFiltro(), { target: { value: 'encerramento' } })
    fireEvent.keyDown(campoFiltro(), { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'Resposta ao cliente' })).toHaveValue(
      'Vamos encerrar por aqui — qualquer coisa, é só chamar.',
    )
    // aplicar fecha o menu — o campo de filtro não existe mais (o <select>
    // de status continua lá, então a consulta precisa do nome específico)
    expect(
      screen.queryByRole('combobox', { name: 'Filtrar macros por nome ou texto' }),
    ).not.toBeInTheDocument()
  })

  it('seta para baixo move a seleção antes de aplicar com Enter', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()

    // sem filtrar: as 3 aparecem na ordem MACROS — Arrow duas vezes chega na 3ª
    fireEvent.keyDown(campoFiltro(), { key: 'ArrowDown' })
    fireEvent.keyDown(campoFiltro(), { key: 'ArrowDown' })
    fireEvent.keyDown(campoFiltro(), { key: 'Enter' })

    expect(screen.getByRole('textbox', { name: 'Resposta ao cliente' })).toHaveValue(
      'Preciso que você confirme o acesso.',
    )
  })

  it('reabrir o menu depois de aplicar uma macro começa sem o filtro anterior', () => {
    macros = MACROS
    montar(0, ME_COM_MACRO)
    abrirMenu()
    fireEvent.change(campoFiltro(), { target: { value: 'encerramento' } })
    fireEvent.keyDown(campoFiltro(), { key: 'Enter' })

    abrirMenu() // reabre

    expect(campoFiltro()).toHaveValue('')
    expect(listaDeMacros().getAllByRole('option')).toHaveLength(3)
  })
})
