import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaTelaDeLogin } from './AbaTelaDeLogin'

const marca = (audience: 'cliente' | 'equipe', extra: Record<string, unknown> = {}) => ({
  audience,
  brand_name: audience === 'cliente' ? 'Central de Suporte' : 'Resolv',
  headline: audience === 'cliente' ? 'Seu suporte, no seu tempo.' : 'Tudo que a equipe precisa.',
  subtitle: 'Sub',
  highlights: ['Um', 'Dois', 'Três'],
  image_url: null,
  updated_at: '2026-09-01T00:00:00Z',
  ...extra,
})
const DADOS = {
  cliente: marca('cliente'),
  equipe: marca('equipe'),
  defaults: {
    cliente: { brand_name: 'Central de Suporte', headline: 'Seu suporte, no seu tempo.', subtitle: 'Sub', highlights: ['Um', 'Dois', 'Três'] },
    equipe: { brand_name: 'Resolv', headline: 'Tudo que a equipe precisa.', subtitle: 'Sub', highlights: ['Um', 'Dois', 'Três'] },
  },
}

let chamadas: { url: string; metodo: string; corpo: unknown }[]
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
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body instanceof FormData ? 'formdata' : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (metodo === 'GET') return Promise.resolve(jsonDe(DADOS))
      if (u.pathname.endsWith('/image/')) return Promise.resolve(jsonDe(marca('cliente', { image_url: '/api/v1/branding/login-image/cliente/?v=2', updated_at: '2026-09-02T00:00:00Z' })))
      return Promise.resolve(jsonDe(marca('cliente', { ...(corpo as object), updated_at: '2026-09-02T00:00:00Z' })))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaTelaDeLogin />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('AbaTelaDeLogin', () => {
  it('mostra um bloco por público com a prévia do painel', async () => {
    montar()
    expect(await screen.findByText('Portal do cliente')).toBeInTheDocument()
    expect(screen.getByText('Painel da equipe')).toBeInTheDocument()
    const previas = screen.getAllByLabelText('Prévia do painel da tela de login')
    expect(previas[0]).toHaveTextContent('Seu suporte, no seu tempo.')
    expect(screen.getAllByRole('button', { name: 'Salvar alterações' })[0]).toBeDisabled()
  })

  it('manda só o que mudou e a prévia acompanha a digitação', async () => {
    montar()
    const chamada = (await screen.findAllByLabelText('Chamada'))[0]
    fireEvent.change(chamada, { target: { value: 'Estamos aqui por você.' } })
    expect(screen.getAllByLabelText('Prévia do painel da tela de login')[0]).toHaveTextContent('Estamos aqui por você.')
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar alterações' })[0])
    await waitFor(() => expect(chamadas.filter((c) => c.metodo === 'PUT')).toHaveLength(1))
    expect(chamadas.find((c) => c.metodo === 'PUT')).toEqual({
      url: '/api/v1/settings/branding/login/cliente/',
      metodo: 'PUT',
      corpo: { headline: 'Estamos aqui por você.' },
    })
  })

  it('destaque apagado sai da lista enviada', async () => {
    montar()
    const terceiro = (await screen.findAllByLabelText('Destaque 3'))[0]
    fireEvent.change(terceiro, { target: { value: '' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Salvar alterações' })[0])
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PUT')).toBe(true))
    expect((chamadas.find((c) => c.metodo === 'PUT')!.corpo as { highlights: string[] }).highlights).toEqual(['Um', 'Dois'])
  })

  it('envia a imagem como multipart para a rota do público', async () => {
    montar()
    const entrada = (await screen.findAllByLabelText(/Escolher imagem \(portal do cliente\)/))[0]
    const arquivo = new File(['x'], 'capa.png', { type: 'image/png' })
    fireEvent.change(entrada, { target: { files: [arquivo] } })
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/settings/branding/login/cliente/image/' && c.metodo === 'POST')).toBe(true))
    expect(chamadas.find((c) => c.metodo === 'POST')!.corpo).toBe('formdata')
  })
})
