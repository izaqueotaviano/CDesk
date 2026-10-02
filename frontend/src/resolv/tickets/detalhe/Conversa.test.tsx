import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '@/api/types'
import { useTabs, type AbaTicket } from '@/stores/tabs'
import { Conversa } from './Conversa'
import type { Evento, Mensagem, TicketDetalhe } from './tiposDetalhe'
import './detalhe.scss'

/** Chave real usada por Conversa.tsx — mesma constante, não importada (o
 *  módulo não a exporta: é implementação interna). */
const CHAVE_MOSTRAR_EVENTOS = 'resolv-conversa-mostrar-eventos'

// O espelho no servidor é irrelevante aqui — `atualizarScroll` nunca chama
// `sincronizarComServidor` (contrato em stores/tabs.ts: scroll é local), mas
// o MÓDULO importa `@/api/tabs` de qualquer jeito; mesma precaução de
// BarraDeAbas.test.tsx.
vi.mock('@/api/tabs', () => ({
  getTabsServidor: vi.fn(() => new Promise(() => {})),
  putTabsServidor: vi.fn(() => new Promise(() => {})),
}))

vi.mock('./Compositor', () => ({ Compositor: () => <div data-testid="compositor" /> }))

const editarMensagemMock = vi.hoisted(() => vi.fn())
const apagarMensagemMock = vi.hoisted(() => vi.fn())
vi.mock('./dados', () => ({
  useAcoesTicket: () => ({
    editarMensagem: { mutateAsync: editarMensagemMock },
    apagarMensagem: { mutateAsync: apagarMensagemMock },
  }),
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
  permissions: [],
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

function evento(extra: Partial<Evento> = {}): Evento {
  return {
    id: 900,
    from_status: 'new',
    to_status: 'open',
    actor_name: 'Samuel Suporte',
    is_reopen: false,
    is_automatic: false,
    note: '',
    created_at: '2026-09-06T11:00:00Z',
    ...extra,
  }
}

function mensagem(extra: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 1,
    author_name: 'Beto Barros',
    author_avatar: null,
    author_is_internal: false,
    body: 'Continua sem imprimir.',
    is_public: true,
    source: 'web',
    is_first_response: false,
    created_at: '2026-09-06T12:00:00Z',
    attachments: [],
    mentions: [],
    edited_at: null,
    is_deleted: false,
    can_edit: false,
    signature_html: '',
    ...extra,
  }
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
    messages: [mensagem()],
    events: [],
    watchers: [],
    scheduled_replies: [],
    requester: null,
    ...extra,
  }
}

/** jsdom não faz layout: scrollHeight/clientHeight ficam 0 até serem
 *  configurados na mão — sem isso, "perto do fim" seria sempre verdadeiro por
 *  acidente, não porque o código decidiu, o que é exatamente o tipo de teste
 *  que passa concordando com o bug. */
function configurarDimensoes(el: HTMLElement, dims: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { value: dims.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: dims.clientHeight, configurable: true })
}

let chamadasScroll: { id: string; opts: ScrollIntoViewOptions | undefined }[]

function montar(t: TicketDetalhe, hash = '') {
  return render(
    <MemoryRouter initialEntries={[`/tickets/${t.id}${hash}`]}>
      <Conversa ticket={t} me={ME} agoraMs={Date.parse(t.created_at)} pedidoReabrir={0} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  chamadasScroll = []
  // Um só spy global, mas registrando o `this` (o elemento real que recebeu a
  // chamada) — é o único jeito de diferenciar "rolou até a mensagem X" de
  // "rolou pro fim" (a sentinela sem id) sem depender de layout de verdade.
  Element.prototype.scrollIntoView = vi.fn(function (
    this: Element,
    opts?: ScrollIntoViewOptions,
  ) {
    chamadasScroll.push({ id: this.id, opts })
  })
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
  editarMensagemMock.mockReset()
  apagarMensagemMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  useTabs.setState({ tabs: [], active: null, reconciliando: false })
  localStorage.clear()
})

describe('Conversa — id da mensagem e âncora de notificação de menção (item 22)', () => {
  it('cada mensagem carrega id="mensagem-{id}" — é a âncora que o backend gera', () => {
    montar(ticket({ messages: [mensagem({ id: 77 })] }))

    expect(document.getElementById('mensagem-77')).toBeInTheDocument()
  })

  it('com #mensagem-{id} na URL, rola até a mensagem em vez de ir para o fim', () => {
    montar(
      ticket({ messages: [mensagem({ id: 5 }), mensagem({ id: 6 })] }),
      '#mensagem-5',
    )

    expect(chamadasScroll).toContainEqual({ id: 'mensagem-5', opts: { block: 'center' } })
    // A sentinela do fim não tem id — se ela tivesse sido chamada também, a
    // âncora teria "perdido a corrida" e a tela acabaria no fim mesmo assim.
    expect(chamadasScroll.some((c) => c.id === '')).toBe(false)
  })
})

