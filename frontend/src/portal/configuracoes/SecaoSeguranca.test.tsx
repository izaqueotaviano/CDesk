import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecaoSeguranca } from './SecaoSeguranca'

let metodo: '' | 'email' | 'totp'
let chamadas: { url: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  metodo = ''
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      if (init?.method === 'POST') chamadas.push({ url: u.pathname, corpo })
      if (u.pathname === '/api/v1/auth/2fa/status/') return Promise.resolve(jsonDe({ method: metodo, pending: '' }))
      if (u.pathname === '/api/v1/auth/2fa/setup/') {
        return Promise.resolve(jsonDe({ method: 'totp', secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/Resolv:ana@acme.test?secret=JBSWY3DPEHPK3PXP&issuer=Resolv' }))
      }
      if (u.pathname === '/api/v1/auth/2fa/confirm/') {
        if (corpo.code !== '123456') return Promise.resolve(jsonDe({ detail: 'Código inválido ou expirado.' }, 400))
        metodo = 'totp'
        return Promise.resolve(jsonDe({ method: 'totp' }))
      }
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

describe('SecaoSeguranca', () => {
  it('diz que a verificação é sempre exigida e que hoje o código vem por e-mail', async () => {
    montar()
    expect(await screen.findByText('Ativa em todos os logins')).toBeInTheDocument()
    expect(screen.getByText('Hoje o código chega por e-mail.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Usar aplicativo autenticador/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('ligar o aplicativo: mostra QR e chave, código errado é recusado, o certo ativa', async () => {
    montar()
    fireEvent.click(await screen.findByRole('switch', { name: /Usar aplicativo autenticador/ }))
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument()
    expect(chamadas[0]).toEqual({ url: '/api/v1/auth/2fa/setup/', corpo: { method: 'totp' } })

    const campo = screen.getByLabelText('Código do aplicativo')
    fireEvent.change(campo, { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }))
    expect(await screen.findByText('Código inválido ou expirado.')).toBeInTheDocument()

    fireEvent.change(campo, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar e ativar' }))
    expect(await screen.findByText('Hoje o código vem do aplicativo autenticador.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Usar aplicativo autenticador/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('desligar o aplicativo exige um código dele e volta para o e-mail', async () => {
    metodo = 'totp'
    montar()
    fireEvent.click(await screen.findByRole('switch', { name: /Usar aplicativo autenticador/ }))
    expect(await screen.findByText(/Para desligar o aplicativo/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Código do aplicativo'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Desligar aplicativo' }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/auth/2fa/disable/' && (c.corpo as { code: string }).code === '654321')).toBe(true))
    expect(await screen.findByText('Hoje o código chega por e-mail.')).toBeInTheDocument()
  })
})
