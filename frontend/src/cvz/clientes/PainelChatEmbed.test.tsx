import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components/Toast/Toast'
import { PainelChatEmbed } from './PainelChatEmbed'

const ADMIN = { id: 1, full_name: 'Alice', email: 'admin@x.test', is_internal: true, is_admin: true, kind: 'internal', permissions: ['settings.manage'] }
const AGENTE = { ...ADMIN, id: 2, is_admin: false, permissions: [] }

let me: Record<string, unknown>
let embed: {
  enabled: boolean
  public_enabled: boolean
  origins: string[]
  rotated_at: string
  company_slug: string
  snippet: string
  iframe_url: string
}
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  me = ADMIN
  embed = {
    enabled: false,
    public_enabled: false,
    origins: ['https://loja.myvtex.com'],
    rotated_at: '2026-09-01T00:00:00Z',
    company_slug: 'acme',
    snippet: '<script src="https://app.resolv.test/embed/widget.js?company=acme" async></script>',
    iframe_url: 'https://app.resolv.test/embed/chat/?company=acme',
  }
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
    expect(await screen.findByText('Use o formato https://dominio.com, sem caminho.')).toBeInTheDocument()
    expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false)
  })

  it('regenerar a chave mostra o segredo uma única vez', async () => {
    montar()
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerar chave' }))
    expect(await screen.findByText('a'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText('Essa é a única vez que ela aparece. Copie agora.')).toBeInTheDocument()
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

describe('PainelChatEmbed — código de instalação (um por empresa)', () => {
  it('mostra o código pronto e copia com um clique', async () => {
    const escrever = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: escrever } })
    montar()

    expect(await screen.findByText(embed.snippet)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }))
    await waitFor(() => expect(escrever).toHaveBeenCalledWith(embed.snippet))
  })

  it('o código não carrega e-mail nem chave — é só a empresa', async () => {
    montar()
    const codigo = await screen.findByText(embed.snippet)
    expect(codigo.textContent).toContain('company=acme')
    expect(codigo.textContent).not.toContain('@')
    expect(codigo.textContent).not.toContain('sig=')
  })

  it('avisa que o chat está desabilitado antes de mandar colar o código', async () => {
    montar()
    expect(
      await screen.findByText(/está desabilitado: o código não vai mostrar nada/i),
    ).toBeInTheDocument()
  })

  it('ligado mas sem modo público, explica que este código não é o caminho', async () => {
    embed = { ...embed, enabled: true }
    montar()
    expect(await screen.findByText(/só funciona no modo público/i)).toBeInTheDocument()
  })

  it('no modo público, cobra a origem que falta em vez de deixar o cliente descobrir no navegador', async () => {
    embed = { ...embed, enabled: true, public_enabled: true, origins: [] }
    montar()
    expect(await screen.findByText(/Falta cadastrar a origem/i)).toBeInTheDocument()
  })
})

describe('PainelChatEmbed — modo público', () => {
  it('admin liga o modo público', async () => {
    montar()
    const toggle = await screen.findByRole('switch', { name: 'Só por link assinado' })
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(chamadas.some((c) => c.metodo === 'PATCH' && (c.corpo as Record<string, unknown>)?.public_enabled === true)).toBe(true),
    )
  })

  it('agente sem permissão não altera o modo, mas continua vendo o código', async () => {
    me = AGENTE
    embed = { ...embed, enabled: true, public_enabled: true }
    montar()
    expect(await screen.findByRole('switch', { name: /Público/ })).toBeDisabled()
    expect(screen.getByText(embed.snippet)).toBeInTheDocument()
  })
})
