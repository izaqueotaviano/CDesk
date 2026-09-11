import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/cvz/components'
import { AbaStatus } from './AbaStatus'

/** A cor do formulário de status novo acompanha a categoria escolhida —
 * mesma paleta semântica que `apps.tickets.models.COR_POR_CATEGORIA` aplica
 * no backend quando o payload não traz cor. Aqui é só o preview do
 * formulário: quem decide o valor salvo continua sendo o backend (testado
 * em `apps/tickets/tests/test_status_cor_por_categoria.py`). */

interface Chamada {
  metodo: string
  corpo: unknown
}

let chamadas: Chamada[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  chamadas = []
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      const metodo = init?.method ?? 'GET'
      chamadas.push({ metodo, corpo: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (metodo === 'GET') return Promise.resolve(jsonDe([]))
      return Promise.resolve(jsonDe({ id: 1, ...(init?.body ? JSON.parse(String(init.body)) : {}) }, 201))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AbaStatus />
      </ToastProvider>
    </QueryClientProvider>,
  )
  const corInput = () => utils.container.querySelector<HTMLInputElement>('input.cfg-cor-input')!
  const categoriaSelect = () => screen.getByLabelText('Categoria') as HTMLSelectElement
  return { ...utils, corInput, categoriaSelect }
}

const escritas = () => chamadas.filter((c) => c.metodo !== 'GET')

describe('AbaStatus — cor acompanha a categoria', () => {
  it('começa com a cor semântica da categoria padrão (Aberto)', async () => {
    const { corInput } = montar()
    await screen.findByRole('button', { name: 'Adicionar status' })
    expect(corInput().value).toBe('#5a87b8')
  })

  it('troca a cor junto quando a categoria muda, sem escolha manual', async () => {
    const { corInput, categoriaSelect } = montar()
    await screen.findByRole('button', { name: 'Adicionar status' })

    fireEvent.change(categoriaSelect(), { target: { value: 'closed' } })
    expect(corInput().value).toBe('#8a8a85')

    fireEvent.change(categoriaSelect(), { target: { value: 'new' } })
    expect(corInput().value).toBe('#6c4e9c')
  })

  it('preserva uma cor escolhida manualmente ao trocar de categoria', async () => {
    const { corInput, categoriaSelect } = montar()
    await screen.findByRole('button', { name: 'Adicionar status' })

    fireEvent.change(corInput(), { target: { value: '#ff00aa' } })
    fireEvent.change(categoriaSelect(), { target: { value: 'closed' } })

    expect(corInput().value).toBe('#ff00aa') // não foi sobrescrita pela paleta
  })

  it('categoria sem paleta própria (resolved) cai no cinza padrão', async () => {
    const { corInput, categoriaSelect } = montar()
    await screen.findByRole('button', { name: 'Adicionar status' })

    fireEvent.change(categoriaSelect(), { target: { value: 'resolved' } })
    expect(corInput().value).toBe('#8a8a85')
  })

  it('envia a cor mostrada no momento do envio', async () => {
    montar()
    const nome = await screen.findByLabelText('Novo status')
    fireEvent.change(nome, { target: { value: 'Em análise' } })
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar status' }))

    await waitFor(() => expect(escritas()).toHaveLength(1))
    const corpo = escritas()[0].corpo as Record<string, unknown>
    // O DOM normaliza `<input type="color">` para minúsculo; o estado React
    // que de fato vai no payload guarda o valor tal como está na paleta.
    expect(corpo.color).toBe('#5A87B8')
  })
})
