import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { MenuPresenca } from './MenuPresenca'

let presencaDeQuemEstaLogado: string
let statusDoPost: number
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  presencaDeQuemEstaLogado = 'available'
  statusDoPost = 200
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/auth/me/') {
        return Promise.resolve(
          jsonDe({
            id: 2,
            full_name: 'Samuel Suporte',
            email: 'samuel@x.test',
            kind: 'internal',
            is_internal: true,
            is_admin: false,
            permissions: [],
            presence: presencaDeQuemEstaLogado,
          }),
        )
      }
      if (u.pathname === '/api/v1/me/presence/') {
        presencaDeQuemEstaLogado = String((corpo as { presence?: string })?.presence)
        return statusDoPost === 200
          ? Promise.resolve(jsonDe({ presence: presencaDeQuemEstaLogado }))
          : Promise.resolve(jsonDe({ presence: 'Use um de: available, away, offline.' }, statusDoPost))
      }
      if (u.pathname === '/api/v1/auth/logout/') {
        return Promise.resolve(new Response(null, { status: 204 }))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  usePrefs.setState({ ausenciaAutomatica: 15 })
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Routes>
          <Route path="/inicio" element={<MenuPresenca />} />
          <Route path="/conta" element={<p>tela da minha conta</p>} />
          <Route path="/login" element={<p>tela de login</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** O menu só existe depois que o gatilho é clicado (Popover). Esperar pelo NOME
 *  no rótulo, e não só pelo botão: enquanto o /auth/me/ não responde o gatilho
 *  já está na tela dizendo "carregando", e abrir antes disso testaria o estado
 *  de carregamento sem querer. */
async function abrirMenu() {
  fireEvent.click(await screen.findByRole('button', { name: /Samuel Suporte/ }))
}

describe('MenuPresenca', () => {
  it('mostra a presença real de quem está logado, não um verde fixo', async () => {
    presencaDeQuemEstaLogado = 'away'
    const { container } = montar()

    expect(await screen.findByRole('button', { name: /Ausente/ })).toBeInTheDocument()
    const ponto = container.querySelector('.menu-presenca__ponto')
    expect(ponto).toHaveClass('menu-presenca__ponto--away')
    expect(ponto).not.toHaveClass('menu-presenca__ponto--available')
  })

  it('escolher "Ausente" manda o novo status para o backend e fecha o menu', async () => {
    montar()
    await abrirMenu()

    fireEvent.click(screen.getByRole('radio', { name: 'Ausente' }))

    await waitFor(() =>
      expect(chamadas).toContainEqual({
        url: '/api/v1/me/presence/',
        metodo: 'POST',
        corpo: { presence: 'away' },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'Ausente' })).not.toBeInTheDocument())
  })

  it('anuncia qual é a presença atual para quem usa leitor de tela', async () => {
    montar()
    await abrirMenu()

    expect(screen.getByRole('radio', { name: 'Disponível' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Ausente' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: 'Offline' })).toHaveAttribute('aria-checked', 'false')
  })

  it('não engole o caminho para "Minha conta"', async () => {
    montar()
    await abrirMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Minha conta' }))

    expect(await screen.findByText('tela da minha conta')).toBeInTheDocument()
  })

  it('Sair encerra a sessão e leva para o login — absorveu o ícone que morava na Topbar', async () => {
    montar()
    await abrirMenu()

    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() =>
      expect(chamadas).toContainEqual({ url: '/api/v1/auth/logout/', metodo: 'POST', corpo: undefined }),
    )
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })

  it('escolher à mão apaga a marca da ausência automática (a escolha passa a ser da pessoa)', async () => {
    // o vigia tinha marcado Ausente sozinho; a pessoa abre o menu e confirma
    localStorage.setItem('resolv:ausente-automatico', '1')
    presencaDeQuemEstaLogado = 'away'
    montar()
    fireEvent.click(await screen.findByRole('button', { name: /Samuel Suporte/ }))

    fireEvent.click(screen.getByRole('radio', { name: 'Ausente' }))
    expect(localStorage.getItem('resolv:ausente-automatico')).toBeNull()
  })

  it('diz a regra da ausência automática ao lado das opções', async () => {
    usePrefs.setState({ ausenciaAutomatica: 10 })
    montar()
    await abrirMenu()
    expect(screen.getByText('Ausente sozinho após 10 min sem uso.')).toBeInTheDocument()

    usePrefs.setState({ ausenciaAutomatica: 0 })
    expect(await screen.findByText('Ausência automática desligada.')).toBeInTheDocument()
  })

  it('avisa quando o backend recusa a mudança, em vez de falhar calado', async () => {
    statusDoPost = 400
    montar()
    await abrirMenu()

    fireEvent.click(screen.getByRole('radio', { name: 'Offline' }))

    // O menu já fechou quando a resposta chegou: o aviso vive na região de
    // status do gatilho, e o motivo aparece ao reabrir.
    expect(await screen.findByText('Não foi possível mudar seu status.')).toBeInTheDocument()
    await abrirMenu()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})
