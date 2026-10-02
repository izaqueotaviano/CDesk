import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { PainelNotificacoes } from './PainelNotificacoes'

const NOTIFICACOES = [
  { id: 1, kind: 'ticket_assigned', title: 'Ticket atribuído a você: T-0007', body: 'Impressora não liga', url: '/tickets/7', ticket_id: 7, actor_name: 'Ana', read_at: null, created_at: '2026-09-06T00:00:00Z' },
  { id: 2, kind: 'mention', title: 'Samuel mencionou você', body: 'pode olhar?', url: '/tickets/9#mensagem-3', ticket_id: 9, actor_name: 'Samuel', read_at: '2026-09-05T00:00:00Z', created_at: '2026-09-05T00:00:00Z' },
  // gravada quando as rotas do console ainda se chamavam /chamados
  { id: 3, kind: 'ticket_assigned', title: 'Ticket antigo: T-0002', body: 'Gravada com o endereço antigo', url: '/chamados/2', ticket_id: 2, actor_name: 'Ana', read_at: '2026-09-04T00:00:00Z', created_at: '2026-09-04T00:00:00Z' },
]

let chamadas: { url: string; metodo: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/notifications/') {
        return Promise.resolve(jsonDe({ count: 2, next: null, previous: null, results: NOTIFICACOES, unread_count: 1 }))
      }
      if (u.pathname === '/api/v1/notifications/1/read/') return Promise.resolve(jsonDe({ marked_read: 1 }))
      if (u.pathname === '/api/v1/notifications/read-all/') return Promise.resolve(jsonDe({ marked_read: 1 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** A permissão é do navegador, não da conta — cada teste diz em que pé ela
 *  está (ou tira a API do ar, que é o caso de navegador sem suporte). */
function permissaoDoNavegador(estado: NotificationPermission | 'sem-api') {
  if (estado === 'sem-api') return vi.stubGlobal('Notification', undefined)
  const Fake = function () {} as unknown as typeof Notification
  Object.defineProperty(Fake, 'permission', { value: estado, configurable: true })
  Object.defineProperty(Fake, 'requestPermission', { value: vi.fn(async () => 'granted'), configurable: true })
  vi.stubGlobal('Notification', Fake)
}

async function abrirPainel() {
  montar()
  fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
}

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<PainelNotificacoes />} />
          <Route path="/tickets/:id" element={<p>detalhe do ticket</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PainelNotificacoes', () => {
  it('o sino mostra a contagem real de não lidas', async () => {
    montar()
    expect(await screen.findByText('1')).toBeInTheDocument()
  })

  it('abrir o painel lista as notificações', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText('Ticket atribuído a você: T-0007')).toBeInTheDocument()
    expect(screen.getByText('Samuel mencionou você')).toBeInTheDocument()
  })

  it('clicar numa não lida marca como lida e navega pra url dela', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByText('Ticket atribuído a você: T-0007'))

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/notifications/1/read/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
  })

  it('notificação gravada com o endereço antigo (/chamados/2) vai direto para /tickets/2', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByText('Ticket antigo: T-0002'))

    // sem a rota de redirecionamento no meio (ela fica fora do shell)
    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
  })

  it('clicar numa já lida navega mas não marca de novo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByText('Samuel mencionou você'))

    expect(await screen.findByText('detalhe do ticket')).toBeInTheDocument()
    expect(chamadas.some((c) => c.url === '/api/v1/notifications/2/read/')).toBe(false)
  })

  it('"Marcar todas como lidas" chama o endpoint certo', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/notifications/read-all/' && c.metodo === 'POST')).toBe(true))
  })

  describe('som das notificações', () => {
    afterEach(() => usePrefs.setState({ somNotificacoes: true }))

    it('o cabeçalho tem o interruptor do som, ligado por padrão', async () => {
      await abrirPainel()
      const botao = await screen.findByRole('button', { name: 'Som das notificações' })
      expect(botao).toHaveAttribute('aria-pressed', 'true')
      // o title anuncia a AÇÃO, não o estado
      expect(botao).toHaveAttribute('title', 'Desligar o som')
    })

    it('desligar aqui é a mesma preferência de Minha conta (e dos avisos)', async () => {
      await abrirPainel()
      const botao = await screen.findByRole('button', { name: 'Som das notificações' })

      fireEvent.click(botao)
      expect(botao).toHaveAttribute('aria-pressed', 'false')
      expect(usePrefs.getState().somNotificacoes).toBe(false)

      fireEvent.click(botao)
      expect(usePrefs.getState().somNotificacoes).toBe(true)
    })

    it('fica no cabeçalho mesmo sem nada para marcar como lido', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [], unread_count: 0 }))),
      )
      await abrirPainel()
      expect(await screen.findByRole('button', { name: 'Som das notificações' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Marcar todas como lidas' })).not.toBeInTheDocument()
    })
  })

  describe('avisar neste computador', () => {
    it('oferece ligar quando o navegador ainda não perguntou nada', async () => {
      permissaoDoNavegador('default')
      await abrirPainel()

      const chave = await screen.findByRole('switch', { name: /Avisar neste computador/ })
      expect(chave).toHaveAttribute('aria-checked', 'false')
    })

    it('ligar pede a permissão do navegador e a chave passa a valer', async () => {
      permissaoDoNavegador('default')
      await abrirPainel()

      const chave = await screen.findByRole('switch', { name: /Avisar neste computador/ })
      // conceder é assíncrono: o estado só troca depois da resposta do navegador
      permissaoDoNavegador('granted')
      fireEvent.click(chave)

      await waitFor(() => expect(chave).toHaveAttribute('aria-checked', 'true'))
    })

    it('desligar é possível mesmo com a permissão concedida', async () => {
      permissaoDoNavegador('granted')
      await abrirPainel()

      const chave = await screen.findByRole('switch', { name: /Avisar neste computador/ })
      expect(chave).toHaveAttribute('aria-checked', 'true')

      fireEvent.click(chave)
      await waitFor(() => expect(chave).toHaveAttribute('aria-checked', 'false'))
    })

    it('quando o navegador bloqueou, explica em vez de oferecer um botão que não funciona', async () => {
      permissaoDoNavegador('denied')
      await abrirPainel()

      expect(await screen.findByText(/bloqueados por este navegador/)).toBeInTheDocument()
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    })

    it('some por completo em navegador sem a API — nada de chave morta', async () => {
      permissaoDoNavegador('sem-api')
      await abrirPainel()

      // `selector` porque "Notificações" aparece duas vezes desde que o
      // gatilho na sidebar ganhou rótulo visível: o do botão e o título do
      // painel. Quem prova que o painel abriu é o título.
      await screen.findByText('Notificações', { selector: 'strong' })
      expect(screen.queryByRole('switch')).not.toBeInTheDocument()
      expect(screen.queryByText(/bloqueados por este navegador/)).not.toBeInTheDocument()
    })
  })
})
