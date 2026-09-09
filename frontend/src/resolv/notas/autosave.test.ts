import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutosave, type ValoresNota } from './autosave'

const salvar = vi.fn()
vi.mock('@/api/notas', () => ({
  useAcoesNota: () => ({ salvar: { mutateAsync: salvar } }),
}))

/** Com timers falsos o `waitFor` do RTL não avança sozinho e trava até o
 *  timeout. As gravações são encadeadas por await, então drenar as
 *  microtasks é o que basta — e é determinístico. */
async function escoar() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve()
  })
}

const INICIAL: ValoresNota = { title: 'Título', content: 'Corpo', tagNames: ['urgente'] }

function montar(valores: ValoresNota = INICIAL) {
  return renderHook(
    ({ v }: { v: ValoresNota }) => useAutosave({ notaId: 7, valores: v, inicial: INICIAL, atraso: 800 }),
    { initialProps: { v: valores } },
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  salvar.mockReset()
  salvar.mockResolvedValue({})
})
afterEach(() => vi.useRealTimers())

describe('useAutosave', () => {
  it('não grava quando nada mudou', () => {
    montar()
    act(() => void vi.advanceTimersByTime(5000))

    expect(salvar).not.toHaveBeenCalled()
  })

  it('espera a pausa na digitação — três teclas, uma gravação', () => {
    const { rerender } = montar()

    rerender({ v: { ...INICIAL, content: 'C1' } })
    act(() => void vi.advanceTimersByTime(300))
    rerender({ v: { ...INICIAL, content: 'C12' } })
    act(() => void vi.advanceTimersByTime(300))
    rerender({ v: { ...INICIAL, content: 'C123' } })
    expect(salvar).not.toHaveBeenCalled()

    act(() => void vi.advanceTimersByTime(800))
    expect(salvar).toHaveBeenCalledTimes(1)
    expect(salvar).toHaveBeenCalledWith({ id: 7, content: 'C123' })
  })

  it('manda só o campo que mudou', () => {
    const { rerender } = montar()

    rerender({ v: { ...INICIAL, title: 'Outro' } })
    act(() => void vi.advanceTimersByTime(800))

    expect(salvar).toHaveBeenCalledWith({ id: 7, title: 'Outro' })
  })

  it('não manda tag_names quando as etiquetas não mudaram', () => {
    // Ausente ≠ vazio no backend: mandar à toa custaria um get_or_create por
    // etiqueta a cada pausa na digitação.
    const { rerender } = montar()

    rerender({ v: { ...INICIAL, content: 'novo' } })
    act(() => void vi.advanceTimersByTime(800))

    expect(salvar.mock.calls[0][0]).not.toHaveProperty('tag_names')
  })

  it('manda tag_names quando as etiquetas mudaram', () => {
    const { rerender } = montar()

    rerender({ v: { ...INICIAL, tagNames: ['urgente', 'cliente'] } })
    act(() => void vi.advanceTimersByTime(800))

    expect(salvar).toHaveBeenCalledWith({ id: 7, tag_names: ['urgente', 'cliente'] })
  })

  it('não deixa duas gravações em voo — a segunda espera e leva o texto mais novo', async () => {
    // Duas em paralelo podem chegar fora de ordem e gravar o texto VELHO por
    // cima do novo. A segunda só sai depois que a primeira volta.
    let liberar!: (v: unknown) => void
    salvar.mockImplementationOnce(() => new Promise((r) => (liberar = r)))
    const { rerender } = montar()

    rerender({ v: { ...INICIAL, content: 'primeiro' } })
    act(() => void vi.advanceTimersByTime(800))
    expect(salvar).toHaveBeenCalledTimes(1)

    // digita de novo com a primeira ainda em voo
    rerender({ v: { ...INICIAL, content: 'segundo' } })
    act(() => void vi.advanceTimersByTime(800))
    expect(salvar).toHaveBeenCalledTimes(1)

    liberar({})
    await escoar()

    expect(salvar).toHaveBeenCalledTimes(2)
    expect(salvar).toHaveBeenLastCalledWith({ id: 7, content: 'segundo' })
  })

  it('grava ao sair, sem esperar a pausa', () => {
    // Trocar de nota dentro da janela do debounce não pode levar o texto.
    const { rerender, unmount } = montar()

    rerender({ v: { ...INICIAL, content: 'quase perdido' } })
    act(() => void vi.advanceTimersByTime(100))
    expect(salvar).not.toHaveBeenCalled()

    unmount()

    expect(salvar).toHaveBeenCalledWith({ id: 7, content: 'quase perdido' })
  })

  it('não grava ao sair se nada mudou', () => {
    const { unmount } = montar()
    unmount()

    expect(salvar).not.toHaveBeenCalled()
  })

  it('anuncia o estado: pendente → salvando → salvo', async () => {
    const { result, rerender } = montar()
    expect(result.current.estado).toBe('ocioso')

    rerender({ v: { ...INICIAL, content: 'x' } })
    expect(result.current.estado).toBe('pendente')

    act(() => void vi.advanceTimersByTime(800))
    await escoar()
    expect(result.current.estado).toBe('salvo')
  })

  it('avisa quando a gravação falha', async () => {
    salvar.mockRejectedValue(new Error('rede'))
    const { result, rerender } = montar()

    rerender({ v: { ...INICIAL, content: 'x' } })
    act(() => void vi.advanceTimersByTime(800))
    await escoar()

    expect(result.current.estado).toBe('erro')
  })

  it('tenta de novo depois de um erro, sem perder o texto', async () => {
    salvar.mockRejectedValueOnce(new Error('rede')).mockResolvedValue({})
    const { result, rerender } = montar()

    rerender({ v: { ...INICIAL, content: 'x' } })
    act(() => void vi.advanceTimersByTime(800))
    await escoar()
    expect(result.current.estado).toBe('erro')

    act(() => result.current.salvarAgora())
    await escoar()
    expect(result.current.estado).toBe('salvo')
    expect(salvar).toHaveBeenLastCalledWith({ id: 7, content: 'x' })
  })
})
