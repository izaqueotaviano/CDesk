import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { CvzAppLayout } from './AppLayout'

// O mini chat é irmão do shell em QUALQUER tela cvz (ver comentário em
// AppLayout.tsx) — aqui ele só é ruído: puxa fila/meus-chats/config por conta
// própria e nenhum dos dois casos abaixo precisa dele.
vi.mock('@/resolv/chat/MiniChat', () => ({ MiniChat: () => null }))

const ME = {
  id: 1,
  full_name: 'Ana Suporte',
  email: 'ana@x.test',
  is_internal: true,
  is_admin: false,
  kind: 'internal',
  permissions: [],
  presence: 'available',
}

let chamadas: { url: string; metodo: string }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  // jsdom não implementa matchMedia (useIsMobile/useTheme do cvz dependem
  // dele) — sem o stub, montar o AppShell derruba o teste antes de qualquer
  // asserção.
  vi.stubGlobal('matchMedia', (consulta: string) => ({
    matches: false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
  // Mesmo motivo do Topbar.test.tsx: `tema` é um singleton de módulo
  // carimbado no <html>, então um teste anterior pode deixar o atributo para
  // trás.
  document.documentElement.removeAttribute('data-tema')
  document.documentElement.removeAttribute('data-theme')
  usePrefs.setState({ tema: 'sistema' })

  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/auth/logout/') return Promise.resolve(new Response(null, { status: 204 }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/inicio') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/inicio" element={<CvzAppLayout><p>tela início</p></CvzAppLayout>} />
          {/* /chat não é do shell cvz (é a tela cheia do shell Resolv, ver
              routes.tsx) — o placeholder abaixo só confirma que a navegação
              saiu do cvz e chegou lá. */}
          <Route path="/chat" element={<p>tela de chat</p>} />
          <Route path="/login" element={<p>tela de login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('CvzAppLayout', () => {
  it('clicar em "Chats" na sidebar navega para /chat', async () => {
    montar()
    const chats = await screen.findByRole('button', { name: 'Chats' })

    fireEvent.click(chats)

    expect(await screen.findByText('tela de chat')).toBeInTheDocument()
  })

  it('clicar no avatar abre o menu de conta, e "Sair" desloga e manda pro login', async () => {
    montar()
    const avatar = await screen.findByRole('button', { name: /Ana Suporte/ })

    fireEvent.click(avatar)
    const sair = await screen.findByRole('menuitem', { name: 'Sair' })
    fireEvent.click(sair)

    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/logout/' && c.metodo === 'POST')).toBe(true))
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })
})
