import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import type { EventoServidorPessoal } from '@/realtime/types'
import { pedirCompositor, useDigitacaoLocal } from './canalCompositor'
import { ContextoPresenca, descreverPresenca } from './contexto'
import { AvisoColisao, PresencaTicket } from './PresencaTicket'
import { OCIOSO_MS, useCompositorColaborativo } from './useCompositorColaborativo'
import { usePresencaTicket, type PresenteTicket } from './usePresencaTicket'

const post = vi.fn()
const del = vi.fn()
vi.mock('@/api/client', async (original) => ({
  ...(await original<typeof import('@/api/client')>()),
  api: {
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

let ouvinteWs: ((e: EventoServidorPessoal) => void) | null = null
vi.mock('@/realtime/bridge', () => ({
  assinarEventoPessoal: (o: (e: EventoServidorPessoal) => void) => {
    ouvinteWs = o
    return () => {
      ouvinteWs = null
    }
  },
}))

const samuel: PresenteTicket = { user_id: 5, nome: 'Samuel Souza', avatar_url: null, digitando: null }
const ana: PresenteTicket = { user_id: 6, nome: 'Ana Lima', avatar_url: null, digitando: null }
const eu: PresenteTicket = { user_id: 1, nome: 'Eu Mesmo', avatar_url: null, digitando: null }

beforeEach(() => {
  vi.useFakeTimers()
  post.mockReset().mockResolvedValue({ presentes: [eu, samuel], batimento_segundos: 15 })
  del.mockReset().mockResolvedValue({ presentes: [], batimento_segundos: 15 })
  useDigitacaoLocal.setState({ porTicket: {} })
})
afterEach(() => vi.useRealTimers())

describe('useCompositorColaborativo — "estou digitando"', () => {
  function montar(texto: string, publico = true, aoPedirModo = vi.fn()) {
    return renderHook((p: { texto: string; publico: boolean }) =>
      useCompositorColaborativo(42, { ...p, aoPedirModo }), { initialProps: { texto, publico } })
  }
  const estado = () => useDigitacaoLocal.getState().porTicket[42]

  it('rascunho restaurado ao abrir não conta como digitando', () => {
    montar('rascunho de ontem')
    expect(estado()).toBeUndefined()
  })

  it('digitar acende; parar por OCIOSO_MS apaga', () => {
    const { rerender } = montar('')
    rerender({ texto: 'Olá', publico: true })
    expect(estado()).toBe('resposta')

    act(() => {
      vi.advanceTimersByTime(OCIOSO_MS - 1)
    })
    rerender({ texto: 'Olá, Ana', publico: true }) // mais uma tecla renova
    act(() => {
      vi.advanceTimersByTime(OCIOSO_MS - 1)
    })
    expect(estado()).toBe('resposta')
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(estado()).toBeUndefined()
  })

  it('trocar para nota no meio muda o que os colegas veem, e o relógio segue valendo', () => {
    const { rerender } = montar('')
    rerender({ texto: 'Olá', publico: true })
    rerender({ texto: 'Olá', publico: false })
    expect(estado()).toBe('nota')
    act(() => {
      vi.advanceTimersByTime(OCIOSO_MS)
    })
    expect(estado()).toBeUndefined()
  })

  it('texto zerado (enviou ou apagou) e sair da tela apagam na hora', () => {
    const { rerender, unmount } = montar('')
    rerender({ texto: 'Olá', publico: true })
    rerender({ texto: '', publico: true })
    expect(estado()).toBeUndefined()

    rerender({ texto: 'de novo', publico: true })
    unmount()
    expect(estado()).toBeUndefined()
  })

  it('recebe os pedidos de `r`/`n` do ticket dele, e só dele', () => {
    const aoPedirModo = vi.fn()
    montar('', true, aoPedirModo)
    expect(pedirCompositor(42, 'nota')).toBe(true)
    expect(aoPedirModo).toHaveBeenLastCalledWith(false)
    pedirCompositor(42, 'resposta')
    expect(aoPedirModo).toHaveBeenLastCalledWith(true)
    expect(pedirCompositor(99, 'resposta')).toBe(false)
  })
})

describe('usePresencaTicket', () => {
  async function montar(habilitado = true) {
    const r = renderHook(() => usePresencaTicket(42, 1, habilitado))
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    return r
  }

  it('bate ao abrir e devolve os OUTROS presentes', async () => {
    const { result } = await montar()
    expect(post).toHaveBeenCalledWith('/api/v1/tickets/42/presenca/', { digitando: null })
    expect(result.current.map((p) => p.user_id)).toEqual([5])
  })

  it('bate de novo quando começo a digitar, e a cada batimento', async () => {
    await montar()
    await act(async () => {
      useDigitacaoLocal.getState().relatar(42, 'resposta')
    })
    await act(async () => {
      vi.advanceTimersByTime(0)
    })
    expect(post).toHaveBeenLastCalledWith('/api/v1/tickets/42/presenca/', { digitando: 'resposta' })

    post.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(15_000)
    })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('o evento do ws/me/ troca a lista na hora (só o do ticket certo)', async () => {
    const { result } = await montar()
    act(() => {
      ouvinteWs?.({ type: 'ticket_presence', ticket_id: 99, presentes: [ana] })
    })
    expect(result.current.map((p) => p.user_id)).toEqual([5])
    act(() => {
      ouvinteWs?.({
        type: 'ticket_presence',
        ticket_id: 42,
        presentes: [eu, { ...samuel, digitando: 'resposta' }, ana],
      })
    })
    expect(result.current.map((p) => [p.user_id, p.digitando])).toEqual([
      [5, 'resposta'],
      [6, null],
    ])
  })

  it('sair avisa o servidor com keepalive (um tique depois, por causa da remontagem)', async () => {
    const { unmount } = await montar()
    unmount()
    expect(del).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(0)
    })
    expect(del).toHaveBeenCalledWith('/api/v1/tickets/42/presenca/', { keepalive: true })
  })

  it('servidor que recusa (403/404) desliga a presença em silêncio', async () => {
    post.mockRejectedValue(new ApiError(404, { detail: 'Não encontrado.' }))
    const { result } = await montar()
    expect(result.current).toEqual([])
    post.mockClear()
    await act(async () => {
      vi.advanceTimersByTime(60_000)
    })
    expect(post).not.toHaveBeenCalled()
  })

  it('cliente (não interno) nem bate', async () => {
    await montar(false)
    expect(post).not.toHaveBeenCalled()
  })
})

describe('PresencaTicket e AvisoColisao', () => {
  function comPresentes(presentes: PresenteTicket[], ui: React.ReactNode) {
    return render(<ContextoPresenca.Provider value={presentes}>{ui}</ContextoPresenca.Provider>)
  }

  it('frase: quem responde primeiro, depois quem anota, depois quem vê', () => {
    expect(descreverPresenca([samuel])).toBe('Samuel está vendo')
    expect(descreverPresenca([samuel, ana])).toBe('Samuel e Ana estão vendo')
    expect(
      descreverPresenca([
        { ...ana, digitando: 'nota' },
        { ...samuel, digitando: 'resposta' },
      ]),
    ).toBe('Samuel está respondendo… · Ana está escrevendo uma nota…')
  })

  it('sozinho no ticket, o cabeçalho não mostra nada', () => {
    const { container } = comPresentes([], <PresencaTicket />)
    expect(container).toBeEmptyDOMElement()
  })

  it('mostra avatares e anuncia a frase', () => {
    comPresentes([{ ...samuel, digitando: 'resposta' }], <PresencaTicket />)
    expect(screen.getByRole('status')).toHaveTextContent('Samuel está respondendo…')
    expect(screen.getByTitle('Samuel Souza: respondendo ao cliente')).toHaveTextContent('SS')
  })

  it('avisa acima do compositor só quando alguém responde ao CLIENTE', () => {
    const { rerender } = comPresentes([{ ...samuel, digitando: 'nota' }], <AvisoColisao euDigitandoResposta />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(
      <ContextoPresenca.Provider value={[{ ...samuel, digitando: 'resposta' }]}>
        <AvisoColisao euDigitandoResposta />
      </ContextoPresenca.Provider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Samuel também está respondendo ao cliente.')

    rerender(
      <ContextoPresenca.Provider value={[{ ...samuel, digitando: 'resposta' }]}>
        <AvisoColisao euDigitandoResposta={false} />
      </ContextoPresenca.Provider>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Samuel está respondendo ao cliente.')
  })
})
