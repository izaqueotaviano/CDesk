import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/client'
import { useChatUi } from '@/stores/chatUi'
import { useTabs } from '@/stores/tabs'
import { useLogout } from './useLogout'

vi.mock('@/api/client', () => ({ api: { post: vi.fn() } }))
vi.mock('@/realtime/bridge', () => ({ desconectarCanalPessoal: vi.fn() }))

function Envoltorio({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(api.post).mockResolvedValue(undefined)
  useTabs.setState({
    tabs: [
      {
        tipo: 'ticket',
        ticketId: 27,
        resumo: { id: 27, reference: 'TD-00027', subject: 'Teclado', status: 'open', requester_display: 'Ana' },
        scroll: 0,
        draft: 'rascunho da pessoa anterior',
      },
      { tipo: 'secao', rota: '/quadro', titulo: 'Quadro', icone: 'ti ti-layout-grid' },
    ],
    active: 'ticket:27',
    rascunhosGuardados: [{ ticketId: 5, draft: 'outro rascunho' }],
    reconciliando: false,
  })
})

afterEach(() => {
  useTabs.getState().limparTudo()
})

describe('useLogout', () => {
  it('sair da conta esvazia as abas e os rascunhos: a próxima pessoa nesta máquina não os herda', async () => {
    const { result } = renderHook(() => useLogout(), { wrapper: Envoltorio })

    act(() => result.current.mutate())

    await waitFor(() => expect(useTabs.getState().tabs).toEqual([]))
    expect(useTabs.getState().active).toBeNull()
    expect(useTabs.getState().rascunhosGuardados).toEqual([])
    // o que o navegador guardou também
    expect(localStorage.getItem('resolv:tabs')).not.toContain('rascunho da pessoa anterior')
    expect(localStorage.getItem('resolv:tabs')).not.toContain('outro rascunho')
    // e o mini chat, como antes
    expect(useChatUi.getState().abertos).toEqual([])
  })

  it('se o logout falha, as abas ficam (a pessoa continua logada)', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('500'))
    const { result } = renderHook(() => useLogout(), { wrapper: Envoltorio })

    act(() => result.current.mutate())

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(useTabs.getState().tabs).toHaveLength(2)
  })
})
