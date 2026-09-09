import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatUi } from '@/stores/chatUi'
import { TAMANHOS_MINICHAT, usePrefs } from '@/stores/prefs'
import { MiniChat } from './MiniChat'

vi.mock('@/realtime/useSalaChat', () => ({
  useSalaChat: () => ({ status: 'aberto', digitando: null, erro: null, enviarMensagem: vi.fn(), enviarDigitando: vi.fn() }),
}))

const AGENTE = { id: 3, full_name: 'Samuel Suporte', email: 's@x.test', is_internal: true, is_admin: false, kind: 'internal', permissions: [], presence: 'available' }
const CLIENTE = { id: 4, full_name: 'Ana', email: 'ana@acme.test', is_internal: false, is_admin: false, kind: 'client', permissions: [] }

function chat(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, status: 'active', name: '', client_id: 4, client_name: 'Ana Cliente', client_email: 'ana@acme.test', client_phone: '',
    client_avatar: null, company_name: 'Acme', agent_name: 'Samuel Suporte', agent_id: 3, agent_avatar: null, category: null,
    category_name: null, priority: 'normal', assignee: null, assignee_name: null, tag_ids: [], queued_at: '2026-09-01T10:00:00Z',
    accepted_at: '2026-09-01T10:01:00Z', closed_at: null, reopen_count: 0, timeout_converted: false, unread_count: 0,
    last_message_preview: 'oi', rating: null, rating_pending: false, ticket_id: null, ticket_reference: null, ws_url: '', ...extra,
  }
}

const MENSAGENS = [
  { id: 1, author_name: 'Ana Cliente', author_is_internal: false, body: 'oi, preciso de ajuda', is_system: false, sent_at: '2026-09-01T10:02:00Z', read_at: null, files: [], edited_at: null, is_deleted: false, can_edit: false },
]

let me: Record<string, unknown>
let meus: ReturnType<typeof chat>[]
let fila: ReturnType<typeof chat>[]
let chamadas: { url: string; search: string; metodo: string }[]
let encerramentos: { id: number; corpo: Record<string, unknown> }[]
let transferencias: Record<string, unknown>[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}
const pagina = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results })