describe('Conversa — restaura posição de rolagem ao trocar de aba/voltar (item 21)', () => {
  it('sem posição salva e sem âncora, mantém o comportamento antigo: rola pro fim', () => {
    montar(ticket())

    expect(chamadasScroll).toContainEqual({ id: '', opts: { block: 'end' } })
  })

  it('com posição salva na aba deste ticket, restaura o scrollTop em vez de ir pro fim', () => {
    useTabs.setState({
      tabs: [{ tipo: 'ticket', ticketId: 42, resumo: undefined, scroll: 345, draft: '' }],
      active: 'ticket:42',
      reconciliando: false,
    })

    montar(ticket())

    const lista = screen.getByRole('log', { name: 'Mensagens' }) as HTMLDivElement
    expect(lista.scrollTop).toBe(345)
    expect(chamadasScroll.some((c) => c.id === '' && c.opts?.block === 'end')).toBe(false)
  })

  it('salva a posição de rolagem com debounce, não a cada evento de scroll', () => {
    // No fluxo real a aba já existe (PaginaDetalheTicket chama `abrirTicket`
    // antes de a Conversa montar) — `atualizarScroll` só ATUALIZA uma aba
    // existente (stores/tabs.ts: `s.tabs.map(...)`), não cria uma do nada.
    useTabs.setState({
      tabs: [{ tipo: 'ticket', ticketId: 42, resumo: undefined, scroll: 0, draft: '' }],
      active: 'ticket:42',
      reconciliando: false,
    })
    vi.useFakeTimers()
    montar(ticket())
    const lista = screen.getByRole('log', { name: 'Mensagens' })
    configurarDimensoes(lista, { scrollHeight: 1000, clientHeight: 500 })

    fireEvent.scroll(lista, { target: { scrollTop: 120 } })
    // Ainda dentro da janela do debounce: nada gravado no store.
    vi.advanceTimersByTime(399)
    expect(
      useTabs.getState().tabs.find((t): t is AbaTicket => t.tipo === 'ticket' && t.ticketId === 42)?.scroll ?? 0,
    ).toBe(0)

    vi.advanceTimersByTime(1)
    expect(
      useTabs.getState().tabs.find((t): t is AbaTicket => t.tipo === 'ticket' && t.ticketId === 42)?.scroll,
    ).toBe(120)
  })
})

describe('Conversa — mensagem nova só arrasta a rolagem se a pessoa já estava perto do fim (item 21)', () => {
  it('perto do fim: mensagem nova rola pro fim (é o "acompanhar ao vivo")', () => {
    const t = ticket({ messages: [mensagem({ id: 1 })] })
    const { rerender } = montar(t)
    const lista = screen.getByRole('log', { name: 'Mensagens' })
    configurarDimensoes(lista, { scrollHeight: 1000, clientHeight: 500 })
    fireEvent.scroll(lista, { target: { scrollTop: 480 } }) // distância = 1000-480-500 = 20 < 80

    chamadasScroll = []
    rerender(
      <MemoryRouter initialEntries={['/tickets/42']}>
        <Conversa
          ticket={ticket({ messages: [mensagem({ id: 1 }), mensagem({ id: 2 })] })}
          me={ME}
          agoraMs={Date.now()}
          pedidoReabrir={0}
        />
      </MemoryRouter>,
    )

    expect(chamadasScroll).toContainEqual({ id: '', opts: { block: 'end' } })
  })

  it('lendo o meio da thread: mensagem nova NÃO arrasta a rolagem', () => {
    const t = ticket({ messages: [mensagem({ id: 1 })] })
    const { rerender } = montar(t)
    const lista = screen.getByRole('log', { name: 'Mensagens' })
    configurarDimensoes(lista, { scrollHeight: 1000, clientHeight: 500 })
    fireEvent.scroll(lista, { target: { scrollTop: 100 } }) // distância = 1000-100-500 = 400 ≥ 80

    chamadasScroll = []
    rerender(
      <MemoryRouter initialEntries={['/tickets/42']}>
        <Conversa
          ticket={ticket({ messages: [mensagem({ id: 1 }), mensagem({ id: 2 })] })}
          me={ME}
          agoraMs={Date.now()}
          pedidoReabrir={0}
        />
      </MemoryRouter>,
    )

    expect(chamadasScroll).toEqual([])
  })
})

