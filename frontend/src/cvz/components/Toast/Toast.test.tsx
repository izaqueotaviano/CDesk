import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast, type ToastInput } from './Toast'

/** Botão que dispara o toast pedido — `useToast` só existe dentro do provider. */
function Disparar({ toast, rotulo = 'disparar' }: { toast: ToastInput; rotulo?: string }) {
  const { push } = useToast()
  return <button onClick={() => push(toast)}>{rotulo}</button>
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Toast — ação e motivo de saída', () => {
  it('clicar na ação roda a ação e fecha com motivo `action`', () => {
    const aoClicar = vi.fn()
    const onClose = vi.fn()
    render(
      <ToastProvider>
        <Disparar
          toast={{ title: 'Ticket fechado', action: { label: 'Desfazer', onClick: aoClicar }, onClose }}
        />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('disparar'))
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }))

    expect(aoClicar).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledExactlyOnceWith('action')
    expect(screen.queryByText('Ticket fechado')).not.toBeInTheDocument()
  })

  it('o prazo vence com motivo `timeout`; o X e o Esc com `dismiss`', () => {
    const onClose = vi.fn()
    render(
      <ToastProvider>
        <Disparar toast={{ title: 'Um', duration: 1000, onClose }} rotulo="um" />
        <Disparar toast={{ title: 'Dois', duration: 0, onClose }} rotulo="dois" />
        <Disparar toast={{ title: 'Três', duration: 0, onClose }} rotulo="tres" />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('um'))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(onClose).toHaveBeenLastCalledWith('timeout')

    fireEvent.click(screen.getByText('dois'))
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar' }))
    expect(onClose).toHaveBeenLastCalledWith('dismiss')

    fireEvent.click(screen.getByText('tres'))
    fireEvent.keyDown(screen.getByText('Três'), { key: 'Escape' })
    expect(onClose).toHaveBeenLastCalledWith('dismiss')
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('pausa enquanto o ponteiro está em cima e retoma só o que faltava', () => {
    const onClose = vi.fn()
    render(
      <ToastProvider>
        <Disparar toast={{ title: 'Ticket fechado', duration: 6000, onClose }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('disparar'))
    const cartao = screen.getByRole('status')

    act(() => {
      vi.advanceTimersByTime(4000)
    })
    fireEvent.mouseEnter(cartao)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.mouseLeave(cartao)
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onClose).toHaveBeenCalledWith('timeout')
  })

  it('`dismiss(id)` fecha com `programmatic`, e fechar duas vezes não chama de novo', () => {
    const onClose = vi.fn()
    function Programatico() {
      const { push, dismiss } = useToast()
      return (
        <button
          onClick={() => {
            const id = push({ title: 'Oi', onClose })
            dismiss(id)
            dismiss(id)
          }}
        >
          ir
        </button>
      )
    }
    render(
      <ToastProvider>
        <Programatico />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('ir'))
    expect(onClose).toHaveBeenCalledExactlyOnceWith('programmatic')
  })

  it('o provider saindo da tela avisa quem ainda esperava', () => {
    const onClose = vi.fn()
    const { unmount } = render(
      <ToastProvider>
        <Disparar toast={{ title: 'Pendente', onClose }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('disparar'))
    unmount()
    expect(onClose).toHaveBeenCalledExactlyOnceWith('programmatic')
  })
})

describe('Toast — providers aninhados', () => {
  it('cada um desenha os próprios toasts; o de dentro não some com o de fora', () => {
    render(
      <ToastProvider>
        <Disparar toast={{ title: 'Do console', duration: 0 }} rotulo="fora" />
        <ToastProvider>
          <Disparar toast={{ title: 'Da tela cvz', duration: 0 }} rotulo="dentro" />
        </ToastProvider>
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('fora'))
    fireEvent.click(screen.getByText('dentro'))

    const regioes = screen.getAllByRole('region', { name: 'Notificações' })
    expect(regioes).toHaveLength(2)
    const [interna, externa] = regioes
    expect(interna).toHaveTextContent('Da tela cvz')
    expect(interna).not.toHaveTextContent('Do console')
    expect(externa).toHaveTextContent('Do console')
  })
})
