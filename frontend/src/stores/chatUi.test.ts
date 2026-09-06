import { beforeEach, describe, expect, it } from 'vitest'
import { useChatUi } from './chatUi'

beforeEach(() => useChatUi.setState({ abertos: [] }))

describe('chatUi — painéis abertos do mini chat', () => {
  it('abre até o limite; acima dele o mais antigo sai pra dar lugar ao novo', () => {
    const { abrir } = useChatUi.getState()
    abrir(1, 2)
    abrir(2, 2)
    abrir(3, 2)
    expect(useChatUi.getState().abertos).toEqual([2, 3])
  })

  it('abrir de novo o mesmo chat não duplica', () => {
    const { abrir } = useChatUi.getState()
    abrir(1, 3)
    abrir(1, 3)
    expect(useChatUi.getState().abertos).toEqual([1])
  })

  it('alternar abre e fecha', () => {
    const { alternar } = useChatUi.getState()
    alternar(7, 3)
    expect(useChatUi.getState().abertos).toEqual([7])
    alternar(7, 3)
    expect(useChatUi.getState().abertos).toEqual([])
  })

  it('limite zero ou inválido ainda deixa um painel aberto', () => {
    useChatUi.getState().abrir(4, 0)
    expect(useChatUi.getState().abertos).toEqual([4])
  })
})
