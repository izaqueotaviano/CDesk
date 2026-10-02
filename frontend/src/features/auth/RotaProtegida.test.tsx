import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RotaProtegida } from './RotaProtegida'

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

let respostaDoMe: () => Response

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(respostaDoMe())))
})
afterEach(() => vi.unstubAllGlobals())

function montar(paraLogin?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/protegida']}>
        <Routes>
          <Route
            path="/protegida"
            element={
              <RotaProtegida paraLogin={paraLogin}>
                <p>conteúdo protegido</p>
              </RotaProtegida>
            }
          />
          <Route path="/login" element={<p>tela de login (equipe)</p>} />
          <Route path="/login/cliente" element={<p>tela de login (cliente)</p>} />
          <Route path="/sessao-expirada" element={<p>sessão expirada</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RotaProtegida', () => {
  it('sem sessão (401) manda para o login da área — nunca a "sessão expirada"', async () => {
    respostaDoMe = () => jsonDe({ detail: 'Não autenticado.' }, 401)
    montar('/login/cliente')
    expect(await screen.findByText('tela de login (cliente)')).toBeInTheDocument()
  })

  it('403 continua indo para o login, por segurança', async () => {
    respostaDoMe = () => jsonDe({ detail: 'Proibido.' }, 403)
    montar()
    expect(await screen.findByText('tela de login (equipe)')).toBeInTheDocument()
  })

  it('erro que não é de autenticação (500) vai para a tela de sessão expirada', async () => {
    respostaDoMe = () => jsonDe({ detail: 'Erro interno.' }, 500)
    montar()
    expect(await screen.findByText('sessão expirada')).toBeInTheDocument()
  })

  it('com sessão válida, mostra o conteúdo', async () => {
    respostaDoMe = () => jsonDe({ id: 1, full_name: 'Ana', is_internal: false })
    montar()
    expect(await screen.findByText('conteúdo protegido')).toBeInTheDocument()
  })
})
