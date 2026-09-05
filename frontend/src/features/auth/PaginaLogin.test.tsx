import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaLogin } from './PaginaLogin'

const ANA = { id: 4, email: 'ana@acme.test', full_name: 'Ana Almeida', is_internal: false, is_admin: false, kind: 'client', permissions: [] }
const SAMUEL = { id: 2, email: 'samuel@x.test', full_name: 'Samuel', is_internal: true, is_admin: false, kind: 'internal', permissions: [] }

type Resposta = { status: number; corpo: unknown }
let respostas: Record<string, (corpo: Record<string, string>) => Resposta>
let chamadas: { url: string; corpo: Record<string, string> }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  respostas = {}
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      chamadas.push({ url: u.pathname, corpo })
      if (u.pathname === '/api/v1/branding/login/') {
        const marca = (a: 'cliente' | 'equipe') => ({ audience: a, brand_name: a === 'cliente' ? 'Central de Suporte' : 'Resolv', headline: 'Chamada', subtitle: 'Sub', highlights: ['Um', 'Dois'], image_url: null, updated_at: '2026-09-01T00:00:00Z' })
        return Promise.resolve(jsonDe({ cliente: marca('cliente'), equipe: marca('equipe') }))
      }
      const r = respostas[u.pathname]?.(corpo)
      return Promise.resolve(r ? jsonDe(r.corpo, r.status) : jsonDe({ detail: 'sem rota' }, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/login/cliente', state?: { de: string }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: rota, state }]}>
        <Routes>
          <Route path="/login" element={<PaginaLogin />} />
          <Route path="/login/cliente" element={<PaginaLogin />} />
          <Route path="/inicio" element={<p>painel da equipe</p>} />
          <Route path="/portal" element={<p>portal do cliente</p>} />
          <Route path="/portal/tickets/7" element={<p>chamado 7</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const logins = () => chamadas.filter((c) => c.url === '/api/v1/auth/login/')

function preencher(email = 'ana@acme.test', senha = 'resolv123') {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: senha } })
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('PaginaLogin', () => {
  it('fala com o público certo em cada rota', () => {
    const { unmount } = montar('/login/cliente')
    expect(screen.getByRole('heading', { name: 'Entrar no portal' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar no painel' })).toHaveAttribute('href', '/login')
    unmount()
    montar('/login')
    expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Acessar o portal' })).toHaveAttribute('href', '/login/cliente')
  })

  it('sem verificação em duas etapas, a senha certa já entra e o cliente vai para o portal', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 200, corpo: ANA })
    montar('/login/cliente')
    preencher()
    expect(await screen.findByText('portal do cliente')).toBeInTheDocument()
    expect(logins()[0].corpo).toEqual({ email: 'ana@acme.test', password: 'resolv123' })
  })

  it('a equipe vai para o painel — e volta para onde tentou ir', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 200, corpo: SAMUEL })
    montar('/login')
    preencher('samuel@x.test')
    expect(await screen.findByText('painel da equipe')).toBeInTheDocument()
  })

  it('cliente volta para o chamado que tentou abrir antes de logar', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 200, corpo: ANA })
    montar('/login/cliente', { de: '/portal/tickets/7' })
    preencher()
    expect(await screen.findByText('chamado 7')).toBeInTheDocument()
  })

  it('com verificação ligada: pede o código, confirma com 6 dígitos e entra', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 200, corpo: { two_factor: 'email' } })
    respostas['/api/v1/auth/2fa/'] = (corpo) => (corpo.code === '123456' ? { status: 200, corpo: ANA } : { status: 400, corpo: { detail: 'Código inválido ou expirado.' } })
    montar('/login/cliente')
    preencher()
    expect(await screen.findByRole('heading', { name: 'Confirme que é você' })).toBeInTheDocument()
    expect(screen.getByText('ana@acme.test')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '000000' } })
    expect(await screen.findByText('Código inválido ou expirado.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Código'), { target: { value: '123456' } })
    expect(await screen.findByText('portal do cliente')).toBeInTheDocument()
  })

  it('aplicativo autenticador: não oferece reenvio por e-mail', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 200, corpo: { two_factor: 'totp' } })
    montar('/login')
    preencher('samuel@x.test')
    expect(await screen.findByText(/Abra o aplicativo autenticador/)).toBeInTheDocument()
    expect(screen.queryByText(/Reenviar/)).not.toBeInTheDocument()
  })

  it('senha errada e limite de tentativas viram mensagens que a pessoa entende', async () => {
    respostas['/api/v1/auth/login/'] = () => ({ status: 400, corpo: { detail: 'E-mail ou senha inválidos.' } })
    montar('/login/cliente')
    preencher('ana@acme.test', 'errada')
    expect(await screen.findByText('E-mail ou senha inválidos.')).toBeInTheDocument()

    respostas['/api/v1/auth/login/'] = () => ({ status: 429, corpo: { detail: 'Pedido foi suprimido. Espera-se que esteja diponível em 2573 segundos.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Muitas tentativas. Aguarde 43 minutos e tente de novo.')).toBeInTheDocument()
  })

  it('valida antes de chamar a API', async () => {
    montar('/login/cliente')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument()
    expect(screen.getByText('Informe sua senha.')).toBeInTheDocument()
    await waitFor(() => expect(logins()).toHaveLength(0))
  })
})
