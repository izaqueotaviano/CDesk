import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaAjuda } from './PaginaAjuda'

function artigo(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Artigo ${id}`,
    slug: `artigo-${id}`,
    excerpt: 'Resumo do artigo',
    category: 'SLA',
    tags: [],
    wp_url: `https://site.test/suporte/artigo-${id}/`,
    wp_published_at: '2026-08-01T10:00:00Z',
    wp_modified_at: '2026-08-20T10:00:00Z',
    helpful_count: 0,
    not_helpful_count: 0,
    my_feedback: null,
    ...extra,
  }
}

let artigos: unknown[]
let categorias: unknown[]
let urls: string[]

function jsonDe(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  artigos = [artigo(1, { title: 'Como funciona o SLA' }), artigo(2, { title: 'Rastrear meu pedido', category: 'Logística' })]
  categorias = [
    { name: 'Logística', count: 1 },
    { name: 'SLA', count: 1 },
  ]
  urls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      urls.push(u.pathname + u.search)
      if (u.pathname === '/api/v1/knowledge/articles/categories/') return Promise.resolve(jsonDe(categorias))
      if (u.pathname === '/api/v1/knowledge/articles/') {
        const q = u.searchParams.get('q')
        const cat = u.searchParams.get('category')
        let saida = artigos as ReturnType<typeof artigo>[]
        if (q) saida = saida.filter((a) => a.title.toLowerCase().includes(q.toLowerCase()))
        if (cat) saida = saida.filter((a) => a.category === cat)
        return Promise.resolve(jsonDe({ count: saida.length, next: null, previous: null, results: saida }))
      }
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(rota = '/portal/ajuda') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <Routes>
          <Route path="/portal/ajuda" element={<PaginaAjuda />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaAjuda', () => {
  it('mostra a busca em destaque, as categorias com contagem e os artigos', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Central de Ajuda' })).toBeInTheDocument()
    expect(screen.getByLabelText('Buscar na Central de Ajuda')).toBeInTheDocument()
    expect(await screen.findByText('Como funciona o SLA')).toBeInTheDocument()
    const chipSla = await screen.findByRole('button', { name: /^SLA/ })
    expect(chipSla).toHaveTextContent('1')
  })

  it('a busca vai para a consulta e o resultado é link compartilhável (fica na URL)', async () => {
    montar()
    await screen.findByText('Como funciona o SLA')
    fireEvent.change(screen.getByLabelText('Buscar na Central de Ajuda'), { target: { value: 'pedido' } })
    await waitFor(() => expect(urls.some((u) => u.includes('q=pedido'))).toBe(true))
    expect(await screen.findByText('Rastrear meu pedido')).toBeInTheDocument()
    expect(screen.queryByText('Como funciona o SLA')).not.toBeInTheDocument()
  })

  it('filtra por categoria ao clicar no chip', async () => {
    montar()
    await screen.findByText('Como funciona o SLA')
    fireEvent.click(await screen.findByRole('button', { name: /^Logística/ }))
    await waitFor(() => expect(urls.some((u) => u.includes('category=Log%C3%ADstica'))).toBe(true))
    expect(await screen.findByText('Rastrear meu pedido')).toBeInTheDocument()
    expect(screen.queryByText('Como funciona o SLA')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Logística/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('abre já filtrado quando a URL traz a categoria', async () => {
    montar('/portal/ajuda?categoria=SLA')
    await waitFor(() => expect(urls.some((u) => u.includes('category=SLA'))).toBe(true))
    expect(await screen.findByText('Como funciona o SLA')).toBeInTheDocument()
  })

  it('busca sem resultado oferece abrir ticket em vez de um beco sem saída', async () => {
    montar('/portal/ajuda?q=nada-disso')
    expect(await screen.findByText('Nada encontrado')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /Abrir ticket/ })[0]).toHaveAttribute('href', '/portal/tickets/novo')
  })

  it('acervo vazio (sincronização ainda não trouxe nada) manda para ticket e chat', async () => {
    artigos = []
    categorias = []
    montar()
    expect(await screen.findByText('Nenhum artigo publicado ainda')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Iniciar chat/ })).toHaveAttribute('href', '/portal/chat')
  })
})
