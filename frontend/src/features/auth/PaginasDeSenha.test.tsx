import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaEsqueciSenha } from './PaginaEsqueciSenha'
import { PaginaRedefinirSenha } from './PaginaRedefinirSenha'

type Resposta = { status: number; corpo: unknown }
let respostas: Record<string, (metodo: string, corpo: Record<string, string>, busca: URLSearchParams) => Resposta>
let chamadas: { url: string; metodo: string; corpo: Record<string, string> }[]

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
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/branding/login/') return Promise.resolve(jsonDe({}, 404))
      const r = respostas[u.pathname]?.(metodo, corpo, u.searchParams)
      return Promise.resolve(r ? jsonDe(r.corpo, r.status) : jsonDe({ detail: 'sem rota' }, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

/** Mostra para onde a tela mandou a pessoa, com o `state` junto. */
function Destino({ nome }: { nome: string }) {
  const { state } = useLocation()
  return (
    <p>
      {nome} {(state as { email?: string } | null)?.email ?? ''}
    </p>
  )
}

function montar(rota: string, state?: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[{ pathname: rota, state }]}>
        <Routes>
          <Route path="/login" element={<Destino nome="login da equipe" />} />
          <Route path="/login/cliente" element={<Destino nome="login do cliente" />} />
          <Route path="/login/esqueci-senha" element={<PaginaEsqueciSenha />} />
          <Route path="/login/cliente/esqueci-senha" element={<PaginaEsqueciSenha />} />
          <Route path="/login/redefinir-senha/:uid/:token" element={<PaginaRedefinirSenha modo="recuperacao" />} />
          <Route path="/login/cliente/redefinir-senha/:uid/:token" element={<PaginaRedefinirSenha modo="recuperacao" />} />
          <Route path="/portal/definir-senha/:uid/:token" element={<PaginaRedefinirSenha modo="convite" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const PEDIR = '/api/v1/auth/recuperar-senha/'
const TROCAR = '/api/v1/auth/redefinir-senha/'
const CONVITE = '/api/v1/auth/definir-senha/'
const BOA = 'Frase longa de 2026!'

function preencherSenhas(senha = BOA, confirmacao = senha) {
  fireEvent.change(screen.getByLabelText('Senha nova'), { target: { value: senha } })
  fireEvent.change(screen.getByLabelText('Confirmar senha nova'), { target: { value: confirmacao } })
}

describe('PaginaEsqueciSenha', () => {
  it('pede o link e mostra a mesma confirmação que o servidor dá a qualquer e-mail', async () => {
    respostas[PEDIR] = () => ({ status: 200, corpo: { detail: 'ok' } })
    montar('/login/cliente/esqueci-senha', { email: 'ana@acme.test' })
    // o e-mail digitado no login vem junto
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@acme.test')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByRole('heading', { name: 'Confira seu e-mail' })).toBeInTheDocument()
    expect(screen.getByText(/Se existir uma conta com esse e-mail/)).toBeInTheDocument()
    expect(chamadas.find((c) => c.url === PEDIR)?.corpo).toEqual({ email: 'ana@acme.test' })

    fireEvent.click(screen.getByRole('link', { name: 'Voltar para o login' }))
    expect(await screen.findByText('login do cliente ana@acme.test')).toBeInTheDocument()
  })

  it('e-mail malformado não sai da tela', () => {
    montar('/login/esqueci-senha')
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(screen.getByText(/Informe um e-mail válido/)).toBeInTheDocument()
    expect(chamadas.filter((c) => c.url === PEDIR)).toHaveLength(0)
  })

  it('limite de pedidos vira uma mensagem com o tempo de espera', async () => {
    respostas[PEDIR] = () => ({ status: 429, corpo: { detail: 'Pedido foi suprimido. Espera-se que esteja disponível em 600 segundos.' } })
    montar('/login/esqueci-senha')
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'samuel@x.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(await screen.findByText('Muitas tentativas. Aguarde 10 minutos e tente de novo.')).toBeInTheDocument()
  })
})

describe('PaginaRedefinirSenha', () => {
  const valido = () => ({ status: 200, corpo: { valid: true, email: 'ana@acme.test', full_name: 'Ana Almeida', kind: 'client' } })

  it('confere o link, acende as regras e troca a senha; depois manda para o login com o e-mail', async () => {
    respostas[TROCAR] = (metodo, corpo, busca) => {
      if (metodo === 'GET') {
        expect(busca.get('uid')).toBe('MQ')
        expect(busca.get('token')).toBe('abc-123')
        return valido()
      }
      expect(corpo).toEqual({ uid: 'MQ', token: 'abc-123', new_password: BOA })
      return { status: 200, corpo: { email: 'ana@acme.test', kind: 'client' } }
    }
    montar('/login/cliente/redefinir-senha/MQ/abc-123')
    expect(await screen.findByRole('heading', { name: 'Crie uma senha nova' })).toBeInTheDocument()
    expect(screen.getByText('ana@acme.test')).toBeInTheDocument()

    preencherSenhas('curta')
    expect(screen.getByText('Pelo menos 12 caracteres').closest('li')).toHaveClass('text-tinta-secundaria')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }))
    expect(screen.getByText('Falta cumprir os requisitos marcados como pendentes.')).toBeInTheDocument()
    expect(chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0)

    preencherSenhas()
    expect(screen.getByText('Pelo menos 12 caracteres').closest('li')).toHaveClass('text-ok')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }))
    expect(await screen.findByRole('heading', { name: 'Senha alterada' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Ir para o login' }))
    expect(await screen.findByText('login do cliente ana@acme.test')).toBeInTheDocument()
  })

  it('o que o servidor recusa aparece embaixo do campo', async () => {
    respostas[TROCAR] = (metodo) =>
      metodo === 'GET' ? valido() : { status: 400, corpo: { new_password: ['Essa senha é muito comum.'] } }
    montar('/login/cliente/redefinir-senha/MQ/abc-123')
    await screen.findByLabelText('Senha nova')
    preencherSenhas('Senha-Comum-2026')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }))
    expect(await screen.findByText('Essa senha é muito comum.')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha nova')).toHaveAttribute('aria-invalid', 'true')
  })

  it('link vencido ou usado: explica e oferece pedir outro', async () => {
    respostas[TROCAR] = () => ({ status: 200, corpo: { valid: false } })
    montar('/login/redefinir-senha/MQ/velho')
    expect(await screen.findByRole('heading', { name: 'Este link não vale mais' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pedir um link novo' })).toHaveAttribute('href', '/login/esqueci-senha')
    expect(screen.queryByLabelText('Senha nova')).not.toBeInTheDocument()
  })

  it('link que morre entre abrir e salvar também cai no aviso', async () => {
    respostas[TROCAR] = (metodo) =>
      metodo === 'GET' ? valido() : { status: 400, corpo: { detail: 'Este link expirou ou já foi usado.', code: 'link_invalido' } }
    montar('/login/cliente/redefinir-senha/MQ/abc-123')
    await screen.findByLabelText('Senha nova')
    preencherSenhas()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }))
    expect(await screen.findByRole('heading', { name: 'Este link não vale mais' })).toBeInTheDocument()
  })

  it('convite: usa o endpoint do convite, com `password`, e a conta interna volta ao login da equipe', async () => {
    respostas[CONVITE] = (metodo, corpo) => {
      if (metodo === 'GET') return { status: 200, corpo: { valid: true, email: 'nina@x.test', full_name: 'Nina', kind: 'internal' } }
      expect(corpo).toEqual({ uid: 'Mg', token: 'tok', password: BOA })
      return { status: 200, corpo: { email: 'nina@x.test', kind: 'internal' } }
    }
    montar('/portal/definir-senha/Mg/tok')
    expect(await screen.findByRole('heading', { name: 'Defina sua senha' })).toBeInTheDocument()
    preencherSenhas()
    fireEvent.click(screen.getByRole('button', { name: 'Definir senha' }))
    expect(await screen.findByRole('heading', { name: 'Senha definida' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Ir para o login' }))
    await waitFor(() => expect(screen.getByText('login da equipe nina@x.test')).toBeInTheDocument())
  })
})