beforeEach(() => {
  useChatUi.setState({ abertos: [], filaAberta: false, rascunhos: {} })
  usePrefs.setState({ miniChat: TAMANHOS_MINICHAT.medio })
  me = AGENTE
  meus = [chat(5), chat(6, { client_name: 'Bruno Cliente', company_name: 'Beta', unread_count: 2 })]
  fila = []
  chamadas = []
  encerramentos = []
  transferencias = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, search: u.search, metodo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/chat/config/') return Promise.resolve(jsonDe({ welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: true, queue_opens_at: null, max_chats_per_agent: 3 }))
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('mine') === '1') return Promise.resolve(jsonDe(pagina(meus)))
      if (u.pathname === '/api/v1/chat/chats/' && u.searchParams.get('status') === 'queued') return Promise.resolve(jsonDe(pagina(fila)))
      const take = u.pathname.match(/\/api\/v1\/chat\/chats\/(\d+)\/take\/$/)
      if (take && metodo === 'POST') {
        const id = Number(take[1])
        const pego = { ...(fila.find((c) => c.id === id) ?? chat(id)), status: 'active', agent_id: 3, agent_name: 'Samuel Suporte' }
        fila = fila.filter((c) => c.id !== id)
        meus = [...meus, pego]
        return Promise.resolve(jsonDe(pego))
      }
      if (/\/api\/v1\/chat\/chats\/\d+\/$/.test(u.pathname)) {
        const id = Number(u.pathname.split('/').filter(Boolean).pop())
        return Promise.resolve(jsonDe(meus.find((c) => c.id === id) ?? chat(id)))
      }
      if (u.pathname === '/api/v1/chat/close-reasons/') {
        return Promise.resolve(jsonDe(pagina([
          { id: 1, name: 'Resolvido', slug: 'resolvido', requires_note: false, is_active: true, order: 0 },
          { id: 2, name: 'Outro', slug: 'outro', requires_note: true, is_active: true, order: 1 },
        ])))
      }
      if (u.pathname === '/api/v1/users/') {
        return Promise.resolve(jsonDe(pagina([
          { id: 3, full_name: 'Samuel Suporte', email: 's@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'available' },
          { id: 9, full_name: 'Fátima Financeiro', email: 'f@x.test', kind: 'internal', internal_role: 'agent', company: null, presence: 'away' },
        ])))
      }
      const fechar = u.pathname.match(/\/api\/v1\/chat\/chats\/(\d+)\/close\/$/)
      if (fechar && metodo === 'POST') {
        const id = Number(fechar[1])
        const corpo = init?.body ? JSON.parse(String(init.body)) : {}
        encerramentos.push({ id, corpo })
        meus = meus.filter((c) => c.id !== id)
        return Promise.resolve(jsonDe({ ...chat(id), status: 'closed' }))
      }
      const transferir = u.pathname.match(/\/api\/v1\/chat\/chats\/(\d+)\/transfer\/$/)
      if (transferir && metodo === 'POST') {
        transferencias.push(init?.body ? JSON.parse(String(init.body)) : {})
        return Promise.resolve(jsonDe(chat(Number(transferir[1]))))
      }
      if (/\/messages\/$/.test(u.pathname)) return Promise.resolve(jsonDe(MENSAGENS))
      if (/\/mark-read\/$/.test(u.pathname) || /\/read\/$/.test(u.pathname)) return Promise.resolve(jsonDe({}))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/inicio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/inicio" element={<MiniChat />} />
          <Route path="/chat" element={<MiniChat />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('MiniChat', () => {
  it('lista os atendimentos do agente como abas, com contador e badge de não lidas', async () => {
    montar()
    expect(await screen.findByRole('toolbar', { name: 'Meus atendimentos' })).toBeInTheDocument()
    expect(await screen.findByText('2/3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir conversa com Ana Cliente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir conversa com Bruno Cliente' })).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0)
  })

  it('clicar numa aba abre o painel com a conversa inteira e o compositor; minimizar fecha', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    const painel = await screen.findByRole('region', { name: 'Conversa com Ana Cliente' })
    expect(painel).toBeInTheDocument()
    expect(await screen.findByText('oi, preciso de ajuda')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Escreva para o cliente/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Minimizar conversa com Ana Cliente' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Conversa com Ana Cliente' })).not.toBeInTheDocument())
  })

  it('o painel some sozinho quando o chat deixa de ser meu (encerrado/transferido)', async () => {
    useChatUi.setState({ abertos: [99] })
    montar()
    await screen.findByRole('toolbar', { name: 'Meus atendimentos' })
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('no console (/chat) não aparece nem consulta os atendimentos', async () => {
    montar('/chat')
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/')).toBe(true))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
    expect(chamadas.some((c) => c.search.includes('mine=1'))).toBe(false)
  })

  it('cliente (portal) não vê nada', async () => {
    me = CLIENTE
    montar()
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/me/')).toBe(true))
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('sem atendimento nenhum o balão continua lá — é por ele que se pega a fila de qualquer tela', async () => {
    meus = []
    fila = [chat(9, { status: 'queued', agent_id: null, agent_name: null, client_name: 'Carla Costa', company_name: 'Cetus' })]
    montar()
    const balao = await screen.findByRole('button', { name: /^Chat: 1 na fila/ })
    expect(balao).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '1 na fila' })).toBeInTheDocument()

    fireEvent.click(balao)
    const dialogo = await screen.findByRole('dialog', { name: 'Fila de chat' })
    expect(within(dialogo).getByText('Carla Costa')).toBeInTheDocument()
    expect(within(dialogo).getByText(/Cetus · esperando/)).toBeInTheDocument()

    fireEvent.click(within(dialogo).getByRole('button', { name: 'Pegar' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/chat/chats/9/take/' && c.metodo === 'POST')).toBe(true))
    // pegou: a fila fecha e o painel da conversa abre na hora
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fila de chat' })).not.toBeInTheDocument())
    expect(await screen.findByRole('region', { name: 'Conversa com Carla Costa' })).toBeInTheDocument()
  })

  it('no limite de atendimentos, a fila aparece mas "Pegar" fica travado com o motivo', async () => {
    meus = [chat(5), chat(6, { client_name: 'Bruno Cliente' }), chat(7, { client_name: 'Dani Dias' })]
    fila = [chat(9, { status: 'queued', agent_id: null, agent_name: null, client_name: 'Carla Costa' })]
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /^Chat:/ }))
    const dialogo = await screen.findByRole('dialog', { name: 'Fila de chat' })
    expect(within(dialogo).getByText(/no limite de 3 atendimentos/)).toBeInTheDocument()
    expect(within(dialogo).getByRole('button', { name: 'Pegar' })).toBeDisabled()
  })

  it('cada painel aberto ao mesmo tempo tem um tom de identidade diferente no cabeçalho — e a aba repete o tom', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Bruno Cliente' }))
    const a = await screen.findByRole('region', { name: 'Conversa com Ana Cliente' })
    const b = await screen.findByRole('region', { name: 'Conversa com Bruno Cliente' })
    const tomA = a.querySelector('header')?.getAttribute('data-identidade')
    const tomB = b.querySelector('header')?.getAttribute('data-identidade')
    expect(tomA).toMatch(/^[1-6]$/)
    expect(tomB).toMatch(/^[1-6]$/)
    expect(tomA).not.toBe(tomB)
    const abaA = screen.getByRole('button', { name: 'Recolher conversa com Ana Cliente' })
    expect(abaA.querySelector('[data-identidade]')?.getAttribute('data-identidade')).toBe(tomA)
  })

  it('o botão de tamanho cicla os presets e a preferência fica guardada por agente', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    await screen.findByRole('region', { name: 'Conversa com Ana Cliente' })
    expect(usePrefs.getState().miniChat).toEqual(TAMANHOS_MINICHAT.medio)
    fireEvent.click(screen.getByRole('button', { name: /^Tamanho do painel: médio/ }))
    expect(usePrefs.getState().miniChat).toEqual(TAMANHOS_MINICHAT.grande)
    fireEvent.click(screen.getByRole('button', { name: /^Tamanho do painel: grande/ }))
    expect(usePrefs.getState().miniChat).toEqual(TAMANHOS_MINICHAT.pequeno)
    // o root expõe o tamanho como variável CSS pros painéis
    expect(screen.getByLabelText('Mini chat').getAttribute('style')).toContain('--minichat-largura: 320px')
  })

  it('a alça de redimensionar aceita setas do teclado (alternativa ao arrasto)', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    const alca = await screen.findByRole('slider', { name: /Redimensionar painel/ })
    fireEvent.keyDown(alca, { key: 'ArrowLeft' })
    expect(usePrefs.getState().miniChat.largura).toBe(TAMANHOS_MINICHAT.medio.largura + 24)
    fireEvent.keyDown(alca, { key: 'ArrowDown' })
    expect(usePrefs.getState().miniChat.altura).toBe(TAMANHOS_MINICHAT.medio.altura - 24)
  })

  it('o rascunho digitado no painel é o mesmo que o console vê (store compartilhado)', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
    const campo = await screen.findByPlaceholderText(/Escreva para o cliente/)
    fireEvent.change(campo, { target: { value: 'já estou verificando' } })
    expect(useChatUi.getState().rascunhos[5]).toBe('já estou verificando')
  })

  // ---------------------------------------------------------------- item 5
  // As ações do console dentro do mini chat — os MESMOS formulários
  // (`./acoes`), para não existir um encerramento que pede motivo no console
  // e outro que não pede aqui.
  describe('menu de ações', () => {
    async function abrirMenu() {
      montar()
      fireEvent.click(await screen.findByRole('button', { name: 'Abrir conversa com Ana Cliente' }))
      fireEvent.click(
        await screen.findByRole('button', { name: /Mais ações do atendimento de Ana Cliente/ }),
      )
      return screen.findByRole('menu', { name: 'Ações do atendimento' })
    }

    it('oferece transferir, encerrar e abrir no console, com a ficha do cliente', async () => {
      const menu = await abrirMenu()
      expect(within(menu).getByRole('menuitem', { name: /Transferir/ })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: /Encerrar/ })).toBeInTheDocument()
      expect(within(menu).getByRole('menuitem', { name: /Abrir no console/ })).toBeInTheDocument()
      expect(within(menu).getByText('Protocolo #5')).toBeInTheDocument()
      expect(within(menu).getByText('ana@acme.test')).toBeInTheDocument()
    })

    it('transferir mostra a disponibilidade do agente e manda a observação', async () => {
      const menu = await abrirMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Transferir/ }))

      const seletor = await screen.findByLabelText('Para quem')
      // a disponibilidade vem do `presence` que a API já devolve — transferir
      // para quem está offline é o erro que a tela consegue avisar antes
      await waitFor(() => expect(within(seletor).getByText(/Fátima Financeiro/)).toBeInTheDocument())
      expect(within(seletor).getByText(/ausente/)).toBeInTheDocument()

      fireEvent.change(seletor, { target: { value: '9' } })
      fireEvent.change(screen.getByLabelText('Observação interna (opcional)'), {
        target: { value: 'é de fatura' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Transferir' }))

      await waitFor(() => expect(transferencias).toHaveLength(1))
      expect(transferencias[0]).toMatchObject({ agent_id: 9, note: 'é de fatura' })
    })

    it('encerrar manda o motivo escolhido', async () => {
      const menu = await abrirMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Encerrar/ }))

      const motivo = await screen.findByLabelText('Motivo do encerramento')
      await waitFor(() => expect(within(motivo).getByText('Resolvido')).toBeInTheDocument())
      fireEvent.change(motivo, { target: { value: '1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Encerrar conversa' }))

      await waitFor(() => expect(encerramentos).toHaveLength(1))
      expect(encerramentos[0].corpo).toMatchObject({ reason_id: 1 })
    })

    it('motivo que exige observação trava o botão até ela existir', async () => {
      const menu = await abrirMenu()
      fireEvent.click(within(menu).getByRole('menuitem', { name: /Encerrar/ }))
      const motivo = await screen.findByLabelText('Motivo do encerramento')
      await waitFor(() => expect(within(motivo).getByText('Outro')).toBeInTheDocument())
      fireEvent.change(motivo, { target: { value: '2' } })
      // o rótulo perde o "(opcional)" e o botão desabilita
      expect(screen.getByLabelText('Observação interna')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Encerrar conversa' })).toBeDisabled()

      fireEvent.change(screen.getByLabelText('Observação interna'), {
        target: { value: 'cliente pediu por telefone' },
      })
      expect(screen.getByRole('button', { name: 'Encerrar conversa' })).toBeEnabled()
    })

    it('Esc fecha o menu sem executar nada', async () => {
      const menu = await abrirMenu()
      expect(menu).toBeInTheDocument()
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() =>
        expect(screen.queryByRole('menu', { name: 'Ações do atendimento' })).not.toBeInTheDocument(),
      )
      expect(encerramentos).toHaveLength(0)
    })
  })
})
