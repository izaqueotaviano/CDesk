import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePrefs } from './prefs'
import { mudancasParaConta, preferenciasDaConta, useSincronizarPreferencias } from './sincronizarPrefs'

/**
 * A ponte entre o aparelho (localStorage) e a conta (`/auth/me/`). O que
 * estas travas protegem: a conta ganha na chegada (é o que leva a escolha
 * para o outro computador), toda mudança no aparelho grava na conta — venha
 * de qual tela vier —, e o que chega do servidor ou de outra aba NÃO volta
 * como um PATCH (senão cada carga de página regravaria tudo).
 */

let conta: Record<string, unknown>
let patches: Record<string, unknown>[]

function jsonDe(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  localStorage.clear()
  usePrefs.setState({
    tamanhoTexto: 'padrao',
    densidade: 'compacta',
    somNotificacoes: true,
    ausenciaAutomatica: 15,
  })
  conta = {
    id: 1,
    full_name: 'Samuel',
    is_internal: true,
    presence: 'available',
    ui_density: '',
    ui_text_size: '',
    notification_sound: true,
    auto_away_minutes: 15,
  }
  patches = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const caminho = new URL(String(url), 'http://x').pathname
      if (caminho === '/api/v1/auth/me/') {
        if (init?.method === 'PATCH') {
          const corpo = JSON.parse(String(init.body))
          patches.push(corpo)
          conta = { ...conta, ...corpo }
        }
        return Promise.resolve(jsonDe(conta))
      }
      return Promise.resolve(jsonDe({}, 404))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-tamanho-texto')
  document.documentElement.style.removeProperty('--escala-texto')
})

function montar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useSincronizarPreferencias(), { wrapper }) }
}

describe('tradução conta ↔ aparelho', () => {
  it('lê os quatro campos e ignora densidade "automática" e campo ausente', () => {
    expect(
      preferenciasDaConta({
        ui_text_size: 'larger',
        ui_density: 'comfortable',
        notification_sound: false,
        auto_away_minutes: 0,
      }),
    ).toEqual({ tamanhoTexto: 'maior', densidade: 'confortavel', somNotificacoes: false, ausenciaAutomatica: 0 })

    expect(preferenciasDaConta({ ui_density: '' })).toEqual({})
  })

  it('só manda o que mudou, já no formato do servidor', () => {
    const antes = { tamanhoTexto: 'padrao', densidade: 'compacta', somNotificacoes: true, ausenciaAutomatica: 15 } as const
    expect(mudancasParaConta(antes, { ...antes, tamanhoTexto: 'grande' })).toEqual({ ui_text_size: 'large' })
    expect(mudancasParaConta(antes, { ...antes, densidade: 'confortavel', somNotificacoes: false })).toEqual({
      ui_density: 'comfortable',
      notification_sound: false,
    })
    expect(mudancasParaConta(antes, antes)).toBeNull()
  })
})

describe('useSincronizarPreferencias', () => {
  it('na chegada do `me`, a conta ganha do aparelho, e isso não vira PATCH', async () => {
    conta = { ...conta, ui_text_size: 'large', notification_sound: false, auto_away_minutes: 5, ui_density: 'compact' }
    montar()

    await waitFor(() => expect(usePrefs.getState().tamanhoTexto).toBe('grande'))
    expect(usePrefs.getState().somNotificacoes).toBe(false)
    expect(usePrefs.getState().ausenciaAutomatica).toBe(5)
    // o texto grande é carimbado no documento, não só guardado
    expect(document.documentElement.dataset.tamanhoTexto).toBe('grande')
    expect(document.documentElement.style.getPropertyValue('--escala-texto')).toBe('1.125')
    expect(patches).toEqual([])
  })

  it('mudança no aparelho grava na conta, venha de onde vier', async () => {
    const { client } = montar()
    await waitFor(() => expect(client.getQueryData(['me'])).toBeDefined())

    // o alternador da lista de chamados chama só o setter do store
    act(() => usePrefs.getState().setDensidade('confortavel'))
    await waitFor(() => expect(patches).toEqual([{ ui_density: 'comfortable' }]))

    act(() => usePrefs.getState().setSomNotificacoes(false))
    await waitFor(() => expect(patches).toHaveLength(2))
    expect(patches[1]).toEqual({ notification_sound: false })
    // a resposta do PATCH entra no cache: o `me` já é a verdade nova
    await waitFor(() =>
      expect(client.getQueryData<{ notification_sound: boolean }>(['me'])?.notification_sound).toBe(false),
    )
    // e ela não "desfaz" a escolha nem dispara outro PATCH
    expect(usePrefs.getState().somNotificacoes).toBe(false)
    expect(patches).toHaveLength(2)
  })

  it('densidade escolhida antes da sincronização existir sobe uma vez', async () => {
    usePrefs.setState({ densidade: 'confortavel' })
    montar()
    await waitFor(() => expect(patches).toEqual([{ ui_density: 'comfortable' }]))
  })

  it('o que outra aba gravou chega por `storage` e não é regravado aqui', async () => {
    const { client } = montar()
    await waitFor(() => expect(client.getQueryData(['me'])).toBeDefined())

    localStorage.setItem(
      'resolv:prefs',
      JSON.stringify({ state: { ...usePrefs.getState(), tamanhoTexto: 'maior' }, version: 1 }),
    )
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'resolv:prefs' }))
    })

    await waitFor(() => expect(usePrefs.getState().tamanhoTexto).toBe('maior'))
    expect(document.documentElement.dataset.tamanhoTexto).toBe('maior')
    expect(patches).toEqual([])
  })

  it('sem sessão não grava nada (um PATCH sem login viraria 401 e mandaria para o login)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonDe({ detail: 'x' }, 403))))
    montar()
    act(() => usePrefs.getState().setTamanhoTexto('maior'))
    await new Promise((r) => setTimeout(r, 20))
    const chamadas = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
    expect(chamadas.some(([, init]) => init?.method === 'PATCH')).toBe(false)
  })
})
