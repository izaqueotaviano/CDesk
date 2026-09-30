import { useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BuscaComando } from './BuscaComando'

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

/** `aberto` agora é controlado de fora (NovoShell, na base real) — este
 *  harness reproduz o mesmo contrato, com o painel já aberto por padrão
 *  (a maioria dos testes quer isso; o teste do Ctrl/⌘K abre a partir do
 *  fechado de propósito). */
function Harness({ comecaAberto = true }: { comecaAberto?: boolean }) {
  const [aberto, setAberto] = useState(comecaAberto)
  return <BuscaComando aberto={aberto} onAbrir={() => setAberto(true)} onFechar={() => setAberto(false)} />
}

function montar(comecaAberto = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/inicio']}>
        <Harness comecaAberto={comecaAberto} />
        <Routes>
          <Route path="/inicio" element={<p>tela inicial</p>} />
          <Route path="/tickets/:id" element={<p>detalhe do chamado</p>} />
          <Route path="/clientes/:id" element={<p>painel da empresa</p>} />
          <Route path="/clientes" element={<p>lista de clientes</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function campo() {
  return screen.getByRole('combobox', { name: 'Buscar ticket, empresa, pessoa ou área do sistema' })
}

function digitar(texto: string) {
  fireEvent.change(campo(), { target: { value: texto } })
}

const buscas = () => chamadas.filter((c) => c.url === '/api/v1/search/')

describe('Busca + navegação do shell', () => {
  it('abre com o grupo "Navegar" cheio, mesmo sem digitar nada — efeito de paleta de comandos', () => {
    montar()

    expect(screen.getByText('Navegar')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Clientes/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Configurações/ })).toBeInTheDocument()
    expect(buscas()).toHaveLength(0)
  })

  it('não gasta requisição de busca com uma letra só — Navegar filtra na hora, sem rede', async () => {
    montar()
    digitar('a')
    // Mais que o debounce (250ms): se fosse disparar, já teria disparado.
    await new Promise((r) => setTimeout(r, 450))
    expect(buscas()).toHaveLength(0)
    expect(screen.queryByRole('group', { name: 'Tickets' })).not.toBeInTheDocument()
  })

  it('a partir de dois caracteres busca no servidor com o termo digitado', async () => {
    montar()
    digitar('acme')
    await waitFor(() => expect(buscas()).toHaveLength(1))
    expect(buscas()[0].search).toBe('?q=acme')
  })

  it('mostra os três grupos de busca rotulados, cada um com o que identifica a linha', async () => {
    montar()
    digitar('acme')

    expect(await screen.findByRole('group', { name: 'Tickets' })).toBeInTheDocument()
    expect(screen.getByText('Empresas')).toBeInTheDocument()
    expect(screen.getByText('Solicitantes')).toBeInTheDocument()

    expect(screen.getByText('TCK-0012')).toBeInTheDocument()
    expect(screen.getByText('Impressora não imprime')).toBeInTheDocument()
    expect(screen.getByText('Beta Logística · Em andamento')).toBeInTheDocument()
    expect(screen.getByText('Acme Indústria')).toBeInTheDocument()
    expect(screen.getByText('Joana Cliente')).toBeInTheDocument()
    expect(screen.getByText('joana@acme.test · Gama Serviços')).toBeInTheDocument()
  })

  it('clicar numa rota de "Navegar" leva pra lá e fecha o painel', () => {
    montar()

    fireEvent.click(screen.getByRole('option', { name: /Clientes/ }))

    expect(screen.getByText('lista de clientes')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('clicar num chamado abre o chamado e fecha o painel', async () => {
    montar()
    digitar('acme')
    fireEvent.click(await screen.findByRole('option', { name: /Impressora não imprime/ }))
    expect(await screen.findByText('detalhe do chamado')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('a seta pra baixo atravessa Navegar → Chamados → Empresas, e o Enter abre o que está selecionado', async () => {
    montar()
    digitar('acme')
    await screen.findByRole('option', { name: /Impressora não imprime/ })

    // Navegar não bate com "acme" (nenhum rótulo da Sidebar contém isso), então
    // a primeira opção já é o chamado — uma seta pra baixo vai pra Empresas.
    fireEvent.keyDown(campo(), { key: 'ArrowDown' })
    expect(screen.getByRole('option', { name: /Acme Indústria/ })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(campo(), { key: 'Enter' })
    expect(await screen.findByText('painel da empresa')).toBeInTheDocument()
  })

  it('diz que não achou nada quando nem Navegar nem a busca casam com o termo', async () => {
    respostaDaBusca = () => jsonDe(VAZIO)
    montar()
    digitar('zzz')
    expect(await screen.findByText(/Nada encontrado para/)).toHaveTextContent('zzz')
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

  it('Ctrl+K com o painel fechado abre e leva o foco pro campo', async () => {
    montar(false)
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(await screen.findByRole('combobox')).toHaveFocus()
  })

  it('Enter durante o debounce não abre o resultado da busca ANTERIOR', async () => {
    // Regressão: `navegaveis` continua sendo o payload do termo velho enquanto
    // o debounce conta (a queryKey só troca depois do timeout). Sem guarda,
    // digitar um termo novo e apertar Enter abria uma linha que não estava
    // mais na tela.
    montar()
    digitar('acme')
    await screen.findByRole('option', { name: /Impressora não imprime/ })

    respostaDaBusca = () => jsonDe(VAZIO)
    digitar('zzzz')
    // Dentro da janela do debounce: os grupos de busca ainda mostram o
    // payload antigo (Navegar já reagiu, filtrado, sem nada pra "zzzz").
    expect(screen.getByRole('status')).toHaveTextContent('Buscando…')

    fireEvent.keyDown(campo(), { key: 'Enter' })
    // Enter bloqueado (debounce em voo): nada navegou, a rota inicial
    // continua na tela e o painel continua aberto.
    expect(screen.getByText('tela inicial')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()

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
    expect(screen.getByText('sem empresa vinculada')).toBeInTheDocument()
    expect(screen.queryAllByRole('option', { name: /Tadeu/ })).toHaveLength(0)
  })

  it('Esc fecha o painel', async () => {
    montar()
    digitar('acme')
    await screen.findByRole('option', { name: /Impressora não imprime/ })

    fireEvent.keyDown(campo(), { key: 'Escape' })
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('clicar no véu, fora do painel, fecha', () => {
    const { container } = montar()
    const veu = container.querySelector('.busca-comando__veu')!

    fireEvent.mouseDown(veu)

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
