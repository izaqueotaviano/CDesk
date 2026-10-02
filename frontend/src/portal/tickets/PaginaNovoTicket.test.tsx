import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaginaNovoTicket } from './PaginaNovoTicket'

const ME = {
  id: 4,
  full_name: 'Ana Almeida',
  email: 'ana@acme.test',
  company_name: 'Acme',
  is_internal: false,
  is_admin: false,
  teams: [],
  permissions: [],
  quota: { used: 3, limit: 10, period_start: '2026-09-01', period_end: '2026-09-30' },
}
const CHAVE_RASCUNHO = 'resolv:portal:rascunho:4:novo-ticket'
const ARTIGO = {
  id: 12,
  title: 'Como corrigir o CNPJ da nota fiscal',
  slug: 'cnpj-nota',
  excerpt: 'Passo a passo para reemitir a NF-e',
  category: 'Fiscal',
  tags: [],
  wp_url: 'https://x.test/suporte/cnpj/',
  wp_published_at: null,
  wp_modified_at: null,
  helpful_count: 0,
  not_helpful_count: 0,
  my_feedback: null,
}

let chamadas: { url: string; metodo: string; corpo: unknown }[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  window.localStorage.clear()
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const u = new URL(String(url), 'http://x')
      const metodo = init?.method ?? 'GET'
      chamadas.push({ url: u.pathname + u.search, metodo, corpo: init?.body })
      if (u.pathname === '/api/v1/auth/me/') return Promise.resolve(jsonDe(ME))
      if (u.pathname === '/api/v1/teams/') return Promise.resolve(jsonDe([{ id: 1, name: 'Suporte', slug: 'suporte' }]))
      if (u.pathname === '/api/v1/categories/') return Promise.resolve(jsonDe([{ id: 3, name: 'Fiscal', service: null }]))
      if (u.pathname === '/api/v1/maintenance/') {
        return Promise.resolve(jsonDe({ used_minutes: 0, limit_minutes: null, period_start: '2026-09-01', period_end: '2026-09-30' }))
      }
      if (u.pathname === '/api/v1/chat/config/') {
        return Promise.resolve(
          jsonDe({
            welcome_message: '', score_min: 0, score_max: 10, low_score_threshold: 5, queue_open: true, queue_opens_at: null,
            // o limite do SERVIDOR, e não o 10 MB do código, é o que vale
            attachment_limits: { max_bytes: 5 * 1024 * 1024, max_bytes_per_message: 50 * 1024 * 1024, max_files_per_message: 3 },
          }),
        )
      }
      if (u.pathname === '/api/v1/knowledge/articles/suggest/') {
        return Promise.resolve(jsonDe(u.searchParams.get('q')?.toLowerCase().includes('cnpj') ? [ARTIGO] : []))
      }
      if (u.pathname === '/api/v1/knowledge/articles/12/') {
        return Promise.resolve(jsonDe({ ...ARTIGO, body_html: '<p>Reemita pela tela de pedidos.</p>', related: [] }))
      }
      if (u.pathname === '/api/v1/tickets/' && metodo === 'POST') return Promise.resolve(jsonDe({ id: 77, reference: 'TD-00077' }, 201))
      return Promise.resolve(jsonDe([]))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/portal/tickets/novo']}>
        <Routes>
          <Route path="/portal/tickets/novo" element={<PaginaNovoTicket />} />
          <Route path="/portal/tickets/:id" element={<p>ticket aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function arquivo(nome: string, bytes: number, tipo = 'application/pdf') {
  const f = new File(['x'], nome, { type: tipo })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

describe('PaginaNovoTicket', () => {
  it('sugere artigos pelo assunto e abre o artigo por cima, sem perder o formulário', async () => {
    montar()
    const assunto = await screen.findByLabelText('Assunto *')
    fireEvent.change(assunto, { target: { value: 'NF saiu com CNPJ errado' } })

    const link = await screen.findByRole('link', { name: /Como corrigir o CNPJ da nota fiscal/ }, { timeout: 2000 })
    expect(screen.getByText('Isso pode resolver')).toBeInTheDocument()
    // é um link de verdade: Ctrl+clique abre a página do artigo em outra aba
    expect(link).toHaveAttribute('href', '/portal/ajuda/12')

    fireEvent.click(link)
    const folha = await screen.findByRole('dialog')
    expect(await within(folha).findByText('Reemita pela tela de pedidos.')).toBeInTheDocument()
    fireEvent.click(within(folha).getByRole('button', { name: 'Voltar ao ticket' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Assunto *')).toHaveValue('NF saiu com CNPJ errado')
  })

  it('não pergunta com menos de 3 letras e não mostra nada quando nada casa', async () => {
    montar()
    const assunto = await screen.findByLabelText('Assunto *')
    fireEvent.change(assunto, { target: { value: 'nf' } })
    await new Promise((r) => setTimeout(r, 500))
    expect(chamadas.some((c) => c.url.startsWith('/api/v1/knowledge/articles/suggest/'))).toBe(false)

    fireEvent.change(assunto, { target: { value: 'impressora travada' } })
    await waitFor(() => expect(chamadas.some((c) => c.url.includes('suggest/?q=impressora'))).toBe(true), { timeout: 2000 })
    expect(screen.queryByText('Isso pode resolver')).not.toBeInTheDocument()
  })

  it('restaura o rascunho com aviso, e "Descartar" limpa', async () => {
    window.localStorage.setItem(
      CHAVE_RASCUNHO,
      JSON.stringify({ v: { equipeId: '1', categoriaId: '3', assunto: 'Frete errado', pedido: '8891', texto: 'Cobrou o dobro' }, em: Date.now() }),
    )
    montar()
    expect(await screen.findByText('Rascunho restaurado.')).toBeInTheDocument()
    expect(screen.getByLabelText('Assunto *')).toHaveValue('Frete errado')
    expect(screen.getByLabelText('Mensagem *')).toHaveValue('Cobrou o dobro')
    expect(screen.getByLabelText('Nº do pedido')).toHaveValue('8891')

    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }))
    expect(screen.getByLabelText('Assunto *')).toHaveValue('')
    expect(window.localStorage.getItem(CHAVE_RASCUNHO)).toBeNull()
  })

  it('grava o rascunho enquanto escreve', async () => {
    montar()
    const assunto = await screen.findByLabelText('Assunto *')
    await screen.findByText(/Até 5 MB por arquivo/) // me + config carregados
    fireEvent.change(assunto, { target: { value: 'Pedido sem rastreio' } })
    await waitFor(() => expect(window.localStorage.getItem(CHAVE_RASCUNHO)).toContain('Pedido sem rastreio'), { timeout: 2000 })
  })

  it('anexo por arrastar e por colar, com os limites do servidor', async () => {
    montar()
    expect(await screen.findByText('Imagens, PDF, Office, TXT, CSV ou ZIP. Até 5 MB por arquivo, 3 arquivos por mensagem.')).toBeInTheDocument()

    const mensagem = screen.getByLabelText('Mensagem *')
    fireEvent.drop(mensagem, {
      dataTransfer: { types: ['Files'], files: [arquivo('boleto.pdf', 1000), arquivo('video.pdf', 6 * 1024 * 1024)] },
    })
    const lista = await screen.findByRole('list', { name: 'Anexos a enviar' })
    expect(within(lista).getByText('boleto.pdf')).toBeInTheDocument()
    expect(within(lista).queryByText('video.pdf')).not.toBeInTheDocument()
    expect(screen.getByText(/“video\.pdf” tem 6,0 MB; o limite por arquivo é 5 MB\./)).toBeInTheDocument()

    const print = new File(['png'], 'image.png', { type: 'image/png' })
    fireEvent.paste(mensagem, {
      clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => print }] },
    })
    expect(await within(lista).findByText(/^captura-\d{14}\.png$/)).toBeInTheDocument()

    fireEvent.click(within(lista).getByRole('button', { name: 'Remover boleto.pdf' }))
    expect(within(lista).queryByText('boleto.pdf')).not.toBeInTheDocument()
  })

  it('abre o ticket com os anexos e apaga o rascunho', async () => {
    montar()
    await screen.findByText(/Até 5 MB por arquivo/)
    fireEvent.change(screen.getByLabelText('Setor *'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Assunto *'), { target: { value: 'Frete errado' } })
    fireEvent.change(screen.getByLabelText('Mensagem *'), { target: { value: 'Cobrou o dobro' } })
    fireEvent.drop(screen.getByLabelText('Mensagem *'), { dataTransfer: { types: ['Files'], files: [arquivo('nota.pdf', 2000)] } })
    await screen.findByText('nota.pdf')
    await waitFor(() => expect(window.localStorage.getItem(CHAVE_RASCUNHO)).not.toBeNull(), { timeout: 2000 })

    fireEvent.click(screen.getByRole('button', { name: /Abrir ticket/ }))
    expect(await screen.findByText('ticket aberto')).toBeInTheDocument()
    const envio = chamadas.find((c) => c.url === '/api/v1/tickets/' && c.metodo === 'POST')!
    expect(envio.corpo).toBeInstanceOf(FormData)
    const form = envio.corpo as FormData
    expect(form.get('subject')).toBe('Frete errado')
    expect((form.getAll('files')[0] as File).name).toBe('nota.pdf')
    expect(window.localStorage.getItem(CHAVE_RASCUNHO)).toBeNull()
  })
})
