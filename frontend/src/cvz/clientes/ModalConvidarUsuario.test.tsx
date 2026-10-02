import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { ModalConvidarUsuario } from './ModalConvidarUsuario'

let chamadas: { url: string; metodo: string; corpo: Record<string, unknown> | undefined }[]
let respostaConvite: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const URL_CONVITE = '/api/v1/settings/companies/7/users/'

beforeEach(() => {
  chamadas = []
  respostaConvite = () => jsonDe({ id: 99, full_name: 'Bia', email: 'bia@acme.test' }, 201)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({
        url: u.pathname,
        metodo: init?.method ?? 'GET',
        corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      })
      if (u.pathname === URL_CONVITE) return Promise.resolve(respostaConvite())
      return Promise.resolve(jsonDe({}))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModalConvidarUsuario empresaId={7} open onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

function preencherBasico() {
  fireEvent.change(screen.getByLabelText('Nome completo'), { target: { value: 'Bia Souza' } })
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'bia@acme.test' } })
}

const posts = () => chamadas.filter((c) => c.metodo === 'POST')

describe('ModalConvidarUsuario — telefone é parte do cadastro', () => {
  it('manda o telefone junto com nome, e-mail e papel', async () => {
    montar()
    preencherBasico()
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '11999990000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].url).toBe(URL_CONVITE)
    expect(posts()[0].corpo).toMatchObject({
      full_name: 'Bia Souza',
      email: 'bia@acme.test',
      client_role: 'member',
      phone: '11999990000',
    })
  })

  it('só o telefone secundário já basta — é um dos dois, não os dois', async () => {
    montar()
    preencherBasico()
    fireEvent.change(screen.getByLabelText('Telefone secundário'), { target: { value: '1133334444' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))

    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].corpo).toMatchObject({ phone: '', phone_secondary: '1133334444' })
  })

  it('sem nenhum telefone, avisa na tela e não gasta a chamada', async () => {
    montar()
    preencherBasico()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))

    expect(await screen.findByText('Informe ao menos um telefone.')).toBeInTheDocument()
    expect(posts()).toHaveLength(0)
  })

  it('erro de campo do servidor continua aparecendo no modal', async () => {
    respostaConvite = () => jsonDe({ email: ['Já existe um usuário com este e-mail.'] }, 400)
    montar()
    preencherBasico()
    fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: '11999990000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar convite' }))

    expect(await screen.findByText('Já existe um usuário com este e-mail.')).toBeInTheDocument()
  })
})
