import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { Topbar } from './Topbar'

const ME = {
  id: 2,
  full_name: 'Samuel Suporte',
  email: 'samuel@x.test',
  is_internal: true,
  is_admin: false,
  kind: 'internal',
  permissions: [],
}

const RESULTADO_BUSCA = {
  tickets: [
    {
      id: 12,
      reference: 'TCK-0012',
      subject: 'Impressora não imprime',
      company_name: 'Beta Logística',
      stage_name: 'Em andamento',
    },
  ],
  companies: [],
  requesters: [],
}

function chat(id: number) {
  return { id, status: 'queued', subject: `chat ${id}` }
}

let chamadas: { url: string; busca: string; metodo: string; corpo: unknown }[]
let presencaAtual: string
let naFila: number
let emAtendimento: number

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function paginado(qtd: number) {
  return { count: qtd, next: null, previous: null, results: Array.from({ length: qtd }, (_, i) => chat(i + 1)) }
}

beforeEach(() => {
  chamadas = []
  presencaAtual = 'available'
  naFila = 0
  emAtendimento = 0
  // O tema é uma preferência de app inteiro (stores/prefs, singleton de
  // módulo) carimbada no <html>: sem devolver ao padrão, o tema escolhido num
  // teste vaza para o seguinte.
  document.documentElement.removeAttribute('data-tema')
  document.documentElement.removeAttribute('data-theme')
  usePrefs.setState({ tema: 'sistema' })

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, busca: u.search, metodo, corpo })

      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe({ ...ME, presence: presencaAtual }))
      if (u.pathname === '/api/v1/auth/logout/') return Promise.resolve(new Response(null, { status: 204 }))
      // As duas listas de chat só se distinguem pela query — a fila e os meus
      // atendimentos batem no MESMO caminho.
      if (u.pathname === '/api/v1/chat/chats/') {
        return Promise.resolve(jsonDe(paginado(u.search.includes('status=queued') ? naFila : emAtendimento)))
      }
      if (u.pathname === '/api/v1/notifications/') {
        return Promise.resolve(jsonDe({ count: 0, next: null, previous: null, results: [], unread_count: 0 }))
      }
      if (u.pathname === '/api/v1/search/') return Promise.resolve(jsonDe(RESULTADO_BUSCA))
      if (u.pathname === '/api/v1/me/presence/') {
        presencaAtual = String((corpo as { presence?: string })?.presence)
        return Promise.resolve(jsonDe({ presence: presencaAtual }))
      }
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<Topbar />} />
          <Route path="/login" element={<p>tela de login</p>} />
          <Route path="/chat" element={<p>console de chat</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const buscasFeitas = () => chamadas.filter((c) => c.url === '/api/v1/search/')

describe('Topbar (equipe)', () => {
  it('tem um botão de Sair que desloga e manda para o login', async () => {
    montar()
    const sair = await screen.findByRole('button', { name: 'Sair' })
    fireEvent.click(sair)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/logout/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })

  it('soma fila e meus atendimentos no contador de conversas, e diz de onde veio cada um', async () => {
    naFila = 2
    emAtendimento = 1
    montar()

    // O rótulo visível é só "3 conversas"; a divisão fila/atendimento existe
    // para quem ouve a tela — e continua existindo quando a palavra some no
    // mobile, porque o nome acessível não depende dela.
    const botao = await screen.findByRole('button', { name: /3 conversas: 2 na fila, 1 em atendimento/ })
    expect(botao).toHaveTextContent('3')

    fireEvent.click(botao)
    expect(await screen.findByText('console de chat')).toBeInTheDocument()
  })

  it('a busca do cabeçalho é um campo de verdade, e não mais a caixa decorativa', async () => {
    montar()
    const campo = await screen.findByRole('combobox', { name: 'Buscar chamado, empresa ou pessoa' })

    fireEvent.change(campo, { target: { value: 'acme' } })

    await waitFor(() => expect(buscasFeitas()).toHaveLength(1), { timeout: 2000 })
    expect(buscasFeitas()[0].busca).toBe('?q=acme')
    expect(await screen.findByRole('option', { name: /Impressora não imprime/ })).toBeInTheDocument()
  })

  it('o avatar mostra a presença real de quem está logado e deixa trocá-la', async () => {
    presencaAtual = 'away'
    montar()

    const gatilho = await screen.findByRole('button', { name: /Samuel Suporte · Ausente/ })
    fireEvent.click(gatilho)
    fireEvent.click(screen.getByRole('radio', { name: 'Disponível' }))

    await waitFor(() =>
      expect(chamadas).toContainEqual(
        expect.objectContaining({ url: '/api/v1/me/presence/', metodo: 'POST', corpo: { presence: 'available' } }),
      ),
    )
    expect(await screen.findByRole('button', { name: /Samuel Suporte · Disponível/ })).toBeInTheDocument()
  })

  it('alterna o tema do shell a partir da barra', async () => {
    montar()
    const botao = await screen.findByRole('button', { name: 'Usar tema escuro' })

    fireEvent.click(botao)

    expect(document.documentElement.getAttribute('data-tema')).toBe('escuro')
    expect(await screen.findByRole('button', { name: 'Usar tema claro' })).toBeInTheDocument()
  })

  it('continua com o sino de notificações depois da recomposição', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Notificações' }))
    expect(await screen.findByText('Nenhuma notificação por aqui.')).toBeInTheDocument()
  })
})