describe('Conversa — editar/apagar sempre visíveis, não só no hover (item 29)', () => {
  it('os botões existem no DOM assim que a mensagem permite editar, sem gesto de revelar', () => {
    montar(ticket({ messages: [mensagem({ id: 1, can_edit: true })] }))

    expect(screen.getByRole('button', { name: 'Editar mensagem' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apagar mensagem' })).toBeInTheDocument()
  })

  it('a regra CSS de .msg__acoes não esconde por opacidade nem depende de :hover/:focus-within', () => {
    // Antes (detalhe.scss): opacity:0 por padrão, só virava opacity:1 em
    // `:hover`/`:focus-within` — sem mouse (teclado) ou em touch, o botão
    // nunca aparecia. Este teste lê o CSS de verdade injetado no jsdom
    // (`css: true` no vite.config.ts) — não é suposição sobre a intenção do
    // arquivo, é o texto compilado da regra.
    let regraBase: CSSStyleRule | undefined
    const seletoresComHover: string[] = []
    for (const sheet of Array.from(document.styleSheets)) {
      let regras: CSSRuleList
      try {
        regras = (sheet as CSSStyleSheet).cssRules
      } catch {
        continue
      }
      for (const regra of Array.from(regras)) {
        const r = regra as CSSStyleRule
        if (r.selectorText === '.msg__acoes') regraBase = r
        if (r.selectorText?.includes('msg__acoes') && r.selectorText.includes(':hover')) {
          if (!r.selectorText.startsWith('.msg__acoes button')) seletoresComHover.push(r.selectorText)
        }
        if (r.selectorText?.includes('msg__acoes') && r.selectorText.includes(':focus-within')) {
          seletoresComHover.push(r.selectorText)
        }
      }
    }

    expect(regraBase).toBeDefined()
    expect(regraBase!.style.opacity).toBe('')
    expect(seletoresComHover).toEqual([])
  })
})

describe('Conversa — lista de mensagens anuncia chegada por realtime (item 31)', () => {
  it('o contêiner da lista tem role="log" + aria-live="polite" + aria-relevant="additions"', () => {
    montar(ticket())

    const lista = screen.getByRole('log', { name: 'Mensagens' })
    expect(lista).toHaveAttribute('aria-live', 'polite')
    expect(lista).toHaveAttribute('aria-relevant', 'additions')
  })
})

describe('Conversa — "Mostrar eventos" lembra a preferência do dispositivo', () => {
  it('sem preferência salva, nasce marcado e mostra eventos — comportamento de sempre', () => {
    montar(ticket({ messages: [mensagem()], events: [evento()] }))

    expect(screen.getByRole('checkbox', { name: 'Mostrar eventos' })).toBeChecked()
    expect(screen.getByText('Samuel Suporte moveu para Aberto')).toBeInTheDocument()
  })

  it('com "nao" salvo no localStorage, nasce desmarcado — não é o `useState(true)` de antes', () => {
    localStorage.setItem(CHAVE_MOSTRAR_EVENTOS, 'nao')

    montar(ticket({ messages: [mensagem()], events: [evento()] }))

    expect(screen.getByRole('checkbox', { name: 'Mostrar eventos' })).not.toBeChecked()
    expect(screen.queryByText('Samuel Suporte moveu para Aberto')).not.toBeInTheDocument()
  })

  it('desmarcar grava a escolha, para o próximo chamado (troca de aba) já nascer sem eventos', () => {
    montar(ticket({ messages: [mensagem()], events: [evento()] }))

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mostrar eventos' }))

    expect(localStorage.getItem(CHAVE_MOSTRAR_EVENTOS)).toBe('nao')
  })

  it('sem localStorage disponível, cai no padrão (mostrar) em vez de quebrar', () => {
    const original = window.localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('sem storage nesta aba')
      },
    })

    try {
      montar(ticket({ messages: [mensagem()], events: [evento()] }))
      expect(screen.getByRole('checkbox', { name: 'Mostrar eventos' })).toBeChecked()
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
    }
  })
})

