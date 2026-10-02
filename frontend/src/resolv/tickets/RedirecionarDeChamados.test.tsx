import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { RedirecionarDeChamados } from './RedirecionarDeChamados'

function Destino({ nome }: { nome: string }) {
  const { pathname, search, hash } = useLocation()
  return (
    <>
      <h1>{nome}</h1>
      <output data-testid="url">{`${pathname}${search}${hash}`}</output>
    </>
  )
}

/** Mesma configuração de src/routes.tsx: as três rotas novas e as três
 *  antigas apontando para o redirecionamento. */
function montar(endereco: string) {
  const router = createMemoryRouter(
    [
      { path: '/inicio', element: <Destino nome="inicio" /> },
      { path: '/tickets', element: <Destino nome="lista" /> },
      { path: '/tickets/novo', element: <Destino nome="novo" /> },
      { path: '/tickets/:id', element: <Destino nome="detalhe" /> },
      { path: '/chamados', element: <RedirecionarDeChamados /> },
      { path: '/chamados/novo', element: <RedirecionarDeChamados /> },
      { path: '/chamados/:id', element: <RedirecionarDeChamados /> },
    ],
    { initialEntries: ['/inicio', endereco], initialIndex: 1 },
  )
  render(<RouterProvider router={router} />)
  return router
}

const url = () => screen.getByTestId('url').textContent

describe('RedirecionarDeChamados — endereços antigos do console', () => {
  it('/chamados vai para a lista em /tickets', async () => {
    montar('/chamados')
    expect(await screen.findByRole('heading', { name: 'lista' })).toBeInTheDocument()
    expect(url()).toBe('/tickets')
  })

  it('mantém os filtros da lista na query', async () => {
    montar('/chamados?view=todos&priority=urgent')
    expect(await screen.findByRole('heading', { name: 'lista' })).toBeInTheDocument()
    expect(url()).toBe('/tickets?view=todos&priority=urgent')
  })

  it('/chamados/novo mantém a query (empresa pré-escolhida)', async () => {
    montar('/chamados/novo?empresa=7')
    expect(await screen.findByRole('heading', { name: 'novo' })).toBeInTheDocument()
    expect(url()).toBe('/tickets/novo?empresa=7')
  })

  it('/chamados/:id vai para o detalhe e mantém o hash da mensagem', async () => {
    montar('/chamados/27#mensagem-43')
    expect(await screen.findByRole('heading', { name: 'detalhe' })).toBeInTheDocument()
    expect(url()).toBe('/tickets/27#mensagem-43')
  })

  it('mantém query e hash juntos', async () => {
    montar('/chamados/27?aba=historico#mensagem-43')
    expect(await screen.findByRole('heading', { name: 'detalhe' })).toBeInTheDocument()
    expect(url()).toBe('/tickets/27?aba=historico#mensagem-43')
  })

  it('substitui a entrada do histórico: "voltar" não cai de novo no endereço antigo', async () => {
    const router = montar('/chamados/27')
    expect(await screen.findByRole('heading', { name: 'detalhe' })).toBeInTheDocument()
    expect(router.state.historyAction).toBe('REPLACE')
    await router.navigate(-1)
    expect(router.state.location.pathname).toBe('/inicio')
  })
})
