import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoSeguranca } from './SecaoSeguranca'

let metodo: '' | 'email' | 'totp'
let exigida: boolean
let chamadas: { url: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  metodo = ''
  exigida = false
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (init?.method === 'POST') chamadas.push({ url: u.pathname, corpo })
      if (u.pathname === '/api/v1/auth/2fa/status/') {
        return Promise.resolve(jsonDe({ method: metodo, pending: '', effective: metodo || (exigida ? 'email' : ''), required: exigida }))
      }
      if (u.pathname === '/api/v1/auth/2fa/setup/') {
        if (corpo.method === 'email') return Promise.resolve(jsonDe({ method: 'email', sent: true }))
        return Promise.resolve(jsonDe({ method: 'totp', secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/Resolv:ana@acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Resolv' }))
      }
      if (u.pathname === '/api/v1/auth/2fa/confirm/') {
        if (corpo.code !== '123456') return Promise.resolve(jsonDe({ detail: 'Código inválido ou expirado.' }, 400))
        metodo = chamadas.some((c) => c.url.endsWith('/setup/') && (c.corpo as { method: string }).method === 'totp') ? 'totp' : 'email'
        return Promise.resolve(jsonDe({ method: metodo }))
      }
      if (u.pathname === '/api/v1/auth/2fa/request-code/') return Promise.resolve(jsonDe({ sent: true }))
      if (u.pathname === '/api/v1/auth/2fa/disable/') {
        metodo = ''
        return Promise.resolve(jsonDe({ method: '' }))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SecaoSeguranca />
    </QueryClientProvider>,
  )
}

const interruptor = () => screen.getByRole('switch', { name: 'Verificação em duas etapas' })

describe('SecaoSeguranca', () => {
  it('desligada por padrão: entra só com a senha', async () => {
    montar()
    expect(await screen.findByText('Desligada')).toBeInTheDocument()
    expect(screen.getByText('Você entra só com a senha.')).toBeInTheDocument()
    expect(interruptor()).toHaveAttribute('aria-checked', 'false')
  })

  it('ligar por e-mail: escolhe o método, recebe o código e confirma', async () => {
    montar()
    await screen.findByText('Desligada')
    fireEvent.click(interruptor())
    expect(await screen.findByText('Como você quer receber o código?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText(/Enviamos um código de 6 dígitos para o seu e-mail/)).toBeInTheDocument()
    expect(chamadas[0]).toEqual({ url: '/api/v1/auth/2fa/setup/', corpo: { method: 'email' } })
    fireEvent.change(screen.getByLabelText('Código recebido por e-mail'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }))
    expect(await screen.findByText('O código do login chega por e-mail.')).toBeInTheDocument()
    expect(interruptor()).toHaveAttribute('aria-checked', 'true')
  })

  it('ligar pelo aplicativo: QR e chave, código errado é recusado, o certo ativa', async () => {
    montar()
    await screen.findByText('Desligada')
    fireEvent.click(interruptor())
    fireEvent.click(await screen.findByRole('radio', { name: /Aplicativo autenticador/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument()

    const campo = screen.getByLabelText('Código do aplicativo')
    fireEvent.change(campo, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }))
    expect(await screen.findByText('Código inválido ou expirado.')).toBeInTheDocument()

    fireEvent.change(campo, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }))
    expect(await screen.findByText('O código do login vem do aplicativo autenticador.')).toBeInTheDocument()
  })

  it('desligar com e-mail: pede o código por e-mail e desliga', async () => {
    metodo = 'email'
    montar()
    await screen.findByText('O código do login chega por e-mail.')
    fireEvent.click(interruptor())
    expect(await screen.findByText(/Enviamos um código para o seu e-mail/)).toBeInTheDocument()
    expect(chamadas.some((c) => c.url === '/api/v1/auth/2fa/request-code/')).toBe(true)
    fireEvent.change(screen.getByLabelText('Código recebido por e-mail'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desligar verificação' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/2fa/disable/')).toBe(true))
    expect(await screen.findByText('Você entra só com a senha.')).toBeInTheDocument()
  })

  it('exigida pela empresa: interruptor travado, mas dá para usar o aplicativo', async () => {
    exigida = true
    montar()
    expect(await screen.findByText('Exigida pela empresa')).toBeInTheDocument()
    expect(interruptor()).toBeDisabled()
    expect(interruptor()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /Usar o aplicativo autenticador/ })).toBeInTheDocument()
  })
})