describe('Conversa — contagem de públicas/notas vira filtro clicável', () => {
  function ticketMisto() {
    return ticket({
      messages: [
        mensagem({ id: 1, is_public: true, body: 'Mensagem pública 1' }),
        mensagem({ id: 2, is_public: false, body: 'Nota interna 1' }),
        mensagem({ id: 3, is_public: true, body: 'Mensagem pública 2' }),
      ],
    })
  }

  it('sem nota nenhuma, a contagem continua texto simples — nada para filtrar', () => {
    montar(ticket({ messages: [mensagem({ id: 1, is_public: true })] }))

    expect(screen.queryByRole('group', { name: 'Filtrar mensagens por tipo' })).not.toBeInTheDocument()
    expect(screen.getByText('1 mensagem')).toBeInTheDocument()
  })

  it('com públicas e notas, aparecem os três filtros e "Todas" começa ativo', () => {
    montar(ticketMisto())

    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Mensagem pública 1')).toBeInTheDocument()
    expect(screen.getByText('Nota interna 1')).toBeInTheDocument()
  })

  it('clicar em "2 mensagens" restringe a lista às públicas', () => {
    montar(ticketMisto())

    fireEvent.click(screen.getByRole('button', { name: '2 mensagens' }))

    expect(screen.getByText('Mensagem pública 1')).toBeInTheDocument()
    expect(screen.getByText('Mensagem pública 2')).toBeInTheDocument()
    expect(screen.queryByText('Nota interna 1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2 mensagens' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('clicar em "1 nota interna" restringe a lista às notas', () => {
    montar(ticketMisto())

    fireEvent.click(screen.getByRole('button', { name: '1 nota interna' }))

    expect(screen.getByText('Nota interna 1')).toBeInTheDocument()
    expect(screen.queryByText('Mensagem pública 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Mensagem pública 2')).not.toBeInTheDocument()
  })

  it('voltar para "Todas" mostra tudo de novo', () => {
    montar(ticketMisto())

    fireEvent.click(screen.getByRole('button', { name: '1 nota interna' }))
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))

    expect(screen.getByText('Mensagem pública 1')).toBeInTheDocument()
    expect(screen.getByText('Nota interna 1')).toBeInTheDocument()
    expect(screen.getByText('Mensagem pública 2')).toBeInTheDocument()
  })
})

describe('Conversa — assinatura do agente', () => {
  it('desenha o rodapé da mensagem que foi assinada', () => {
    montar(
      ticket({
        messages: [
          mensagem({ id: 1, body: 'Resolvido.', signature_html: '<p>Samuel — Suporte</p>' }),
        ],
      }),
    )
    expect(screen.getByText('Resolvido.')).toBeInTheDocument()
    expect(screen.getByText('Samuel — Suporte')).toBeInTheDocument()
  })

  it('mensagem sem assinatura não ganha bloco nenhum', () => {
    const { container } = montar(ticket({ messages: [mensagem({ id: 1, signature_html: '' })] }))
    expect(container.querySelector('.assinatura-mensagem')).toBeNull()
  })

  it('mensagem apagada não mostra a assinatura de quem a escreveu', () => {
    const { container } = montar(
      ticket({
        messages: [mensagem({ id: 1, is_deleted: true, signature_html: '<p>Samuel</p>' })],
      }),
    )
    expect(container.querySelector('.assinatura-mensagem')).toBeNull()
  })
})

describe('Conversa — corpo formatado, menção e anexos', () => {
  it('formatação leve e chip de menção com o nome de hoje (pessoa e equipe de mesmo id)', () => {
    montar(
      ticket({
        messages: [
          mensagem({
            is_public: false,
            author_is_internal: true,
            body: '**Atenção** @[user:3] e @[team:3]',
            mentions: [
              { key: 'user:3', type: 'user', id: 3, name: 'Izaque Sá', is_active: true },
              { key: 'team:3', type: 'team', id: 3, name: 'Design', is_active: true },
            ],
          }),
        ],
      }),
    )
    const artigo = screen.getByRole('article')
    expect(artigo.querySelector('strong')).toHaveTextContent('Atenção')
    const chips = [...artigo.querySelectorAll('.texto-formatado__mencao')].map((c) => c.textContent)
    expect(chips).toEqual(['@Izaque Sá', '@Design'])
  })

  it('imagem liberada vira miniatura que abre o visualizador; o resto é chip de download', () => {
    montar(
      ticket({
        messages: [
          mensagem({
            attachments: [
              { id: 1, filename: 'print.png', content_type: 'image/png', size_bytes: 2048, url: '/api/v1/attachments/1/', scan_status: 'clean', is_downloadable: true },
              { id: 2, filename: 'nota.pdf', content_type: 'application/pdf', size_bytes: 4096, url: '/api/v1/attachments/2/', scan_status: 'clean', is_downloadable: true },
              { id: 3, filename: 'virus.png', content_type: 'image/png', size_bytes: 10, scan_status: 'infected', is_downloadable: false },
            ],
          }),
        ],
      }),
    )
    const pdf = screen.getByRole('link', { name: /nota\.pdf/ })
    expect(pdf).toHaveAttribute('download', 'nota.pdf')
    // imagem em quarentena não vira miniatura
    expect(screen.queryByRole('link', { name: 'Ver virus.png' })).not.toBeInTheDocument()
    expect(screen.getByText('bloqueado pelo antivírus')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Ver print.png' }))
    expect(screen.getByRole('dialog', { name: 'print.png' })).toBeInTheDocument()
  })
})
