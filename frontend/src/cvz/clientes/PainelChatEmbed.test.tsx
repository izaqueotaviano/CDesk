import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PainelChatEmbed } from './PainelChatEmbed'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: [] }

let me: Record<string, unknown>
let embed: { enabled: boolean; origins: string[]; rotated_at: string }
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  embed = { enabled: false, origins: ['https://loja.myvtex.com'], rotated_at: '2026-09-01T00:00:00Z' }
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      chamadas.push({ url: u.pathname, metodo, corpo })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(me))
      if (u.pathname === '/api/v1/settings/companies/7/chat-embed/' && metodo === 'GET') return Promise.resolve(jsonDe(embed))
      if (u.pathname === '/api/v1/settings/companies/7/chat-embed/' && metodo === 'PATCH') {
        embed = { ...embed, ...corpo }
        return Promise.resolve(jsonDe(embed))
      }
      if (u.pathname === '/api/v1/settings/companies/7/chat-embed/regenerate-secret/') return Promise.resolve(jsonDe({ secret: 'a'.repeat(64) }))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PainelChatEmbed empresaId={7} habilitado />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('PainelChatEmbed', () => {
  it('admin liga o widget', async () => {
    montar()
    const toggle = await screen.findByRole('switch', { name: 'Desabilitado' })
    fireEvent.click(toggle)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/settings/companies/7/chat-embed/' && c.metodo === 'PATCH')).toBe(true))
    expect(chamadas.find((c) => c.metodo === 'PATCH')!.corpo).toEqual({ enabled: true })
  })

  it('admin adiciona uma origem válida', async () => {
    montar()
    await screen.findByText('https://loja.myvtex.com')
    fireEvent.change(screen.getByPlaceholderText('https://loja.myvtex.com'), { target: { value: 'HTTPS://Acme.MyVtex.com/' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar origem' }))
    await waitFor(() => expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(true))
    expect(chamadas.find((c) => c.metodo === 'PATCH')!.corpo).toEqual({ origins: ['https://loja.myvtex.com', 'https://acme.myvtex.com'] })
  })

  it('recusa origem em formato inválido sem chamar a API', async () => {
    montar()
    await screen.findByText('https://loja.myvtex.com')
    fireEvent.change(screen.getByPlaceholderText('https://loja.myvtex.com'), { target: { value: 'acme.myvtex.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar origem' }))
    expect(await screen.findByText('Use o formato https://dominio.com — sem caminho.')).toBeInTheDocument()
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false)
  })

  it('regenerar a chave mostra o segredo uma única vez', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerar chave' }))
    expect(await screen.findByText('a'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('Essa é a única vez que ela aparece — copie agora.')).toBeInTheDocument()
  })

  it('agente sem settings.manage só vê leitura, sem controles de escrita', async () => {
    me = AGENTE
    montar()
    await screen.findByText('https://loja.myvtex.com')
    expect(screen.queryByRole('button', { name: 'Adicionar origem' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Regenerar chave' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Desabilitado' })).toBeDisabled()
    expect(screen.getByText('Só administradores podem alterar essas configurações.')).toBeInTheDocument()
  })
})
