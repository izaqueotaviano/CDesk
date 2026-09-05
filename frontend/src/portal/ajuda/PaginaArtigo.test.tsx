import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaArtigo } from './PaginaArtigo'

const ARTIGO = {
  id: 7,
  title: 'Como funciona o SLA',
  slug: 'sla',
  excerpt: 'Resumo',
  category: 'SLA',
  tags: ['prazo'],
  wp_url: 'https://site.test/suporte/sla/',
  wp_published_at: '2026-08-01T10:00:00Z',
  wp_modified_at: '2026-08-20T10:00:00Z',
  helpful_count: 3,
  not_helpful_count: 1,
  my_feedback: null as boolean | null,
  body_html: '<h2>Prazos</h2><p>Cada plano tem um prazo.</p>',
  related: [{ id: 8, title: 'Prazo por plano', slug: 'prazo' }],
}

let artigo: Record<string, unknown>
let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  artigo = { ...ARTIGO }
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname, metodo, corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
      if (u.pathname === '/api/v1/knowledge/articles/7/feedback/') {
        const helpful = JSON.parse(String(init?.body)).helpful
        return Promise.resolve(jsonDe({ helpful_count: helpful ? 4 : 3, not_helpful_count: helpful ? 1 : 2, my_feedback: helpful }))
      }
      if (u.pathname === '/api/v1/knowledge/articles/7/') return Promise.resolve(jsonDe(artigo))
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar(id = '7') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/portal/ajuda/${id}`]}>
        <Routes>
          <Route path="/portal/ajuda/:id" element={<PaginaArtigo />} />
          <Route path="/portal/ajuda" element={<p>lista da ajuda</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('PaginaArtigo', () => {
  it('renderiza o conteúdo do WordPress com a formatação preservada', async () => {
    montar()
    expect(await screen.findByRole('heading', { name: 'Como funciona o SLA', level: 1 })).toBeInTheDocument()
    // o HTML do artigo vira DOM de verdade (h2/p), não texto escapado
    expect(screen.getByRole('heading', { name: 'Prazos', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Cada plano tem um prazo.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ver no site/ })).toHaveAttribute('href', 'https://site.test/suporte/sla/')
  })

  it('mostra a contagem agregada de "isso ajudou?" e registra o voto', async () => {
    montar()
    expect(await screen.findByText('3 de 4 acharam útil')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sim/ }))
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/v1/knowledge/articles/7/feedback/')).toBe(true))
    expect(chamadas.find((c) => c.url.endsWith('/feedback/'))!.corpo).toEqual({ helpful: true })
    expect(await screen.findByText('Obrigado pelo retorno!')).toBeInTheDocument()
    expect(await screen.findByText('4 de 5 acharam útil')).toBeInTheDocument()
  })

  it('quem vota "não" ganha uma saída: abrir ticket', async () => {
    montar()
    await screen.findByRole('heading', { name: 'Como funciona o SLA', level: 1 })
    fireEvent.click(screen.getByRole('button', { name: /Não/ }))
    expect(await screen.findByText('Vamos resolver isso com você')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Abrir ticket/ })).toHaveAttribute('href', '/portal/tickets/novo')
  })

  it('lista os relacionados como links para outros artigos', async () => {
    montar()
    expect(await screen.findByRole('link', { name: 'Prazo por plano' })).toHaveAttribute('href', '/portal/ajuda/8')
  })

  it('artigo despublicado no WordPress: explica em vez de mostrar tela quebrada', async () => {
    montar('99')
    expect(await screen.findByText('Este artigo não existe mais')).toBeInTheDocument()
  })
})
