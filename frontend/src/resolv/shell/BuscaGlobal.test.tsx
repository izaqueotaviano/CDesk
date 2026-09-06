import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuscaGlobal } from './BuscaGlobal'

const RESULTADO = {
  tickets: [
    {
      id: 12,
      reference: 'TCK-0012',
      subject: 'Impressora não imprime',
      company_name: 'Beta Logística',
      stage_name: 'Em andamento',
    },
  ],
  companies: [{ id: 3, name: 'Acme Indústria', slug: 'acme' }],
  requesters: [
    {
      id: 44,
      full_name: 'Joana Cliente',
      email: 'joana@acme.test',
      company_id: 3,
      company_name: 'Gama Serviços',
    },
  ],
}
const VAZIO = { tickets: [], companies: [], requesters: [] }

let chamadas: { url: string; search: string }[]
let respostaDaBusca: () => Response

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  chamadas = []
  respostaDaBusca = () => jsonDe(RESULTADO)
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const u = new URL(String(url), 'http://x')
      chamadas.push({ url: u.pathname, search: u.search })
      if (u.pathname === '/api/v1/search/') return Promise.resolve(respostaDaBusca())
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        {/* Fora do <Routes> de propósito: no app a busca mora no Topbar, que
            sobrevive à navegação — é o que permite conferir aqui que ela se
            limpa depois de abrir um resultado, em vez de desmontar. */}
        <BuscaGlobal />
        <Routes>
          <Route path="/inicio" element={<p>tela inicial</p>} />
          <Route path="/chamados/:id" element={<p>detalhe do chamado</p>} />
          <Route path="/clientes/:id" element={<p>painel da empresa</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function campo() {
  return screen.getByRole('combobox', { name: 'Buscar chamado, empresa ou pessoa' })
}

function digitar(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } })
}

const buscas = () => chamadas.filter((c) => c.url === '/api/v1/search/')

describe('Busca global do cabeçalho', () => {
  it('não gasta requisição com uma letra só', async () => {
    montar()
    digitar('a')
    // Mais que o debounce (250ms): se fosse disparar, já teria disparado.
    await new Promise((r) => setTimeout(r, 450))
    expect(buscas()).toHaveLength(0)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a partir de dois caracteres busca no servidor com o termo digitado', async () => {
    montar()
    digitar('acme')
    await waitFor(() => expect(buscas()).toHaveLength(1))
    expect(buscas()[0].search).toBe('?q=acme')
  })

  it('mostra os três grupos rotulados, cada um com o que identifica a linha', async () => {
    montar()
    digitar('acme')

    expect(await screen.findByText('Chamados')).toBeInTheDocument()
    expect(screen.getByText('Empresas')).toBeInTheDocument()
    expect(screen.getByText('Solicitantes')).toBeInTheDocument()

    expect(screen.getByText('TCK-0012')).toBeInTheDocument()
    expect(screen.getByText('Impressora não imprime')).toBeInTheDocument()
    expect(screen.getByText('Beta Logística · Em andamento')).toBeInTheDocument()
    expect(screen.getByText('Acme Indústria')).toBeInTheDocument()
    expect(screen.getByText('Joana Cliente')).toBeInTheDocument()
    expect(screen.getByText('joana@acme.test · Gama Serviços')).toBeInTheDocument()
  })

  it('clicar num chamado abre o chamado e limpa a busca', async () => {
    montar()
    digitar('acme')
    fireEvent.click(await screen.findByRole('option', { name: /Impressora não imprime/ }))
    expect(await screen.findByText('detalhe do chamado')).toBeInTheDocument()
    expect(campo()).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('a seta pra baixo atravessa os grupos e o Enter abre o que está selecionado', async () => {
    montar()
    digitar('acme')
    await screen.findByRole('option', { name: /Impressora não imprime/ })

    // Da primeira linha (chamado) para a segunda, que já é de outro grupo.
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Acme Indústria/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(await screen.findByText('painel da empresa')).toBeInTheDocument()
  })

  it('diz que não achou nada, com o termo, em vez de abrir um dropdown mudo', async () => {
    respostaDaBusca = () => jsonDe(VAZIO)
    montar()
    digitar('zzz')
    expect(await screen.findByText(/Nada encontrado para/)).toHaveTextContent('zzz')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('quando a busca falha, avisa e deixa tentar de novo', async () => {
    respostaDaBusca = () => jsonDe({ detail: 'erro interno' }, 500)
    montar()
    digitar('acme')

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível buscar agora.')

    respostaDaBusca = () => jsonDe(RESULTADO)
    fireEvent.click(screen.getByRole('button', { name: /Tentar de novo/ }))
    expect(await screen.findByRole('option', { name: /Impressora não imprime/ })).toBeInTheDocument()
  })

  it('Ctrl+K em qualquer lugar da tela leva o foco pro campo', () => {
    montar()
    expect(campo()).not.toHaveFocus()
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(campo()).toHaveFocus()
  })

  it('Enter durante o debounce não abre o resultado da busca ANTERIOR', async () => {
    // Regressão: `navegaveis` continua sendo o payload do termo velho enquanto
    // o debounce conta (a queryKey só troca depois do timeout). Sem guarda,
    // digitar um termo novo e apertar Enter abria uma linha que não estava
    // mais na tela — o painel mostrava "Buscando…" e nenhuma opção.
    montar()
    digitar('acme')
    await screen.findByRole('option', { name: /Impressora não imprime/ })

    respostaDaBusca = () => jsonDe(VAZIO)
    digitar('zzzz')
    // Dentro da janela do debounce: nada de resultado na tela, mas o payload
    // antigo ainda está em memória.
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent('Buscando…')

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(screen.getByText('tela inicial')).toBeInTheDocument()
    // A referência ARIA também não pode ficar pendurada num id fora do DOM.
    expect(campo()).not.toHaveAttribute('aria-activedescendant')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Nada encontrado/))
  })

  it('solicitante sem empresa não abre nada, e diz por escrito por quê', async () => {
    respostaDaBusca = () =>
      jsonDe({
        ...VAZIO,
        requesters: [
          { id: 51, full_name: 'Tadeu Avulso', email: 'tadeu@x.test', company_id: null, company_name: null },
        ],
      })
    montar()
    digitar('tadeu')

    expect(await screen.findByText('Tadeu Avulso')).toBeInTheDocument()
    // O motivo é texto de verdade: `title` não aparece no toque, não é
    // alcançável pelo teclado e leitor de tela não anuncia em elemento sem
    // papel acessível.
    expect(screen.getByText('sem empresa vinculada')).toBeInTheDocument()
    // Não é opção: nem teclado nem clique chegam nela.
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })

  it('Esc limpa o que foi digitado e fecha o dropdown', async () => {
    montar()
    digitar('acme')
    await screen.findByRole('listbox')

    fireEvent.keyDown(campo(), { key: 'Escape' })
    expect(campo()).toHaveValue('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(campo()).not.toHaveFocus()
  })
})
